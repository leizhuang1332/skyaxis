/**
 * Linked-repositories endpoints (P3b): GET task snapshots + POST
 * link/unlink/reclone/cancel, over the shared requirements file and the
 * CloneTaskRegistry. One route registration, both methods (the exact-path
 * registration makes two same-path entries undefined — the workspace route
 * precedent).
 *
 * Ledger rules: link/unlink write the file under the revision guard (input
 * validation — preflight — runs BEFORE any ledger write so bad requests
 * never leave dirty rows); reclone/cancel never touch the ledger (the
 * rebind precedent). Unlink (user decision 2026-09-27) ALSO deletes the
 * cloned source directory under repos/ — the UI gates it behind a
 * confirmation dialog; the destructive side (abort + rm) runs only AFTER
 * the ledger write succeeds, so a 409 never kills a clone or deletes data.
 */
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { REQUIREMENTS_REPOS_PATH } from '../requirements-shared/protocol.js'
import type { ErrorResponse, RequirementRecord } from '../requirements-shared/protocol.js'
import type { RequirementsFileStore } from './requirements-file.js'
import type { ClonePreflightReason, CloneTaskRegistry, CloneStartInput } from './clone.js'
import { ReposRequestSchema } from './types.js'
import { repoDirName } from '../requirements-shared/repo-dir.js'

export interface RequirementsReposServices {
  readonly file: RequirementsFileStore
  readonly clones: CloneTaskRegistry
  /** Host log face for unexpected handler failures (500s). */
  readonly log?: (error: unknown) => void
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function errorResponse(status: number, code: ErrorResponse['code'], extra?: Omit<ErrorResponse, 'ok' | 'code'>): Response {
  return json({ ok: false, code, ...extra }, status)
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

function refreshTimestamps(record: RequirementRecord): Pick<RequirementRecord, 'createdAt' | 'updatedAt'> {
  return { createdAt: record.createdAt, updatedAt: new Date().toISOString() }
}

/** Preflight reasons mapped onto the wire error vocabulary. */
const PREFLIGHT_CODE: Readonly<Record<ClonePreflightReason, ErrorResponse['code']>> = {
  'no-service': 'git-missing',
  'git-missing': 'git-missing',
  'invalid-branch': 'invalid-branch',
  'dest-exists': 'dest-exists',
  busy: 'busy',
  'too-many': 'too-many',
}

export function registerRequirementsReposEndpoints(connection: HostConnectionHandle, services: RequirementsReposServices): void {
  const { file, clones, log } = services

  connection.fetch.register({
    path: REQUIREMENTS_REPOS_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'GET') return tasksFlow(request)
      return mutateFlow(request)
    },
  })

  async function tasksFlow(request: Request): Promise<Response> {
    const id = new URL(request.url).searchParams.get('id')
    if (id === null) return errorResponse(400, 'bad-request')
    const current = file.load()
    if (!current.ok) return errorResponse(409, 'unreadable-file')
    if (!current.value.requirements.some((candidate) => candidate.id === id)) {
      return errorResponse(404, 'not-found', {
        currentRevision: current.value.revision,
        requirements: current.value.requirements,
      })
    }
    return json({ ok: true, tasks: clones.snapshot(id) })
  }

  async function mutateFlow(request: Request): Promise<Response> {
    const parsed = ReposRequestSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) return errorResponse(400, 'bad-request')
    const body = parsed.data

    const current = file.load()
    if (!current.ok) return errorResponse(409, 'unreadable-file')
    const record = current.value.requirements.find((candidate) => candidate.id === body.id)
    if (record === undefined) {
      return errorResponse(404, 'not-found', {
        currentRevision: current.value.revision,
        requirements: current.value.requirements,
      })
    }
    if (record.workspacePath === '') return errorResponse(400, 'no-workspace')

    // Revision pre-check before any side effect (ledger-writing actions only).
    if ((body.action === 'link' || body.action === 'unlink') && current.value.revision !== body.expectedRevision) {
      return errorResponse(409, 'conflict', { currentRevision: current.value.revision })
    }

