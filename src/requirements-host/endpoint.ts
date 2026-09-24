/**
 * Requirements host endpoints: GET /api/skyaxis/requirements plus POST save
 * / remove. The channel semantics (buffered bodies, exact paths, the /api
 * trust+auth fence in front) ride the repos-pool P0 PoC-2 precedent.
 *
 * The only business rule beyond schema: title non-empty (zod), edit id
 * existence, and revision matching. Timestamps are maintained host-side —
 * create mints createdAt=updatedAt=now; edit carries createdAt over and
 * refreshes updatedAt (the repos-pool statusFields counterpart).
 */
import { randomUUID } from 'node:crypto'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import {
  REQUIREMENTS_LIST_PATH,
  REQUIREMENTS_REMOVE_PATH,
  REQUIREMENTS_SAVE_PATH,
} from '../requirements-shared/protocol.js'
import type { ErrorResponse, ListResponse, RequirementRecord } from '../requirements-shared/protocol.js'
import type { RequirementsFileStore } from './requirements-file.js'
import { RemoveRequestSchema, SaveRequestSchema } from './types.js'

export interface RequirementsServices {
  readonly file: RequirementsFileStore
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
  const { file, log } = services

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
      if (!current.value.requirements.some((candidate) => candidate.id === id)) {
        return errorResponse(404, 'not-found', {
          currentRevision: current.value.revision,
          requirements: current.value.requirements,
        })
      }
      const nextRequirements = current.value.requirements.filter((candidate) => candidate.id !== id)
      try {
        const saved = await file.save(expectedRevision, nextRequirements)
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
