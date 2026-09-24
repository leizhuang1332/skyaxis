/**
 * Requirements endpoint client (browser half).
 *
 * Same-origin fetch with no explicit auth headers — the connection layer's
 * cookie rides automatically (the repos-pool precedent). Errors branch three
 * ways: transport failures (`network`), non-2xx with a parsed error body,
 * and 2xx payloads checked by the hand-written protocol guards.
 */
import {
  REQUIREMENTS_LIST_PATH,
  REQUIREMENTS_REMOVE_PATH,
  REQUIREMENTS_SAVE_PATH,
} from '../../requirements-shared/protocol.js'
import type {
  ErrorResponse,
  ListResponse,
  RemoveResponseOk,
  RequirementRecord,
  SaveRequestBody,
  SaveResponseOk,
} from '../../requirements-shared/protocol.js'
import {
  isErrorResponse,
  isListResponse,
  isRemoveResponseOk,
  isSaveResponseOk,
} from '../../requirements-shared/protocol.js'

export type Failure = { readonly kind: 'network' } | { readonly kind: 'http-error'; readonly status: number; readonly code?: string; readonly currentRevision?: number }

export type ListResult =
  | { readonly kind: 'ok'; readonly revision: number; readonly requirements: readonly RequirementRecord[] }
  | { readonly kind: 'degraded'; readonly reason: 'parse' | 'schema' | 'io'; readonly hasBackup: boolean }
  | Failure

export type SaveResult = { readonly kind: 'ok'; readonly revision: number; readonly requirement: RequirementRecord } | Failure
export type RemoveResult = { readonly kind: 'ok'; readonly revision: number } | Failure

async function request(path: string, init: RequestInit | undefined, signal: AbortSignal | undefined): Promise<Response | Failure> {
  try {
    return await fetch(path, { ...init, signal })
  } catch {
    return { kind: 'network' }
  }
}

async function parseErrorBody(response: Response): Promise<Failure> {
  let code: string | undefined
  let currentRevision: number | undefined
  try {
    const body: unknown = await response.json()
    if (isErrorResponse(body)) {
      code = body.code
      currentRevision = body.currentRevision
    }
  } catch {
    // Non-JSON error bodies keep the status only.
  }
  return { kind: 'http-error', status: response.status, code, currentRevision }
}

export function createRequirementsFetcher() {
  return {
    async list(signal?: AbortSignal): Promise<ListResult> {
      const response = await request(REQUIREMENTS_LIST_PATH, { method: 'GET' }, signal)
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const body: unknown = await response.json()
      if (!isListResponse(body)) return { kind: 'http-error', status: response.status }
      if (body.ok) return { kind: 'ok', revision: body.revision, requirements: [...body.requirements] }
      return { kind: 'degraded', reason: body.reason, hasBackup: body.hasBackup }
    },

    async save(body: SaveRequestBody, signal?: AbortSignal): Promise<SaveResult> {
      const response = await request(REQUIREMENTS_SAVE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, signal)
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const parsed: unknown = await response.json()
      if (!isSaveResponseOk(parsed)) return { kind: 'http-error', status: response.status }
      const ok: SaveResponseOk = parsed
      return { kind: 'ok', revision: ok.revision, requirement: ok.requirement }
    },

    async remove(body: { expectedRevision: number; id: string }, signal?: AbortSignal): Promise<RemoveResult> {
      const response = await request(REQUIREMENTS_REMOVE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, signal)
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const parsed: unknown = await response.json()
      if (!isRemoveResponseOk(parsed)) return { kind: 'http-error', status: response.status }
      const ok: RemoveResponseOk = parsed
      return { kind: 'ok', revision: ok.revision }
    },
  }
}

export type RequirementsFetcher = ReturnType<typeof createRequirementsFetcher>
