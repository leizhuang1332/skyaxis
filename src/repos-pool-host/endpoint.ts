/**
 * Repos-pool host endpoints: GET /api/skyaxis/repos plus POST validate /
 * save / remove. The channel semantics (buffered bodies, exact paths, the
 * /api trust+auth fence in front) were proven by P0 PoC-2.
 *
 * Validation policy per decision 0003: the server always enforces URL
 * legality and duplicate checks; reachability is validated once from the
 * form flow (POST validate) and the save request carries the client's
 * conclusion, never a re-probe.
 */
import { randomUUID } from 'node:crypto'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import {
  REPOS_LIST_PATH,
  REPOS_REMOVE_PATH,
  REPOS_SAVE_PATH,
  REPOS_VALIDATE_PATH,
} from '../repos-pool-shared/protocol.js'
import type { ErrorResponse, ListResponse, RepoRecord, SaveValidation } from '../repos-pool-shared/protocol.js'
import type { ReposFileStore } from './repos-file.js'
import { RemoveRequestSchema, SaveRequestSchema, ValidateRequestSchema } from './types.js'
import { checkUrlSyntax as validatorSyntax } from './validator.js'
import type { ReposValidator } from './validator.js'

export interface ReposPoolServices {
  readonly file: ReposFileStore
  readonly validator: ReposValidator
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

/** Maps a SaveValidation kind onto the persisted status fields. */
function statusFields(
  validation: SaveValidation,
  previous: RepoRecord | undefined,
): Pick<RepoRecord, 'status' | 'validatedAt' | 'lastError'> {
  const now = new Date().toISOString()
  switch (validation.kind) {
    case 'verified':
      return { status: 'verified', validatedAt: now, lastError: null }
    case 'unverified':
      return { status: 'unverified', validatedAt: null, lastError: null }
    case 'forced':
      // 'unknown' persists as 'unverified' (honest: no successful verification)
      // rather than growing the status enum with a fifth value.
      if (validation.from === 'unknown') return { status: 'unverified', validatedAt: null, lastError: null }
      return { status: validation.from === 'network' ? 'forced-network' : 'forced-auth', validatedAt: now, lastError: null }
    case 'unchanged':
      return previous
        ? { status: previous.status, validatedAt: previous.validatedAt, lastError: previous.lastError }
        : { status: 'unverified', validatedAt: null, lastError: null }
  }
}

export function registerReposPoolEndpoints(connection: HostConnectionHandle, services: ReposPoolServices): void {
  const { file, validator, log } = services

  connection.fetch.register({
    path: REPOS_LIST_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const result = file.load()
      const body: ListResponse = result.ok
        ? { ok: true, revision: result.value.revision, repos: result.value.repos }
        : { ok: false, degraded: true, reason: result.reason, hasBackup: result.hasBackup }
      return json(body)
    },
  })

  connection.fetch.register({
    path: REPOS_VALIDATE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const parsed = ValidateRequestSchema.safeParse(await readJsonBody(request))
      if (!parsed.success) return errorResponse(400, 'bad-request')
      const syntax = validatorSyntax(parsed.data.url)
      if (!syntax.acceptable) return json({ ok: true, syntax })
      const probed = await validator.probe(parsed.data.url, request.signal)
      if ('skipped' in probed) {
        return json({ ok: true, syntax, reachability: { classification: 'unverified', reason: probed.skipped } })
      }
      return json({
        ok: true,
        syntax,
        reachability: { classification: probed.classification, ...(probed.detail ? { detail: probed.detail } : {}) },
      })
    },
  })

  connection.fetch.register({
    path: REPOS_SAVE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const parsed = SaveRequestSchema.safeParse(await readJsonBody(request))
      if (!parsed.success) return errorResponse(400, 'bad-request')
      const { expectedRevision, repo, validation } = parsed.data

      const syntax = validatorSyntax(repo.url)
      if (!syntax.acceptable) return errorResponse(422, 'invalid-url', { reason: syntax.reason })

      const current = file.load()
      if (!current.ok) return errorResponse(409, 'unreadable-file')
      if (current.value.revision !== expectedRevision) {
        return errorResponse(409, 'conflict', { currentRevision: current.value.revision })
      }

      const previous = repo.id === undefined
        ? undefined
        : current.value.repos.find((candidate) => candidate.id === repo.id)
      if (repo.id !== undefined && previous === undefined) {
        return errorResponse(404, 'not-found', {
          currentRevision: current.value.revision,
          repos: current.value.repos,
        })
      }
      const duplicate = current.value.repos.some(
        (candidate) => candidate.url === repo.url && candidate.id !== repo.id,
      )
      if (duplicate) return errorResponse(422, 'duplicate-url')

      const record: RepoRecord = {
        id: repo.id ?? randomUUID(),
        name: repo.name,
        url: repo.url,
        description: repo.description,
        ...statusFields(validation, previous),
      }
      const nextRepos = previous === undefined
        ? [...current.value.repos, record]
        : current.value.repos.map((candidate) => (candidate.id === record.id ? record : candidate))

      try {
        const saved = await file.save(expectedRevision, nextRepos)
        if (!saved.ok) {
          if (saved.rejected === 'stale-revision') {
            return errorResponse(409, 'conflict', { currentRevision: saved.currentRevision })
          }
          return errorResponse(409, 'unreadable-file')
        }
        return json({ ok: true, revision: saved.revision, repo: record })
      } catch (error) {
        log?.(error)
        return errorResponse(500, 'internal')
      }
    },
  })

  connection.fetch.register({
    path: REPOS_REMOVE_PATH,
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
      if (!current.value.repos.some((candidate) => candidate.id === id)) {
        return errorResponse(404, 'not-found', {
          currentRevision: current.value.revision,
          repos: current.value.repos,
        })
      }
      const nextRepos = current.value.repos.filter((candidate) => candidate.id !== id)
      try {
        const saved = await file.save(expectedRevision, nextRepos)
        if (!saved.ok) {
          if (saved.rejected === 'stale-revision') {
            return errorResponse(409, 'conflict', { currentRevision: saved.currentRevision })
          }
          return errorResponse(409, 'unreadable-file')
        }
        return json({ ok: true, revision: saved.revision })
      } catch (error) {
        log?.(error)
        return errorResponse(500, 'internal')
      }
    },
  })
}
