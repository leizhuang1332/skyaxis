/**
 * Workbench endpoint client (browser half).
 *
 * Same-origin fetch with no explicit auth headers — the connection layer's
 * cookie rides automatically (the requirements fetcher precedent). Errors
 * branch three ways: transport failures (`network`), non-2xx with a parsed
 * error body, and 2xx payloads checked by the hand-written protocol guards.
 *
 * Artifact reads/writes ride text/plain bodies with query discrimination
 * (the prd-upload shape); the scan endpoint has no UI consumer this round
 * and deliberately has no method here — wire without a consumer stays
 * unopened (the D3 logic).
 */
import {
  WORKBENCH_ARTIFACTS_PATH,
  WORKBENCH_PATH,
} from '../../workbench-shared/protocol.js'
import type {
  ArtifactWriteResponseOk,
  ErrorResponse,
  PlanFileExistsRow,
  ReviewFileExistsRow,
  WorkbenchFinding,
  WorkbenchListResponse,
  WorkbenchMutateRequestBody,
  WorkbenchRecord,
  WorkbenchSaveResponseOk,
} from '../../workbench-shared/protocol.js'
import {
  isArtifactContentResponse,
  isArtifactWriteResponseOk,
  isErrorResponse,
  isWorkbenchDetailResponse,
  isWorkbenchListResponse,
  isWorkbenchSaveResponseOk,
} from '../../workbench-shared/protocol.js'

export type WorkbenchFailure =
  | { readonly kind: 'network' }
  | { readonly kind: 'http-error'; readonly status: number; readonly code?: string; readonly currentRevision?: number }

export type WorkbenchListResult =
  | { readonly kind: 'ok'; readonly revision: number; readonly records: readonly WorkbenchRecord[] }
  | { readonly kind: 'degraded'; readonly reason: 'parse' | 'schema' | 'io'; readonly hasBackup: boolean }
  | WorkbenchFailure

export type WorkbenchDetailResult =
  | {
    readonly kind: 'ok'
    readonly revision: number
    readonly record: WorkbenchRecord | null
    readonly planFileExists: readonly PlanFileExistsRow[]
    readonly reviewFileExists: readonly ReviewFileExistsRow[]
  }
  | WorkbenchFailure

export type WorkbenchMutateResult =
  | { readonly kind: 'ok'; readonly revision: number; readonly record: WorkbenchRecord }
  | WorkbenchFailure

export type WorkbenchArtifactWriteResult =
  | { readonly kind: 'ok'; readonly revision: number; readonly anchor: ArtifactWriteResponseOk }
  | WorkbenchFailure

export type WorkbenchArtifactContentResult =
  | { readonly kind: 'ok'; readonly content: string; readonly contentTampered: boolean }
  | WorkbenchFailure

async function request(path: string, init: RequestInit | undefined, signal: AbortSignal | undefined): Promise<Response | WorkbenchFailure> {
  try {
    return await fetch(path, { ...init, signal })
  } catch {
    return { kind: 'network' }
  }
}

