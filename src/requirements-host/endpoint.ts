/**
 * Requirements host endpoints: GET /api/skyaxis/requirements plus POST save
 * / remove. The channel semantics (buffered bodies, exact paths, the /api
 * trust+auth fence in front) ride the repos-pool P0 PoC-2 precedent.
 *
 * The only business rule beyond schema: title non-empty (zod), edit id
 * existence, and revision matching. Timestamps are maintained host-side —
 * create mints createdAt=updatedAt=now; edit carries createdAt over and
 * refreshes updatedAt (the repos-pool statusFields counterpart).
 *
 * remove additionally triggers the optional workbench D6 cascade (tombstone
 * → ledger → knowledge → .trash rename, best-effort, never changing the
 * response verdict) when a cleanup service is injected — see
 * WorkbenchCleanupLike below.
 */
import { randomUUID } from 'node:crypto'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import {
  REQUIREMENTS_LIST_PATH,
  REQUIREMENTS_REMOVE_PATH,
  REQUIREMENTS_SAVE_PATH,
  REQUIREMENTS_WORKSPACE_PATH,
} from '../requirements-shared/protocol.js'
import type { ErrorResponse, ListResponse, RequirementRecord } from '../requirements-shared/protocol.js'
import type { RequirementsFileStore } from './requirements-file.js'
import type { RequirementWorkspaceBinder } from './workspace.js'
import { suggestWorkspacePath } from './workspace.js'
import { RemoveRequestSchema, SaveRequestSchema, WorkspaceRequestSchema } from './types.js'

/**
 * Consumer-side minimal interface for the workbench cascade (decisions/0005
 * D6 step ①③④⑤ — the tombstone-before-rename cleanup). Structurally typed
 * so fakes satisfy it in tests; the implementation lives in
 * workbench-host/cascade-service.ts and is injected at assembly time
 * (index.ts). Absent service ⇒ cascade skipped, naturally falling back to
 * orphan tolerance — this host never imports the workbench module.
 */
export interface WorkbenchCleanupLike {
  /** D6 step ① — tombstone into the live artifact dir, BEFORE the requirements save. */
  beginRemoval(requirement: RequirementRecord): void
  /** D6 steps ③④⑤ — ledger deletions + .trash rename, AFTER a committed save. Sync or queued-async. */
  completeRemoval(requirement: RequirementRecord): void | Promise<void>
}

export interface RequirementsServices {
  readonly file: RequirementsFileStore
  /** Workspace binding domain logic (P3a); registry itself is optional. */
  readonly workspaces: RequirementWorkspaceBinder
  /** Workbench cascade cleanup (D6); absent ⇒ removal stays ledger-only. */
  readonly cleanup?: WorkbenchCleanupLike
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

/** Maintains the record timestamps: create mints both; edit carries createdAt over. */
function timestampFields(
  previous: RequirementRecord | undefined,
): Pick<RequirementRecord, 'createdAt' | 'updatedAt'> {
  const now = new Date().toISOString()
  return previous === undefined
    ? { createdAt: now, updatedAt: now }
    : { createdAt: previous.createdAt, updatedAt: now }
}

export function registerRequirementsEndpoints(connection: HostConnectionHandle, services: RequirementsServices): void {
  const { file, workspaces, log } = services

  connection.fetch.register({
    path: REQUIREMENTS_LIST_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const result = file.load()
      const body: ListResponse = result.ok
        ? { ok: true, revision: result.value.revision, requirements: result.value.requirements }
        : { ok: false, degraded: true, reason: result.reason, hasBackup: result.hasBackup }
      return json(body)
    },
  })