    try {
      if (body.action === 'cancel') {
        clones.abort(body.id, body.repoId)
        return json({ ok: true, tasks: clones.snapshot(body.id) })
      }

      if (body.action === 'reclone') {
        const linked = record.linkedRepos.find((candidate) => candidate.repoId === body.repoId)
        if (linked === undefined) return errorResponse(404, 'not-found')
        // The ledgered dirName governs the destination — pool renames never
        // move an existing link's directory.
        const input: CloneStartInput = {
          requirementId: body.id,
          workspacePath: record.workspacePath,
          repoId: body.repoId,
          repoUrl: body.repoUrl,
          repoName: body.repoName,
          branch: linked.branch,
        }
        const result = await clones.reclone(input)
        if (!result.ok) return errorResponse(400, PREFLIGHT_CODE[result.reason])
        return json({ ok: true, tasks: clones.snapshot(body.id) })
      }

      if (body.action === 'unlink') {
        const linked = record.linkedRepos.find((candidate) => candidate.repoId === body.repoId)
        // Removing a link that is not there: idempotent no-op (the clear precedent).
        if (linked === undefined) {
          return json({ ok: true, revision: current.value.revision, requirement: record, tasks: clones.snapshot(body.id) })
        }
        const next: RequirementRecord = {
          ...record,
          linkedRepos: record.linkedRepos.filter((candidate) => candidate.repoId !== body.repoId),
          ...refreshTimestamps(record),
        }
        // Ledger write FIRST: a 409 must not have killed the clone or deleted
        // the source. Only a committed unlink is destructive.
        const nextRequirements = current.value.requirements.map((candidate) => (candidate.id === next.id ? next : candidate))
        const saved = await file.save(body.expectedRevision, nextRequirements)
        if (!saved.ok) {
          if (saved.rejected === 'stale-revision') {
            return errorResponse(409, 'conflict', { currentRevision: saved.currentRevision })
          }
          return errorResponse(409, 'unreadable-file')
        }
        clones.abort(body.id, body.repoId)
        // Directory location derives from the request's name snapshot; a link
        // whose pool row is gone (no name) keeps its directory (hand-deletable).
        if (body.repoName !== undefined) {
          clones.removeDir(record.workspacePath, repoDirName(body.repoName, body.repoId))
        }
        return json({ ok: true, revision: saved.revision, requirement: next, tasks: clones.snapshot(body.id) })
      }

      // link
      if (record.linkedRepos.some((candidate) => candidate.repoId === body.repoId)) {
        return errorResponse(400, 'bad-request')
      }
      const input: CloneStartInput = {
        requirementId: body.id,
        workspacePath: record.workspacePath,
        repoId: body.repoId,
        repoUrl: body.repoUrl,
        repoName: body.repoName,
        branch: body.branch,
      }
      const pre = await clones.preflight(input)
      if (!pre.ok) return errorResponse(400, PREFLIGHT_CODE[pre.reason])
      const next: RequirementRecord = {
        ...record,
        linkedRepos: [...record.linkedRepos, { repoId: body.repoId, branch: body.branch }],
        ...refreshTimestamps(record),
      }
      const nextRequirements = current.value.requirements.map((candidate) => (candidate.id === next.id ? next : candidate))
      const saved = await file.save(body.expectedRevision, nextRequirements)
      if (!saved.ok) {
        if (saved.rejected === 'stale-revision') {
          return errorResponse(409, 'conflict', { currentRevision: saved.currentRevision })
        }
        return errorResponse(409, 'unreadable-file')
      }
      // Ledger written — start the task; a spawn blow-up keeps the ledger row
      // (an uncloned link) rather than failing the whole request.
      clones.begin(input, pre.exe)
      return json({ ok: true, revision: saved.revision, requirement: next, tasks: clones.snapshot(body.id) })
    } catch (error) {
      log?.(error)
      return errorResponse(500, 'internal')
    }
  }

  async function persist(expectedRevision: number, requirements: readonly RequirementRecord[], next: RequirementRecord): Promise<Response> {
    const nextRequirements = requirements.map((candidate) => (candidate.id === next.id ? next : candidate))
    const saved = await file.save(expectedRevision, nextRequirements)
    if (!saved.ok) {
      if (saved.rejected === 'stale-revision') {
        return errorResponse(409, 'conflict', { currentRevision: saved.currentRevision })
      }
      return errorResponse(409, 'unreadable-file')
    }
    return json({ ok: true, revision: saved.revision, requirement: next })
  }
}