async function parseErrorBody(response: Response): Promise<WorkbenchFailure> {
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

export function createWorkbenchFetcher() {
  return {
    async list(signal?: AbortSignal): Promise<WorkbenchListResult> {
      const response = await request(WORKBENCH_PATH, { method: 'GET' }, signal)
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const body: unknown = await response.json()
      if (!isWorkbenchListResponse(body)) return { kind: 'http-error', status: response.status }
      const parsed: WorkbenchListResponse = body
      if (parsed.ok) return { kind: 'ok', revision: parsed.revision, records: [...parsed.records] }
      return { kind: 'degraded', reason: parsed.reason, hasBackup: parsed.hasBackup }
    },

    async detail(requirementId: string, signal?: AbortSignal): Promise<WorkbenchDetailResult> {
      const response = await request(
        `${WORKBENCH_PATH}?requirementId=${encodeURIComponent(requirementId)}`,
        { method: 'GET' },
        signal,
      )
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const parsed: unknown = await response.json()
      if (!isWorkbenchDetailResponse(parsed)) return { kind: 'http-error', status: response.status }
      return {
        kind: 'ok',
        revision: parsed.revision,
        record: parsed.record,
        planFileExists: [...parsed.planFileExists],
        reviewFileExists: [...parsed.reviewFileExists],
      }
    },

    async mutate(body: WorkbenchMutateRequestBody, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      const response = await request(WORKBENCH_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, signal)
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const parsed: unknown = await response.json()
      if (!isWorkbenchSaveResponseOk(parsed)) return { kind: 'http-error', status: response.status }
      const ok: WorkbenchSaveResponseOk = parsed
      return { kind: 'ok', revision: ok.revision, record: ok.record }
    },

    async advanceStage(requirementId: string, expectedRevision: number, stage: WorkbenchRecord['stage'], note?: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'advanceStage', stage, ...(note !== undefined ? { note } : {}) }, signal)
    },

    async saveFinding(requirementId: string, expectedRevision: number, finding: Omit<WorkbenchFinding, 'id' | 'createdAt'> & { id?: string }, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'saveFinding', finding: { ...finding } }, signal)
    },

    async removeFinding(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'removeFinding', id }, signal)
    },

    async writePlan(requirementId: string, moduleId: string, text: string, expectedRevision: number, note?: string, signal?: AbortSignal): Promise<WorkbenchArtifactWriteResult> {
      const query = new URLSearchParams({ kind: 'plan', requirementId, moduleId, expectedRevision: String(expectedRevision) })
      if (note !== undefined) query.set('note', note)
      const response = await request(`${WORKBENCH_ARTIFACTS_PATH}?${query.toString()}`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: text,
      }, signal)
      return artifactWriteResult(response)
    },

    async writeReview(requirementId: string, text: string, expectedRevision: number, title?: string, signal?: AbortSignal): Promise<WorkbenchArtifactWriteResult> {
      const query = new URLSearchParams({ kind: 'review', requirementId, expectedRevision: String(expectedRevision) })
      if (title !== undefined) query.set('title', title)
      const response = await request(`${WORKBENCH_ARTIFACTS_PATH}?${query.toString()}`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: text,
      }, signal)
      return artifactWriteResult(response)
    },

    async planContent(requirementId: string, moduleId: string, version: number, signal?: AbortSignal): Promise<WorkbenchArtifactContentResult> {
      const query = new URLSearchParams({ kind: 'plan', requirementId, moduleId, version: String(version) })
      return artifactContentResult(await request(`${WORKBENCH_ARTIFACTS_PATH}?${query.toString()}`, { method: 'GET' }, signal))
    },

    async reviewContent(requirementId: string, reviewId: string, signal?: AbortSignal): Promise<WorkbenchArtifactContentResult> {
      const query = new URLSearchParams({ kind: 'review', requirementId, reviewId })
      return artifactContentResult(await request(`${WORKBENCH_ARTIFACTS_PATH}?${query.toString()}`, { method: 'GET' }, signal))
    },
  }
}

async function artifactWriteResult(response: Response | WorkbenchFailure): Promise<WorkbenchArtifactWriteResult> {
  if ('kind' in response) return response
  if (!response.ok) return parseErrorBody(response)
  const parsed: unknown = await response.json()
  if (!isArtifactWriteResponseOk(parsed)) return { kind: 'http-error', status: response.status }
  return { kind: 'ok', revision: parsed.revision, anchor: parsed }
}

async function artifactContentResult(response: Response | WorkbenchFailure): Promise<WorkbenchArtifactContentResult> {
  if ('kind' in response) return response
  if (!response.ok) return parseErrorBody(response)
  const parsed: unknown = await response.json()
  if (!isArtifactContentResponse(parsed)) return { kind: 'http-error', status: response.status }
  return { kind: 'ok', content: parsed.content, contentTampered: parsed.contentTampered }
}

export type WorkbenchFetcher = ReturnType<typeof createWorkbenchFetcher>