  connection.fetch.register({
    path: REQUIREMENTS_SAVE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const parsed = SaveRequestSchema.safeParse(await readJsonBody(request))
      if (!parsed.success) return errorResponse(400, 'bad-request')
      const { expectedRevision, requirement } = parsed.data

      const current = file.load()
      if (!current.ok) return errorResponse(409, 'unreadable-file')
      if (current.value.revision !== expectedRevision) {
        return errorResponse(409, 'conflict', { currentRevision: current.value.revision })
      }

      const previous = requirement.id === undefined
        ? undefined
        : current.value.requirements.find((candidate) => candidate.id === requirement.id)
      if (requirement.id !== undefined && previous === undefined) {
        return errorResponse(404, 'not-found', {
          currentRevision: current.value.revision,
          requirements: current.value.requirements,
        })
      }

      const record: RequirementRecord = {
        id: requirement.id ?? randomUUID(),
        title: requirement.title,
        description: requirement.description,
        // The save form never edits the binding or repo links — carry both over.
        workspacePath: previous?.workspacePath ?? '',
        linkedRepos: previous?.linkedRepos ?? [],
        ...timestampFields(previous),
      }
      const nextRequirements = previous === undefined
        ? [...current.value.requirements, record]
        : current.value.requirements.map((candidate) => (candidate.id === record.id ? record : candidate))

      try {
        const saved = await file.save(expectedRevision, nextRequirements)
        if (!saved.ok) {
          if (saved.rejected === 'stale-revision') {
            return errorResponse(409, 'conflict', { currentRevision: saved.currentRevision })
          }
          return errorResponse(409, 'unreadable-file')
        }
        return json({ ok: true, revision: saved.revision, requirement: record })
      } catch (error) {
        log?.(error)
        return errorResponse(500, 'internal')
      }
    },
  })

  connection.fetch.register({
    path: REQUIREMENTS_REMOVE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const parsed = RemoveRequestSchema.safeParse(await readJsonBody(request))
      if (!parsed.success) return errorResponse(400, 'bad-request')
      const { expectedRevision, id } = parsed.data

      const current = file.load()
      if (!current.ok) return errorResponse(409, 'unreadable-file')
      if (current.value.revision !== expectedRevision) {
        return errorResponse(409, 'conflict', { currentRevision: current.value.revision })
      }
      const removed = current.value.requirements.find((candidate) => candidate.id === id)
      if (removed === undefined) {
        return errorResponse(404, 'not-found', {
          currentRevision: current.value.revision,
          requirements: current.value.requirements,
        })
      }
      const nextRequirements = current.value.requirements.filter((candidate) => candidate.id !== id)
      // D6 cascade, two-phase per the pinned order ①→②→③④⑤: the tombstone
      // lands in the live artifact dir BEFORE the requirements save (a save
      // failure then leaves a live requirement plus a harmless overwrite-on-
      // retry tombstone — remove re-runs converge), and the destructive tail
      // runs only after a committed save, so a 409 never archives anything
      // (the "Only a committed unlink is destructive" discipline). Every
      // cascade failure degrades to log + residue; the ok verdict below
      // depends on this ledger save and nothing else.
      // Double guard: the service contract says never-throws, but a buggy
      // implementation must not change the remove verdict either way.
      try {
        services.cleanup?.beginRemoval(removed)
      } catch (error) {
        log?.(error)
      }
      try {
        const saved = await file.save(expectedRevision, nextRequirements)
        if (!saved.ok) {
          if (saved.rejected === 'stale-revision') {
            return errorResponse(409, 'conflict', { currentRevision: saved.currentRevision })
          }
          return errorResponse(409, 'unreadable-file')
        }
        try {
          await services.cleanup?.completeRemoval(removed)
        } catch (error) {
          log?.(error)
        }
        return json({ ok: true, revision: saved.revision })
      } catch (error) {
        log?.(error)
        return errorResponse(500, 'internal')
      }
    },
  })

  // Workspace binding (P3a): one route registration, GET status + POST
  // set/clear (exact-path registration makes two same-path entries undefined).
  connection.fetch.register({
    path: REQUIREMENTS_WORKSPACE_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'GET') return workspaceStatusFlow(request)
      return workspaceMutateFlow(request)
    },
  })

  async function workspaceStatusFlow(request: Request): Promise<Response> {
    const id = new URL(request.url).searchParams.get('id')
    if (id === null) return errorResponse(400, 'bad-request')

    const current = file.load()
    if (!current.ok) return errorResponse(409, 'unreadable-file')
    const record = current.value.requirements.find((candidate) => candidate.id === id)
    if (record === undefined) {
      return errorResponse(404, 'not-found', {
        currentRevision: current.value.revision,
        requirements: current.value.requirements,
      })
    }
    return statusResponseFor(record)
  }

  function statusResponseFor(record: RequirementRecord): Response {
    const { directoryExists, registered } = workspaces.status(record.workspacePath)
    return json({
      ok: true,
      bound: record.workspacePath !== '',
      path: record.workspacePath,
      directoryExists,
      registered,
      suggestedPath: suggestWorkspacePath(record.title, record.id),
    })
  }

  async function workspaceMutateFlow(request: Request): Promise<Response> {
    const parsed = WorkspaceRequestSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) return errorResponse(400, 'bad-request')

    const current = file.load()
    if (!current.ok) return errorResponse(409, 'unreadable-file')
    // Revision pre-check before any disk/registry side effect (ledger-writing
    // actions only — rebind never writes, so it carries no expectedRevision).
    if (parsed.data.action !== 'rebind' && current.value.revision !== parsed.data.expectedRevision) {
      return errorResponse(409, 'conflict', { currentRevision: current.value.revision })
    }
    const record = current.value.requirements.find((candidate) => candidate.id === parsed.data.id)
    if (record === undefined) {
      return errorResponse(404, 'not-found', {
        currentRevision: current.value.revision,
        requirements: current.value.requirements,
      })
    }

    try {
      if (parsed.data.action === 'rebind') {
        if (record.workspacePath === '') return errorResponse(400, 'bad-request')
        const bound = await workspaces.rebind(record.workspacePath)
        if (!bound.ok) {
          if (bound.reason === 'invalid-path') return errorResponse(400, 'invalid-path')
          log?.(bound.detail ?? 'workspace rebind failed')
          return errorResponse(500, 'internal')
        }
        return statusResponseFor(record)
      }
      if (parsed.data.action === 'clear') {
        // Unbinding an already-unbound record is an idempotent no-op.
        if (record.workspacePath === '') {
          return json({ ok: true, revision: current.value.revision, requirement: record })
        }
        const next: RequirementRecord = {
          ...record,
          workspacePath: '',
          ...timestampFields(record),
        }
        return await persistWorkspaceRecord(parsed.data.expectedRevision, current.value.requirements, next)
      }

      const bound = await workspaces.bind(parsed.data.path)
      if (!bound.ok) {
        if (bound.reason === 'invalid-path') return errorResponse(400, 'invalid-path')
        log?.(bound.detail ?? 'workspace bind failed')
        return errorResponse(500, 'internal')
      }
      const next: RequirementRecord = {
        ...record,
        workspacePath: bound.canonicalPath,
        ...timestampFields(record),
      }
      return await persistWorkspaceRecord(parsed.data.expectedRevision, current.value.requirements, next)
    } catch (error) {
      log?.(error)
      return errorResponse(500, 'internal')
    }
  }

  async function persistWorkspaceRecord(
    expectedRevision: number,
    requirements: readonly RequirementRecord[],
    next: RequirementRecord,
  ): Promise<Response> {
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
