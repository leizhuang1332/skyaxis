/**
 * Workbench endpoint client (browser half).
 *
 * Same-origin fetch with no explicit auth headers — the connection layer's
 * cookie rides automatically (the requirements fetcher precedent). Errors
 * branch three ways: transport failures (`network`), non-2xx with a parsed
 * error body, and 2xx payloads checked by the hand-written protocol guards.
 *
 * Artifact reads/writes ride text/plain bodies with query discrimination
 * (the prd-upload shape). The scan endpoint gained its UI consumer in the
 * 挂账轮 (the scan modal) — until then it deliberately had no method here
 * (wire without a consumer stays unopened, the D3 logic).
 */
import {
  WORKBENCH_ARTIFACTS_PATH,
  WORKBENCH_DECLARE_PATH,
  WORKBENCH_KNOWLEDGE_PATH,
  WORKBENCH_PATH,
  WORKBENCH_SCAN_PATH,
} from '../../workbench-shared/protocol.js'
import type {
  ArtifactWriteResponseOk,
  DeclareCommitResponseOk,
  DeclareFetchResponse,
  DeclarePreviewResponseOk,
  DevDeclareSeedMissing,
  ErrorResponse,
  PlanFileExistsRow,
  ReviewFileExistsRow,
  ReviewFetchResponse,
  SeedMissingReason,
  SplitBaselinePrd,
  WorkbenchFinding,
  WorkbenchKnowledgeListResponse,
  WorkbenchKnowledgeMutateRequestBody,
  WorkbenchKnowledgeRecord,
  WorkbenchKnowledgeSaveResponseOk,
  WorkbenchListResponse,
  WorkbenchMutateRequestBody,
  WorkbenchRecord,
  WorkbenchSaveResponseOk,
  WorkbenchScanResponseOk,
} from '../../workbench-shared/protocol.js'
import {
  isArtifactContentResponse,
  isArtifactWriteResponseOk,
  isDeclareCommitResponse,
  isDeclareFetchResponse,
  isDeclarePreviewResponse,
  isErrorResponse,
  isReviewFetchResponse,
  isWorkbenchDetailResponse,
  isWorkbenchKnowledgeListResponse,
  isWorkbenchKnowledgeSaveResponseOk,
  isWorkbenchListResponse,
  isWorkbenchSaveResponseOk,
  isWorkbenchScanResponse,
} from '../../workbench-shared/protocol.js'

export type WorkbenchFailure =
  | { readonly kind: 'network' }
  | { readonly kind: 'http-error'; readonly status: number; readonly code?: string; readonly currentRevision?: number }

export type WorkbenchListResult =
  | { readonly kind: 'ok'; readonly revision: number; readonly records: readonly WorkbenchRecord[] }
  | { readonly kind: 'degraded'; readonly reason: 'parse' | 'schema' | 'io'; readonly hasBackup: boolean }
  | WorkbenchFailure

export type WorkbenchKnowledgeListResult =
  | { readonly kind: 'ok'; readonly revision: number; readonly records: readonly WorkbenchKnowledgeRecord[] }
  | { readonly kind: 'degraded'; readonly reason: 'parse' | 'schema' | 'io'; readonly hasBackup: boolean }
  | WorkbenchFailure

export type WorkbenchKnowledgeMutateResult =
  | { readonly kind: 'ok'; readonly revision: number; readonly record: WorkbenchKnowledgeRecord }
  | WorkbenchFailure

export type WorkbenchDetailResult =
  | {
    readonly kind: 'ok'
    readonly revision: number
    readonly record: WorkbenchRecord | null
    readonly planFileExists: readonly PlanFileExistsRow[]
    readonly reviewFileExists: readonly ReviewFileExistsRow[]
    readonly releaseDrifted: readonly string[]
  }
  | WorkbenchFailure

