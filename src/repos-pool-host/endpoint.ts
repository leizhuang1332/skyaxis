/**
 * Repos-pool host endpoints: GET /api/skyaxis/repos plus POST validate /
 * save / remove. The channel semantics (buffered bodies, exact paths, the
 * /api trust+auth fence in front) were proven by P0 PoC-2.
 *
 * Validation policy per decision 0003 (as amended by 0004): the server
 * always enforces URL legality and duplicate checks; reachability is
 * validated once from the form flow (POST validate) and the save request
 * carries the client's per-address conclusions, never a re-probe. Save
 * order is pinned: parse → per-address syntax (422 + field) → slot-by-value
 * (key mismatch after placement = 400) → duplicate → per-slot state
 * assembly → save.
 */
import { randomUUID } from 'node:crypto'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import {
  REPOS_LIST_PATH,
  REPOS_REMOVE_PATH,
  REPOS_SAVE_PATH,
  REPOS_VALIDATE_PATH,
} from '../repos-pool-shared/protocol.js'
import type {
  AddressSlot,
  ErrorResponse,
  ListResponse,
  RepoRecord,
  RepoStatus,
  SaveVerdict,
} from '../repos-pool-shared/protocol.js'
import { slotOfKind } from '../repos-pool-shared/address.js'
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

/** Slot by value (decision 0004 / D4): shared with the browser form via repos-pool-shared/address.js. */

interface SlotState {
  readonly status: RepoStatus
  readonly validatedAt: string | null
  readonly lastError: string | null
}

/**
 * Maps one address slot's verdict onto its persisted state quadruple.
 * Slot-level inheritance: 'unchanged' keeps the slot's own previous
 * quadruple (decision 0004 / D2); a missing previous slot — create, or an
 * edit that newly carries this slot — falls back to unverified instead of
 * 422, so a stale cached client cannot wedge the save flow.
 */
function slotState(verdict: SaveVerdict | undefined, previous: RepoRecord | undefined, slot: AddressSlot): SlotState {
  const now = new Date().toISOString()
  if (verdict?.kind === 'unchanged') {
    const prevUrl = slot === 'ssh' ? previous?.urlSsh : previous?.urlHttp
    if (previous !== undefined && prevUrl !== undefined) {
      return {
        status: (slot === 'ssh' ? previous.statusSsh : previous.statusHttp) as RepoStatus,
        validatedAt: (slot === 'ssh' ? previous.validatedAtSsh : previous.validatedAtHttp) ?? null,
        lastError: (slot === 'ssh' ? previous.lastErrorSsh : previous.lastErrorHttp) ?? null,
      }
    }
    return { status: 'unverified', validatedAt: null, lastError: null }
  }
  switch (verdict?.kind) {
    case 'verified':
      return { status: 'verified', validatedAt: now, lastError: null }
    case 'forced':
      // 'unknown' persists as 'unverified' (honest: no successful verification)
      // rather than growing the status enum with a fifth value.
      if (verdict.from === 'unknown') return { status: 'unverified', validatedAt: null, lastError: null }
      return { status: verdict.from === 'network' ? 'forced-network' : 'forced-auth', validatedAt: now, lastError: null }
    default: // undefined is unreachable (key-set === slot-set is schema-enforced)
      return { status: 'unverified', validatedAt: null, lastError: null }
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

      // Per-address syntax + slot-by-value placement (decision 0004 / D4):
      // the kind decides the slot; the field the value arrived in does not.
      const placed: Partial<Record<AddressSlot, string>> = {}
      for (const [field, value] of [['ssh', repo.urlSsh], ['http', repo.urlHttp]] as const) {
        if (value === undefined) continue
        const syntax = validatorSyntax(value)
        if (!syntax.acceptable) return errorResponse(422, 'invalid-url', { reason: syntax.reason, field })
        placed[slotOfKind(syntax.kind)] = value
      }
      // Two addresses placing onto the same slot (client assembled the body
      // by field name instead of by value) — 400, never silently deduped.
      const placedKeys = Object.keys(placed) as AddressSlot[]
      const verdictKeys = Object.keys(validation) as AddressSlot[]
      if (placedKeys.length !== verdictKeys.length || !placedKeys.every((key) => verdictKeys.includes(key))) {
        return errorResponse(400, 'bad-request')
      }

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
      // Duplicate across the whole pool: any new address equal to ANY stored
      // address of another record (either slot) — one remote, one record.
      const newAddresses = Object.values(placed)
      const duplicate = current.value.repos.some(
        (candidate) => candidate.id !== repo.id
          && ((candidate.urlSsh !== undefined && newAddresses.includes(candidate.urlSsh))
            || (candidate.urlHttp !== undefined && newAddresses.includes(candidate.urlHttp))),
      )
      if (duplicate) return errorResponse(422, 'duplicate-url')

      const sshState = placed.ssh !== undefined ? slotState(validation.ssh, previous, 'ssh') : undefined
      const httpState = placed.http !== undefined ? slotState(validation.http, previous, 'http') : undefined
      const record: RepoRecord = {
        id: repo.id ?? randomUUID(),
        name: repo.name,
        description: repo.description,
        ...(sshState !== undefined && placed.ssh !== undefined
          ? { urlSsh: placed.ssh, statusSsh: sshState.status, validatedAtSsh: sshState.validatedAt, lastErrorSsh: sshState.lastError }
          : {}),
        ...(httpState !== undefined && placed.http !== undefined
          ? { urlHttp: placed.http, statusHttp: httpState.status, validatedAtHttp: httpState.validatedAt, lastErrorHttp: httpState.lastError }
          : {}),
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
