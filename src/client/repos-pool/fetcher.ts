/**
 * Repos-pool endpoint client (browser half).
 *
 * Same-origin fetch with no explicit auth headers — the connection layer's
 * cookie rides automatically (the official present-open precedent). Errors
 * branch three ways: transport failures (`network`), non-2xx with a parsed
 * error body, and 2xx payloads checked by the hand-written protocol guards.
 */
import {
  REPOS_LIST_PATH,
  REPOS_REMOVE_PATH,
  REPOS_SAVE_PATH,
  REPOS_VALIDATE_PATH,
} from '../../repos-pool-shared/protocol.js'
import type {
  AddressSlot,
  ErrorResponse,
  ListResponse,
  RepoRecord,
  RemoveResponseOk,
  SaveRequestBody,
  SaveResponseOk,
  ValidateOutcome,
} from '../../repos-pool-shared/protocol.js'
import {
  isErrorResponse,
  isListResponse,
  isRemoveResponseOk,
  isSaveResponseOk,
  isValidateResponse,
} from '../../repos-pool-shared/protocol.js'
import type { UrlRejection } from '../../repos-pool-shared/protocol.js'

export type Failure = { readonly kind: 'network' } | { readonly kind: 'http-error'; readonly status: number; readonly code?: string; readonly reason?: UrlRejection; readonly field?: AddressSlot; readonly currentRevision?: number }

export type ListResult =
  | { readonly kind: 'ok'; readonly revision: number; readonly repos: readonly RepoRecord[] }
  | { readonly kind: 'degraded'; readonly reason: 'parse' | 'schema' | 'io'; readonly hasBackup: boolean }
  | Failure

export type SaveResult = { readonly kind: 'ok'; readonly revision: number; readonly repo: RepoRecord } | Failure
export type RemoveResult = { readonly kind: 'ok'; readonly revision: number } | Failure
export type ValidateResult = { readonly kind: 'ok'; readonly outcome: ValidateOutcome } | Failure

async function request(path: string, init: RequestInit | undefined, signal: AbortSignal | undefined): Promise<Response | Failure> {
  try {
    return await fetch(path, { ...init, signal })
  } catch {
    return { kind: 'network' }
  }
}

async function parseErrorBody(response: Response): Promise<Failure> {
  let code: string | undefined
  let reason: UrlRejection | undefined
  let field: AddressSlot | undefined
  let currentRevision: number | undefined
  try {
    const body: unknown = await response.json()
    if (isErrorResponse(body)) {
      code = body.code
      reason = body.reason
      field = body.field
      currentRevision = body.currentRevision
    }
  } catch {
    // Non-JSON error bodies keep the status only.
  }
  return { kind: 'http-error', status: response.status, code, reason, field, currentRevision }
}

export function createReposFetcher() {
  return {
    async list(signal?: AbortSignal): Promise<ListResult> {
      const response = await request(REPOS_LIST_PATH, { method: 'GET' }, signal)
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const body: unknown = await response.json()
      if (!isListResponse(body)) return { kind: 'http-error', status: response.status }
      if (body.ok) return { kind: 'ok', revision: body.revision, repos: [...body.repos] }
      return { kind: 'degraded', reason: body.reason, hasBackup: body.hasBackup }
    },

    async save(body: SaveRequestBody, signal?: AbortSignal): Promise<SaveResult> {
      const response = await request(REPOS_SAVE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, signal)
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const parsed: unknown = await response.json()
      if (!isSaveResponseOk(parsed)) return { kind: 'http-error', status: response.status }
      const ok: SaveResponseOk = parsed
      return { kind: 'ok', revision: ok.revision, repo: ok.repo }
    },

    async remove(body: { expectedRevision: number; id: string }, signal?: AbortSignal): Promise<RemoveResult> {
      const response = await request(REPOS_REMOVE_PATH, {
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

    async validate(url: string, signal?: AbortSignal): Promise<ValidateResult> {
      const response = await request(REPOS_VALIDATE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      }, signal)
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const parsed: unknown = await response.json()
      if (!isValidateResponse(parsed)) return { kind: 'http-error', status: response.status }
      return { kind: 'ok', outcome: { syntax: parsed.syntax, reachability: parsed.reachability } }
    },
  }
}

export type ReposFetcher = ReturnType<typeof createReposFetcher>