export type WorkbenchMutateResult =
  | { readonly kind: 'ok'; readonly revision: number; readonly record: WorkbenchRecord; readonly seedMissing?: SeedMissingReason; readonly seedScan?: string; readonly seedShell?: boolean; readonly devSeedMissing?: DevDeclareSeedMissing }
  | WorkbenchFailure

export type WorkbenchArtifactWriteResult =
  | { readonly kind: 'ok'; readonly revision: number; readonly anchor: ArtifactWriteResponseOk }
  | WorkbenchFailure

export type WorkbenchArtifactContentResult =
  | { readonly kind: 'ok'; readonly content: string; readonly contentTampered: boolean }
  | WorkbenchFailure

export type DeclareFetchResult =
  | { readonly kind: 'ok'; readonly response: DeclareFetchResponse }
  | WorkbenchFailure

export type ReviewFetchResult =
  | { readonly kind: 'ok'; readonly response: ReviewFetchResponse }
  | WorkbenchFailure

export type DeclarePreviewResult =
  | { readonly kind: 'ok'; readonly preview: DeclarePreviewResponseOk }
  | WorkbenchFailure

export type DeclareImportResult =
  | { readonly kind: 'ok'; readonly committed: DeclareCommitResponseOk }
  | WorkbenchFailure

export type WorkbenchScanResult =
  | { readonly kind: 'ok'; readonly response: WorkbenchScanResponseOk }
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
        releaseDrifted: [...parsed.releaseDrifted],
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
      return {
        kind: 'ok',
        revision: ok.revision,
        record: ok.record,
        ...(ok.seedMissing !== undefined ? { seedMissing: ok.seedMissing } : {}),
        ...(ok.seedScan !== undefined ? { seedScan: ok.seedScan } : {}),
        ...(ok.seedShell !== undefined ? { seedShell: ok.seedShell } : {}),
        ...(ok.devSeedMissing !== undefined ? { devSeedMissing: ok.devSeedMissing } : {}),
      }
    },

    async advanceStage(requirementId: string, expectedRevision: number, stage: WorkbenchRecord['stage'], note?: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'advanceStage', stage, ...(note !== undefined ? { note } : {}) }, signal)
    },

    async saveFinding(requirementId: string, expectedRevision: number, finding: Omit<WorkbenchFinding, 'id' | 'createdAt'> & { id?: string }, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'saveFinding', finding: { ...finding } }, signal)
    },

    // --- Work-package CRUD (hard gate ①: pre-approval only) ---

    async saveWorkPackage(requirementId: string, expectedRevision: number, workPackage: { id?: string; title: string; boundary: string; dependsOn: readonly string[]; parallel?: boolean; covers: readonly string[] }, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'saveWorkPackage', workPackage: { ...workPackage } }, signal)
    },

    async removeWorkPackage(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'removeWorkPackage', id }, signal)
    },

    async moveWorkPackage(requirementId: string, expectedRevision: number, id: string, direction: 'up' | 'down', signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'moveWorkPackage', id, direction }, signal)
    },

    // --- Hard gates ① (split) and the work-package state machine ---

    async approveSplit(requirementId: string, expectedRevision: number, baseline?: { prd: readonly SplitBaselinePrd[] }, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'approveSplit', ...(baseline !== undefined ? { baseline: { prd: [...baseline.prd] } } : {}) }, signal)
    },

    async revokeSplitApproval(requirementId: string, expectedRevision: number, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'revokeSplitApproval' }, signal)
    },

    /** 0007 定稿软门: stamp understandApprovedAt + mint the credential baseline (zero payload — host derives). */
    async approveUnderstand(requirementId: string, expectedRevision: number, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'approveUnderstand' }, signal)
    },

    /** 0007 定稿软门: strip the stamp + baseline together. */
    async revokeUnderstand(requirementId: string, expectedRevision: number, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'revokeUnderstand' }, signal)
    },

    /** P5b §7.6: archive the approved list (all → dropped) and reopen for re-planning. */
    async reSplit(requirementId: string, expectedRevision: number, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'reSplit' }, signal)
    },

    /** P5b §7.6「确认仍有效」: re-mint the stale baseline (PRD snapshot), list untouched. */
    async confirmSplitStillValid(requirementId: string, expectedRevision: number, baseline: { prd: readonly SplitBaselinePrd[] }, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'confirmSplitStillValid', baseline: { prd: [...baseline.prd] } }, signal)
    },

    async approvePlan(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'approvePlan', id }, signal)
    },

    async startWorkPackage(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'startWorkPackage', id }, signal)
    },

    async markWorkPackageBuilt(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'markWorkPackageBuilt', id }, signal)
    },

    async acceptWorkPackage(requirementId: string, expectedRevision: number, id: string, result: 'pass' | 'fail', note?: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'acceptWorkPackage', id, result, ...(note !== undefined ? { note } : {}) }, signal)
    },

    async reopenWorkPackage(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'reopenWorkPackage', id }, signal)
    },

    async dropWorkPackage(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'dropWorkPackage', id }, signal)
    },

    /** Un-drop (pre-approval list edit): the restored status derives from the plan chain. */
    async restoreWorkPackage(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'restoreWorkPackage', id }, signal)
    },

    // --- Criteria (under the split lock like the list itself) ---

    async saveCriterion(requirementId: string, expectedRevision: number, criterion: { id?: string; text: string; sourceSection?: string }, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'saveCriterion', criterion: { ...criterion } }, signal)
    },

    async removeCriterion(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'removeCriterion', id }, signal)
    },

    // --- P3a: release items + rollback-plan stamp (outside the split gate) ---

    async saveReleaseItem(requirementId: string, expectedRevision: number, releaseItem: { id?: string; type: 'sql' | 'config' | 'flag' | 'mq' | 'other'; title: string; content: string; envs: readonly string[]; workPackageId?: string; sessionId?: string; note?: string }, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'saveReleaseItem', releaseItem: { ...releaseItem } }, signal)
    },

    async removeReleaseItem(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'removeReleaseItem', id }, signal)
    },

    async confirmReleaseItem(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'confirmReleaseItem', id }, signal)
    },

    async markReleaseItemApplied(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'markReleaseItemApplied', id }, signal)
    },

    async markReleaseItemVerified(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'markReleaseItemVerified', id }, signal)
    },

    async rollbackReleaseItem(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'rollbackReleaseItem', id }, signal)
    },

    async confirmRollbackPlan(requirementId: string, expectedRevision: number, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'confirmRollbackPlan' }, signal)
    },

    async revokeRollbackPlan(requirementId: string, expectedRevision: number, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'revokeRollbackPlan' }, signal)
    },

    // --- P4: review verdicts + manual candidate distillation ---

    async saveReviewVerdict(requirementId: string, expectedRevision: number, reportId: string, verdict: { id?: string; title: string; severity: 'high' | 'medium' | 'low'; verdict: 'confirmed' | 'rejected'; disposition?: 'to-fix' | 'fixed' | 'wont-fix'; note?: string }, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'saveReviewVerdict', reportId, verdict: { ...verdict } }, signal)
    },

    async removeReviewVerdict(requirementId: string, expectedRevision: number, reportId: string, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'removeReviewVerdict', reportId, id }, signal)
    },

    async removeReviewReport(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'removeReviewReport', id }, signal)
    },

    async saveKnowledgeCandidate(requirementId: string, expectedRevision: number, candidate: { title: string; draft: string; type: 'business' | 'convention' }, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'saveKnowledgeCandidate', candidate: { ...candidate } }, signal)
    },

    // --- P2: session binding + knowledge candidates (main union) ---

    async bindSession(requirementId: string, expectedRevision: number, id: string, sessionId: string, purpose: 'analysis' | 'dev' | 'review', signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'bindSession', id, sessionId, purpose }, signal)
    },

    async activateKnowledgeCandidate(requirementId: string, expectedRevision: number, id: string, knowledge: { scope: 'global' | 'workspace' | 'requirement'; type: 'business' | 'convention'; trigger: { mode: 'always' | 'keyword' | 'manual' | 'path'; value?: string }; path?: string }, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'activateKnowledgeCandidate', id, knowledge: { ...knowledge } }, signal)
    },

    async editKnowledgeCandidate(requirementId: string, expectedRevision: number, id: string, candidate: { title: string; draft: string; type: 'business' | 'convention' }, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'editKnowledgeCandidate', id, candidate: { ...candidate } }, signal)
    },

    async dismissKnowledgeCandidate(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'dismissKnowledgeCandidate', id }, signal)
    },

    // --- P2: knowledge.yaml route (its OWN union + optimistic lock) ---

    async knowledgeList(requirementId: string, workspacePath?: string, signal?: AbortSignal): Promise<WorkbenchKnowledgeListResult> {
      const query = new URLSearchParams({ requirementId })
      // P5a: workspace rows join the listing only when filtered by the
      // requirement's workspace (the user-ratified visibility ruling).
      if (workspacePath !== undefined && workspacePath !== '') query.set('workspacePath', workspacePath)
      const response = await request(
        `${WORKBENCH_KNOWLEDGE_PATH}?${query.toString()}`,
        { method: 'GET' },
        signal,
      )
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const body: unknown = await response.json()
      if (!isWorkbenchKnowledgeListResponse(body)) return { kind: 'http-error', status: response.status }
      const parsed: WorkbenchKnowledgeListResponse = body
      if (parsed.ok) return { kind: 'ok', revision: parsed.revision, records: [...parsed.records] }
      return { kind: 'degraded', reason: parsed.reason, hasBackup: parsed.hasBackup }
    },

    async knowledgeMutate(body: WorkbenchKnowledgeMutateRequestBody, signal?: AbortSignal): Promise<WorkbenchKnowledgeMutateResult> {
      const response = await request(WORKBENCH_KNOWLEDGE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, signal)
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const parsed: unknown = await response.json()
      if (!isWorkbenchKnowledgeSaveResponseOk(parsed)) return { kind: 'http-error', status: response.status }
      const ok: WorkbenchKnowledgeSaveResponseOk = parsed
      return { kind: 'ok', revision: ok.revision, record: ok.record }
    },

    async saveKnowledge(expectedRevision: number, knowledge: { id?: string; scope: 'global' | 'workspace' | 'requirement'; type: 'business' | 'convention'; title: string; content: string; path?: string; requirementId?: string; trigger: { mode: 'always' | 'path' | 'keyword' | 'manual'; value?: string } }, signal?: AbortSignal): Promise<WorkbenchKnowledgeMutateResult> {
      return this.knowledgeMutate({ expectedRevision, action: 'saveKnowledge', knowledge: { ...knowledge } }, signal)
    },

    async archiveKnowledge(expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchKnowledgeMutateResult> {
      return this.knowledgeMutate({ expectedRevision, action: 'archiveKnowledge', id }, signal)
    },

    async removeFinding(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'removeFinding', id }, signal)
    },

    // --- 回传轮: analysis proposals (bind/seed target the container; adopt/
    // dismiss target a host-minted row by id — no proposal content rides the wire) ---

    async bindAnalysisSession(requirementId: string, expectedRevision: number, sessionId: string, anchor?: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'bindAnalysisSession', sessionId, ...(anchor !== undefined ? { anchor } : {}) }, signal)
    },

    async seedAnalysis(requirementId: string, expectedRevision: number, sessionId: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'seedAnalysis', sessionId }, signal)
    },

    // --- 0012 两步化: planning adoption + split proposals (same no-content
    // discipline — adoptPlan is payload-free, seedSplit reads the file) ---

    async adoptPlan(requirementId: string, expectedRevision: number, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'adoptPlan' }, signal)
    },

    async revokePlanAdoption(requirementId: string, expectedRevision: number, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'revokePlanAdoption' }, signal)
    },

    async bindSplitSession(requirementId: string, expectedRevision: number, sessionId: string, anchor?: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'bindSplitSession', sessionId, ...(anchor !== undefined ? { anchor } : {}) }, signal)
    },

    async seedSplit(requirementId: string, expectedRevision: number, sessionId: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'seedSplit', sessionId }, signal)
    },

    async adoptSplitProposals(requirementId: string, expectedRevision: number, refs: readonly string[], signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'adoptSplitProposals', refs: [...refs] }, signal)
    },

    async dismissWorkPackageProposal(requirementId: string, expectedRevision: number, ref: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'dismissWorkPackageProposal', ref }, signal)
    },

    async adoptFindingProposal(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'adoptFindingProposal', id }, signal)
    },

    async dismissFindingProposal(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'dismissFindingProposal', id }, signal)
    },

    async adoptCriterionProposal(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'adoptCriterionProposal', id }, signal)
    },

    async dismissCriterionProposal(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'dismissCriterionProposal', id }, signal)
    },

    async answerAnalysisClarification(requirementId: string, expectedRevision: number, id: string, answer: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'answerAnalysisClarification', id, answer }, signal)
    },

    async dismissAnalysisClarification(requirementId: string, expectedRevision: number, id: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'dismissAnalysisClarification', id }, signal)
    },

    // --- 0016 P1a: dev-declare container (seed names the package only — the
    // host derives the binding and reads the session; dismiss is the sole
    // client-writable adjudication) ---

    async seedDevDeclare(requirementId: string, expectedRevision: number, workPackageId: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'seedDevDeclare', workPackageId }, signal)
    },

    async adjudicateDevDeclare(requirementId: string, expectedRevision: number, workPackageId: string, signal?: AbortSignal): Promise<WorkbenchMutateResult> {
      return this.mutate({ expectedRevision, requirementId, action: 'adjudicateDevDeclare', workPackageId, adjudication: 'dismissed' }, signal)
    },

    async writePlan(requirementId: string, workPackageId: string, text: string, expectedRevision: number, note?: string, signal?: AbortSignal): Promise<WorkbenchArtifactWriteResult> {
      const query = new URLSearchParams({ kind: 'plan', requirementId, workPackageId, expectedRevision: String(expectedRevision) })
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

    async planContent(requirementId: string, workPackageId: string, version: number, signal?: AbortSignal): Promise<WorkbenchArtifactContentResult> {
      const query = new URLSearchParams({ kind: 'plan', requirementId, workPackageId, version: String(version) })
      return artifactContentResult(await request(`${WORKBENCH_ARTIFACTS_PATH}?${query.toString()}`, { method: 'GET' }, signal))
    },

    async reviewContent(requirementId: string, reviewId: string, signal?: AbortSignal): Promise<WorkbenchArtifactContentResult> {
      const query = new URLSearchParams({ kind: 'review', requirementId, reviewId })
      return artifactContentResult(await request(`${WORKBENCH_ARTIFACTS_PATH}?${query.toString()}`, { method: 'GET' }, signal))
    },

    /** 文件交付轮: the workspace analysis report file (kind=analysis-report face; 404 = honest missing, the panel renders it). */
    async analysisReportContent(requirementId: string, signal?: AbortSignal): Promise<WorkbenchArtifactContentResult> {
      const query = new URLSearchParams({ kind: 'analysis-report', requirementId })
      return artifactContentResult(await request(`${WORKBENCH_ARTIFACTS_PATH}?${query.toString()}`, { method: 'GET' }, signal))
    },

    /** 0008: the requirement-baseline doc file (kind=requirement-doc face; 404 = honest missing). */
    async requirementDocContent(requirementId: string, signal?: AbortSignal): Promise<WorkbenchArtifactContentResult> {
      const query = new URLSearchParams({ kind: 'requirement-doc', requirementId })
      return artifactContentResult(await request(`${WORKBENCH_ARTIFACTS_PATH}?${query.toString()}`, { method: 'GET' }, signal))
    },

    /** 0012: the technical planning doc file (kind=planning-doc face; 404 = honest missing). */
    async planningDocContent(requirementId: string, signal?: AbortSignal): Promise<WorkbenchArtifactContentResult> {
      const query = new URLSearchParams({ kind: 'planning-doc', requirementId })
      return artifactContentResult(await request(`${WORKBENCH_ARTIFACTS_PATH}?${query.toString()}`, { method: 'GET' }, signal))
    },

    /** 0012: the split result file (kind=split-result face; 404 = honest missing). */
    async splitResultContent(requirementId: string, signal?: AbortSignal): Promise<WorkbenchArtifactContentResult> {
      const query = new URLSearchParams({ kind: 'split-result', requirementId })
      return artifactContentResult(await request(`${WORKBENCH_ARTIFACTS_PATH}?${query.toString()}`, { method: 'GET' }, signal))
    },

    // --- P3b: declare-block route (fetch / preview / commit) ---

    async declareFetch(sessionId: string, signal?: AbortSignal): Promise<DeclareFetchResult> {
      const response = await request(`${WORKBENCH_DECLARE_PATH}?sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET' }, signal)
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const parsed: unknown = await response.json()
      if (!isDeclareFetchResponse(parsed)) return { kind: 'http-error', status: response.status }
      return { kind: 'ok', response: parsed }
    },

    /** P5b: fetch a session's review report (whole assistant message carrying a `# skyaxis-review` block). */
    async reviewFetch(sessionId: string, signal?: AbortSignal): Promise<ReviewFetchResult> {
      const response = await request(`${WORKBENCH_DECLARE_PATH}?kind=review&sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET' }, signal)
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const parsed: unknown = await response.json()
      if (!isReviewFetchResponse(parsed)) return { kind: 'http-error', status: response.status }
      return { kind: 'ok', response: parsed }
    },

    /** Global orphan/missing/trash reconciliation (挂账轮 UI consumer). */
    async scan(signal?: AbortSignal): Promise<WorkbenchScanResult> {
      const response = await request(WORKBENCH_SCAN_PATH, { method: 'GET' }, signal)
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const parsed: unknown = await response.json()
      if (!isWorkbenchScanResponse(parsed)) return { kind: 'http-error', status: response.status }
      return { kind: 'ok', response: parsed }
    },

    async declarePreview(requirementId: string, expectedRevision: number, text: string, devDeclare?: { workPackageId: string }, signal?: AbortSignal): Promise<DeclarePreviewResult> {
      const response = await request(WORKBENCH_DECLARE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedRevision,
          requirementId,
          dryRun: true,
          text,
          ...(devDeclare !== undefined ? { devDeclare: { workPackageId: devDeclare.workPackageId } } : {}),
        }),
      }, signal)
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const parsed: unknown = await response.json()
      if (!isDeclarePreviewResponse(parsed)) return { kind: 'http-error', status: response.status }
      return { kind: 'ok', preview: parsed }
    },

    async declareImport(requirementId: string, expectedRevision: number, text: string, selected: readonly string[], sessionId: string | undefined, devDeclare?: { workPackageId: string }, signal?: AbortSignal): Promise<DeclareImportResult> {
      const response = await request(WORKBENCH_DECLARE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedRevision,
          requirementId,
          text,
          selected: [...selected],
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(devDeclare !== undefined ? { devDeclare: { workPackageId: devDeclare.workPackageId } } : {}),
        }),
      }, signal)
      if ('kind' in response) return response
      if (!response.ok) return parseErrorBody(response)
      const parsed: unknown = await response.json()
      if (!isDeclareCommitResponse(parsed)) return { kind: 'http-error', status: response.status }
      return { kind: 'ok', committed: parsed }
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
