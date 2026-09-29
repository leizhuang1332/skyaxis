/**
 * AI workbench wire protocol shared by both plugin halves (0006 P1b).
 *
 * Zero dependencies by design: the browser bundle inlines this file, so no
 * zod, no node builtins. The host half re-declares the same shapes as zod
 * schemas (workbench-host/types.ts) with a compile-time mutual-assignability
 * assertion — drift between the two is a type error, not a runtime surprise.
 *
 * Browser-side response validation uses the hand-written type guards at the
 * bottom (the official client precedent: manual guards over zod, keeping the
 * client bundle lean).
 *
 * Governance anchors (decisions/0005, all user-ratified 2026-09-29):
 * - D4-② conventional references — plan/review document paths are derived by
 *   host-side pure functions from (requirementId, workPackageId, version /
 *   reviewId); the ledger and this wire NEVER carry a path. The narrow id
 *   guards below are the wire-side defense layer; the host re-asserts them
 *   before every path join.
 * - D4-③ version is host-assigned (client sends content only); contentHash
 *   is host-computed sha256 and crosses the wire as a plain string.
 * - D4-⑤ semantic split — structural documents (plans, review reports) live
 *   as files under $DSH_HOME/skyaxis/workbench/<requirementId>/; short
 *   attribute snippets (findings.detail, knowledgeCandidates.draft,
 *   releaseItems.content) stay inline in workbench.yaml under
 *   WORKBENCH_INLINE_MAX_CHARS.
 * - Field-evolution discipline: every FUTURE field is optional/default with
 *   the guards relaxed in the same commit (0003 lesson). The first ledger
 *   release has no legacy data, so the initial shapes may require arrays —
 *   that protection is intentional (a hand-edited yaml missing a field
 *   degrades the whole file to schema-rejected, refusing to overwrite).
 */

// ---------------------------------------------------------------------------
// Limits and stage vocabulary (one truth for both halves)
// ---------------------------------------------------------------------------

/**
 * Hard cap for inline ledger text (UTF-16 code units, NOT bytes): host zod
 * `.max()`, host endpoint rejects, browser pre-checks — the PRD_CREATE_MAX_CHARS
 * three-consumer precedent (requirements-shared/prd-file.ts). Over-cap is
 * rejected with a "split it up" hint; exporting a copy is a distribution
 * artifact, not a remedy (decisions/0005 细化⑤).
 */
export const WORKBENCH_INLINE_MAX_CHARS = 32 * 1024
/** Artifact write cap in UTF-16 code units (plan/review markdown bodies). */
export const WORKBENCH_ARTIFACT_MAX_CHARS = 512 * 1024
/**
 * Artifact read byte cap. Must dominate the write cap's worst-case UTF-8
 * size (512K UTF-16 code units × 3 bytes/unit for CJK = 1536KiB), or a
 * document the host accepted becomes permanently unreadable via GET. 2MiB
 * covers it with margin; Markdown-preview freezing is a NEXT-round concern
 * (the S3 preview modal slices, the fetcher carries the string either way).
 */
export const WORKBENCH_ARTIFACT_MAX_READ_BYTES = 2 * 1024 * 1024

/**
 * Six fixed stages (verification folded into implement — D7). Order is the
 * rail order and the advance order; stages are skippable. 'closed' is a
 * terminal record state, not a rail chip.
 */
export const WORKBENCH_STAGES = [
  'understand',
  'plan',
  'implement',
  'review',
  'deliver',
  'retro',
] as const

export type WorkbenchStage = (typeof WORKBENCH_STAGES)[number]
export type WorkbenchStageOrClosed = WorkbenchStage | 'closed'

// ---------------------------------------------------------------------------
// Narrow id predicates (wire defense layer 1 — decisions/0005 细化②)
// ---------------------------------------------------------------------------

/** workPackageId pattern: WP followed by a positive integer, no leading zero. */
export function isWorkPackageId(value: string): boolean {
  return /^WP[1-9]\d*$/.test(value)
}

/** Plan version: a positive integer (host-assigned, max(existing)+1). */
export function isPlanVersion(version: number): boolean {
  return Number.isInteger(version) && version >= 1
}

/** reviewId pattern: url-token, 1-64 chars (host-minted uuid fits). */
export function isReviewId(value: string): boolean {
  return /^[A-Za-z0-9-]{1,64}$/.test(value)
}

// ---------------------------------------------------------------------------
// Records (workbench.yaml — one per requirement)
// ---------------------------------------------------------------------------

/**
 * One plan document version. Reference-only metadata: the file path is
 * derived by the host from the convention (plans/<workPackageId>-v<version>.md);
 * no path ever crosses this wire. contentHash is host sha256 over the UTF-8
 * bytes on disk; legacy entries without it read back untampered-silent
 * (field-evolution discipline).
 */
export interface PlanEntry {
  readonly version: number
  /** Set by the approve gate (hard gate ②) — never client-writable. */
  readonly approvedAt?: string
  readonly note?: string
  readonly contentHash?: string
}

export interface WorkbenchSessionBinding {
  readonly sessionId: string
  readonly purpose: 'analysis' | 'dev' | 'review'
  readonly boundAt: string
}

export interface WorkbenchCommitRef {
  readonly hash: string
  readonly repoId?: string
  readonly note: string
  readonly at: string
}

export interface WorkbenchAcceptance {
  readonly at: string
  readonly result: 'pass' | 'fail'
  readonly note?: string
}

export interface WorkbenchWorkPackage {
  /** 'WP1', 'WP2', … — host-minted sequence, see isWorkPackageId. */
  readonly id: string
  readonly title: string
  readonly boundary: string
  readonly order: number
  readonly dependsOn: readonly string[]
  readonly parallel?: boolean
  /** criteriaId references this record's criteria[].id. */
  readonly covers: readonly string[]
  readonly status:
    | 'planned'
    | 'plan-draft'
    | 'plan-approved'
    | 'in-dev'
    | 'built'
    | 'accepted'
    | 'dropped'
  readonly plans: readonly PlanEntry[]
  readonly sessions: readonly WorkbenchSessionBinding[]
  readonly commits: readonly WorkbenchCommitRef[]
  readonly acceptances: readonly WorkbenchAcceptance[]
}

export interface WorkbenchFinding {
  /** uuid, minted host-side on create. */
  readonly id: string
  readonly category:
    | 'feasibility'
    | 'conflict'
    | 'compatibility'
    | 'risk'
    | 'capacity'
    | 'other'
  readonly severity: 'high' | 'medium' | 'low'
  readonly title: string
  /** Inline ledger text — capped by WORKBENCH_INLINE_MAX_CHARS. */
  readonly detail: string
  readonly status: 'open' | 'resolved' | 'wont-fix'
  readonly resolution?: string
  readonly sessionId?: string
  readonly createdAt: string
}

export interface WorkbenchCriterion {
  /** 'C1', 'C2', … — host-minted sequence. */
  readonly id: string
  readonly text: string
  readonly sourceSection?: string
  /** workPackageId references (maintained workPackage-side; carried read-only here). */
  readonly coveredBy: readonly string[]
}

export interface ReviewVerdict {
  readonly title: string
  readonly severity: 'high' | 'medium' | 'low'
  readonly verdict: 'confirmed' | 'rejected'
  readonly disposition?: 'to-fix' | 'fixed' | 'wont-fix'
  readonly note?: string
}

/**
 * One review report reference. Converged per decisions/0005 细化①② (the
 * research 0006 §6.1 sketch kept a `doc` field — superseded): the report
 * body lives at reviews/<reviewId>.md, the ledger holds metadata only.
 */
export interface ReviewReportEntry {
  /** reviewId — see isReviewId; host-minted uuid. */
  readonly id: string
  readonly at: string
  readonly title?: string
  readonly contentHash?: string
  readonly verdicts: readonly ReviewVerdict[]
}

export interface ReleaseItem {
  /** 'R0001', 'R0002', … — host-minted sequence. */
  readonly id: string
  readonly type: 'sql' | 'config' | 'flag' | 'mq' | 'other'
  readonly title: string
  /** Inline ledger text — capped by WORKBENCH_INLINE_MAX_CHARS. */
  readonly content: string
  /** Host sha256 at registration — drift detection (Flyway checksum mode). */
  readonly contentHash: string
  readonly envs: readonly string[]
  readonly workPackageId?: string
  readonly sessionId?: string
  readonly status: 'pending' | 'confirmed' | 'applied' | 'verified' | 'rolled-back'
  readonly appliedAt?: string
}

export interface KnowledgeCandidate {
  /** uuid, minted host-side. */
  readonly id: string
  readonly title: string
  /** Inline ledger text — capped by WORKBENCH_INLINE_MAX_CHARS. */
  readonly draft: string
  readonly type: 'business' | 'convention'
  readonly proposedSessionId?: string
  readonly at: string
  readonly status: 'pending' | 'promoted' | 'dismissed'
}

export interface WorkbenchStageChange {
  readonly stage: WorkbenchStageOrClosed
  readonly at: string
  readonly note?: string
}

export interface WorkbenchRecord {
  /**
   * Join key against requirements.yaml ids — tolerant join, no foreign key
   * (the 0002 boundary). A workbench record may outlive its requirement
   * (orphan-tolerated until the D6 cascade or manual cleanup collects it).
   */
  readonly requirementId: string
  readonly stage: WorkbenchStageOrClosed
  readonly stageHistory: readonly WorkbenchStageChange[]
  /**
   * Hard gate ① stamp (decisions/0006-era second knife): presence = the work
   * package list × coverage contract is approved — S2 goes read-only, the
   * state-machine actions and plan writes unlock; revoke strips the stamp
   * (the list is preserved) and re-locks everything. Host-set-only, like
   * plans[].approvedAt; no approval-history array (the "history preserved"
   * wording refers to the LIST surviving a revoke, not an audit trail).
   */
  readonly splitApprovedAt?: string
  readonly criteria: readonly WorkbenchCriterion[]
  readonly findings: readonly WorkbenchFinding[]
  readonly workPackages: readonly WorkbenchWorkPackage[]
  readonly releaseItems: readonly ReleaseItem[]
  readonly reviewReports: readonly ReviewReportEntry[]
  readonly knowledgeCandidates: readonly KnowledgeCandidate[]
}

// ---------------------------------------------------------------------------
// Record mutation flow — same-path POST discriminated union.
//
// Only the actions with a live consumer surface this round are open
// (the D3 wire-narrowing logic); the ledger schema above is already
// full-field. Any action whose target record does not exist implicitly
// creates an empty record first (stage 'understand' + first stageHistory
// entry) — the uuid-fallback precedent at requirements endpoint.ts:104.
// GET never creates (read paths have zero side effects).
// ---------------------------------------------------------------------------

export interface AdvanceStageRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'advanceStage'
  readonly stage: WorkbenchStageOrClosed
  readonly note?: string
}

export interface SaveFindingRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'saveFinding'
  /** id present = edit, absent = create (id minted host-side). */
  readonly finding: {
    readonly id?: string
    readonly category: WorkbenchFinding['category']
    readonly severity: WorkbenchFinding['severity']
    readonly title: string
    readonly detail: string
    readonly status: WorkbenchFinding['status']
    readonly resolution?: string
    readonly sessionId?: string
  }
}

export interface RemoveFindingRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'removeFinding'
  readonly id: string
}

// --- Work-package CRUD (hard gate ①: pre-approval only) ---

export interface SaveWorkPackageRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'saveWorkPackage'
  /** id present = edit (present fields overwrite), absent = create (host mints WP<max+1>). */
  readonly workPackage: {
    readonly id?: string
    readonly title: string
    readonly boundary: string
    readonly dependsOn: readonly string[]
    readonly parallel?: boolean
    readonly covers: readonly string[]
  }
}

export interface RemoveWorkPackageRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'removeWorkPackage'
  readonly id: string
}

export interface MoveWorkPackageRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'moveWorkPackage'
  readonly id: string
  readonly direction: 'up' | 'down'
}

// --- Hard gates ① (split) and the work-package state machine ---

export interface ApproveSplitRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'approveSplit'
}

export interface RevokeSplitApprovalRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'revokeSplitApproval'
}

export interface ApprovePlanRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'approvePlan'
  readonly id: string
}

export interface StartWorkPackageRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'startWorkPackage'
  readonly id: string
}

export interface MarkWorkPackageBuiltRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'markWorkPackageBuilt'
  readonly id: string
}

export interface AcceptWorkPackageRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'acceptWorkPackage'
  readonly id: string
  readonly result: 'pass' | 'fail'
  /** Required when result is 'fail' — the rework reason enters the acceptance history. */
  readonly note?: string
}

export interface ReopenWorkPackageRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'reopenWorkPackage'
  readonly id: string
}

export interface DropWorkPackageRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'dropWorkPackage'
  readonly id: string
}

/**
 * Un-drop, pre-approval only (a list edit — dropping EXCLUDED a package from
 * the plan, and the plan contract is editable only while unapproved, the
 * same locked-split rule as saveWorkPackage). The restored status derives
 * from the surviving plan chain so the package is never stranded between
 * "cannot start" and "nothing left to approve".
 */
export interface RestoreWorkPackageRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'restoreWorkPackage'
  readonly id: string
}

// --- Criteria (S1; covered under the split lock like the list itself) ---

export interface SaveCriterionRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'saveCriterion'
  /** id present = edit, absent = create (host mints C<max+1>). */
  readonly criterion: {
    readonly id?: string
    readonly text: string
    readonly sourceSection?: string
  }
}

export interface RemoveCriterionRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'removeCriterion'
  readonly id: string
}

export type WorkbenchMutateRequestBody =
  | AdvanceStageRequest
  | SaveFindingRequest
  | RemoveFindingRequest
  | SaveWorkPackageRequest
  | RemoveWorkPackageRequest
  | MoveWorkPackageRequest
  | ApproveSplitRequest
  | RevokeSplitApprovalRequest
  | ApprovePlanRequest
  | StartWorkPackageRequest
  | MarkWorkPackageBuiltRequest
  | AcceptWorkPackageRequest
  | ReopenWorkPackageRequest
  | DropWorkPackageRequest
  | RestoreWorkPackageRequest
  | SaveCriterionRequest
  | RemoveCriterionRequest

// ---------------------------------------------------------------------------
// Artifact documents flow — WORKBENCH_ARTIFACTS_PATH, query-discriminated,
// plain-text bodies (the prd / prd-upload two-path precedent: JSON inline
// fields under a 32K-code-unit cap and markdown bodies under a 512K cap are
// two different body semantics and never share an endpoint).
//
//   POST ?kind=plan&requirementId=<uuid>&workPackageId=<M#>[&note=<urlenc>]&expectedRevision=<n>
//        body: text/plain markdown → ArtifactWriteResponseOk (version host-assigned)
//   POST ?kind=review&requirementId=<uuid>[&title=<urlenc>]&expectedRevision=<n>
//        body: text/plain markdown → ArtifactWriteResponseOk (reviewId host uuid)
//   GET  ?kind=plan&requirementId=<uuid>&workPackageId=<M#>&version=<n>
//   GET  ?kind=review&requirementId=<uuid>&reviewId=<id>
//        → ArtifactContentResponseOk (404 when the file is missing; hash
//          mismatch answers 200 + contentTampered, never silently, never
//          blocking — decisions/0005 细化④)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Route paths (host registers, browser calls — one source of truth)
// ---------------------------------------------------------------------------

export const WORKBENCH_PATH = '/api/skyaxis/workbench'
export const WORKBENCH_ARTIFACTS_PATH = '/api/skyaxis/workbench/artifacts'
export const WORKBENCH_SCAN_PATH = '/api/skyaxis/workbench/scan'

// ---------------------------------------------------------------------------
// Wire envelopes
// ---------------------------------------------------------------------------

export interface WorkbenchListResponseOk {
  readonly ok: true
  readonly revision: number
  readonly records: readonly WorkbenchRecord[]
}

export interface WorkbenchListResponseDegraded {
  readonly ok: false
  readonly degraded: true
  readonly reason: 'parse' | 'schema' | 'io'
  readonly hasBackup: boolean
}

export type WorkbenchListResponse = WorkbenchListResponseOk | WorkbenchListResponseDegraded

/**
 * Per-requirement file-existence rows — a RESPONSE projection, not ledger
 * fields (the workspace directoryExists/registered precedent,
 * requirements-shared/protocol.ts:293-305). Flat rows keyed by
 * (workPackageId, version) / reviewId so the UI joins without pathing.
 */
export interface PlanFileExistsRow {
  readonly workPackageId: string
  readonly version: number
  readonly exists: boolean
}

export interface ReviewFileExistsRow {
  readonly reviewId: string
  readonly exists: boolean
}

export interface WorkbenchDetailResponseOk {
  readonly ok: true
  readonly revision: number
  /** null when this requirement has no workbench record yet. */
  readonly record: WorkbenchRecord | null
  readonly planFileExists: readonly PlanFileExistsRow[]
  readonly reviewFileExists: readonly ReviewFileExistsRow[]
}

export interface WorkbenchSaveResponseOk {
  readonly ok: true
  readonly revision: number
  readonly record: WorkbenchRecord
}

export interface ArtifactWriteResponseOk {
  readonly ok: true
  readonly revision: number
  readonly kind: 'plan' | 'review'
  /** Plan writes only. */
  readonly workPackageId?: string
  readonly version?: number
  /** Review writes only. */
  readonly reviewId?: string
}

export interface ArtifactContentResponseOk {
  readonly ok: true
  readonly content: string
  /** Ledger hash present AND disk bytes differ — warn, don't block. */
  readonly contentTampered: boolean
}

/**
 * One reconciliation row (scan endpoint). `name` carries the file NAME for
 * kind:'unknown' rows (convention-violating files) — names, never paths.
 */
export interface WorkbenchScanRow {
  readonly requirementId: string
  readonly kind: 'plan' | 'review' | 'unknown'
  readonly workPackageId?: string
  readonly version?: number
  readonly reviewId?: string
  readonly name?: string
}

export interface WorkbenchTrashRow {
  readonly requirementId: string
  /** Parsed from the .trash/<requirementId>-<ISO timestamp> directory name. */
  readonly deletedAt: string
}

export interface WorkbenchScanResponseOk {
  readonly ok: true
  /** On disk, unreferenced by the ledger — includes D6 revival-window files. */
  readonly orphans: readonly WorkbenchScanRow[]
  /** In the ledger, missing on disk — dangling references. */
  readonly missing: readonly WorkbenchScanRow[]
  readonly trash: readonly WorkbenchTrashRow[]
}

/** Error body for 4xx/5xx responses (mutate / artifacts / scan). */
export interface ErrorResponse {
  readonly ok: false
  readonly code:
    | 'bad-request'
    | 'not-found'
    | 'conflict'
    | 'unreadable-file'
    | 'locked-split'
    | 'locked-version'
    | 'too-large'
    | 'bad-content-type'
    | 'internal'
  readonly currentRevision?: number
}

// ---------------------------------------------------------------------------
// Hand-written type guards (browser side)
// ---------------------------------------------------------------------------

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

const STAGES_OR_CLOSED: readonly string[] = [...WORKBENCH_STAGES, 'closed']
const WORK_PACKAGE_STATUSES = ['planned', 'plan-draft', 'plan-approved', 'in-dev', 'built', 'accepted', 'dropped']
const SESSION_PURPOSES = ['analysis', 'dev', 'review']
const ACCEPTANCE_RESULTS = ['pass', 'fail']
const FINDING_CATEGORIES = ['feasibility', 'conflict', 'compatibility', 'risk', 'capacity', 'other']
const SEVERITIES = ['high', 'medium', 'low']
const FINDING_STATUSES = ['open', 'resolved', 'wont-fix']
const VERDICT_OUTCOMES = ['confirmed', 'rejected']
const DISPOSITIONS = ['to-fix', 'fixed', 'wont-fix']
const RELEASE_TYPES = ['sql', 'config', 'flag', 'mq', 'other']
const RELEASE_STATUSES = ['pending', 'confirmed', 'applied', 'verified', 'rolled-back']
const CANDIDATE_TYPES = ['business', 'convention']
const CANDIDATE_STATUSES = ['pending', 'promoted', 'dismissed']

function isPlanEntry(v: unknown): v is PlanEntry {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.version === 'number' && isPlanVersion(r.version)
    && (r.approvedAt === undefined || isString(r.approvedAt))
    && (r.note === undefined || isString(r.note))
    && (r.contentHash === undefined || isString(r.contentHash))
  )
}

function isWorkbenchSessionBinding(v: unknown): v is WorkbenchSessionBinding {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.sessionId) && r.sessionId.length > 0
    && isString(r.purpose) && SESSION_PURPOSES.includes(r.purpose)
    && isString(r.boundAt) && r.boundAt.length > 0
  )
}

function isWorkbenchCommitRef(v: unknown): v is WorkbenchCommitRef {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.hash) && r.hash.length > 0
    && (r.repoId === undefined || isString(r.repoId))
    && isString(r.note)
    && isString(r.at) && r.at.length > 0
  )
}

function isWorkbenchAcceptance(v: unknown): v is WorkbenchAcceptance {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.at) && r.at.length > 0
    && isString(r.result) && ACCEPTANCE_RESULTS.includes(r.result)
    && (r.note === undefined || isString(r.note))
  )
}

function isWorkbenchWorkPackage(v: unknown): v is WorkbenchWorkPackage {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.id) && r.id.length > 0 && isWorkPackageId(r.id)
    && isString(r.title) && r.title.length > 0
    && isString(r.boundary)
    && typeof r.order === 'number'
    && Array.isArray(r.dependsOn) && r.dependsOn.every((d) => isString(d) && isWorkPackageId(d))
    && (r.parallel === undefined || typeof r.parallel === 'boolean')
    && Array.isArray(r.covers) && r.covers.every((c) => isString(c) && c.length > 0)
    && isString(r.status) && WORK_PACKAGE_STATUSES.includes(r.status)
    && Array.isArray(r.plans) && r.plans.every(isPlanEntry)
    && Array.isArray(r.sessions) && r.sessions.every(isWorkbenchSessionBinding)
    && Array.isArray(r.commits) && r.commits.every(isWorkbenchCommitRef)
    && Array.isArray(r.acceptances) && r.acceptances.every(isWorkbenchAcceptance)
  )
}

function isWorkbenchFinding(v: unknown): v is WorkbenchFinding {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.id) && r.id.length > 0
    && isString(r.category) && FINDING_CATEGORIES.includes(r.category)
    && isString(r.severity) && SEVERITIES.includes(r.severity)
    && isString(r.title) && r.title.length > 0
    && isString(r.detail)
    && isString(r.status) && FINDING_STATUSES.includes(r.status)
    && (r.resolution === undefined || isString(r.resolution))
    && (r.sessionId === undefined || isString(r.sessionId))
    && isString(r.createdAt) && r.createdAt.length > 0
  )
}

function isWorkbenchCriterion(v: unknown): v is WorkbenchCriterion {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.id) && r.id.length > 0
    && isString(r.text)
    && (r.sourceSection === undefined || isString(r.sourceSection))
    && Array.isArray(r.coveredBy) && r.coveredBy.every((c) => isString(c) && isWorkPackageId(c))
  )
}

function isReviewVerdict(v: unknown): v is ReviewVerdict {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.title) && r.title.length > 0
    && isString(r.severity) && SEVERITIES.includes(r.severity)
    && isString(r.verdict) && VERDICT_OUTCOMES.includes(r.verdict)
    && (r.disposition === undefined || (isString(r.disposition) && DISPOSITIONS.includes(r.disposition)))
    && (r.note === undefined || isString(r.note))
  )
}

function isReviewReportEntry(v: unknown): v is ReviewReportEntry {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.id) && r.id.length > 0 && isReviewId(r.id)
    && isString(r.at) && r.at.length > 0
    && (r.title === undefined || isString(r.title))
    && (r.contentHash === undefined || isString(r.contentHash))
    && Array.isArray(r.verdicts) && r.verdicts.every(isReviewVerdict)
  )
}

function isReleaseItem(v: unknown): v is ReleaseItem {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.id) && r.id.length > 0
    && isString(r.type) && RELEASE_TYPES.includes(r.type)
    && isString(r.title) && r.title.length > 0
    && isString(r.content)
    && isString(r.contentHash) && r.contentHash.length > 0
    && Array.isArray(r.envs) && r.envs.every((e) => isString(e))
    && (r.workPackageId === undefined || (isString(r.workPackageId) && isWorkPackageId(r.workPackageId)))
    && (r.sessionId === undefined || isString(r.sessionId))
    && isString(r.status) && RELEASE_STATUSES.includes(r.status)
    && (r.appliedAt === undefined || isString(r.appliedAt))
  )
}

function isKnowledgeCandidate(v: unknown): v is KnowledgeCandidate {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.id) && r.id.length > 0
    && isString(r.title) && r.title.length > 0
    && isString(r.draft)
    && isString(r.type) && CANDIDATE_TYPES.includes(r.type)
    && (r.proposedSessionId === undefined || isString(r.proposedSessionId))
    && isString(r.at) && r.at.length > 0
    && isString(r.status) && CANDIDATE_STATUSES.includes(r.status)
  )
}

function isWorkbenchStageChange(v: unknown): v is WorkbenchStageChange {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.stage) && STAGES_OR_CLOSED.includes(r.stage)
    && isString(r.at) && r.at.length > 0
    && (r.note === undefined || isString(r.note))
  )
}

export function isWorkbenchRecord(v: unknown): v is WorkbenchRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.requirementId) && r.requirementId.length > 0
    && isString(r.stage) && STAGES_OR_CLOSED.includes(r.stage)
    && Array.isArray(r.stageHistory) && r.stageHistory.every(isWorkbenchStageChange)
    && (r.splitApprovedAt === undefined || (isString(r.splitApprovedAt) && r.splitApprovedAt.length > 0))
    && Array.isArray(r.criteria) && r.criteria.every(isWorkbenchCriterion)
    && Array.isArray(r.findings) && r.findings.every(isWorkbenchFinding)
    && Array.isArray(r.workPackages) && r.workPackages.every(isWorkbenchWorkPackage)
    && Array.isArray(r.releaseItems) && r.releaseItems.every(isReleaseItem)
    && Array.isArray(r.reviewReports) && r.reviewReports.every(isReviewReportEntry)
    && Array.isArray(r.knowledgeCandidates) && r.knowledgeCandidates.every(isKnowledgeCandidate)
  )
}

export function isWorkbenchListResponse(v: unknown): v is WorkbenchListResponse {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (r.ok === true) {
    return typeof r.revision === 'number' && Array.isArray(r.records) && r.records.every(isWorkbenchRecord)
  }
  return (
    r.ok === false && r.degraded === true
    && (r.reason === 'parse' || r.reason === 'schema' || r.reason === 'io')
    && typeof r.hasBackup === 'boolean'
  )
}

function isPlanFileExistsRow(v: unknown): v is PlanFileExistsRow {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.workPackageId) && isWorkPackageId(r.workPackageId)
    && typeof r.version === 'number' && isPlanVersion(r.version)
    && typeof r.exists === 'boolean'
  )
}

function isReviewFileExistsRow(v: unknown): v is ReviewFileExistsRow {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return isString(r.reviewId) && r.reviewId.length > 0 && typeof r.exists === 'boolean'
}

export function isWorkbenchDetailResponse(v: unknown): v is WorkbenchDetailResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    r.ok === true
    && typeof r.revision === 'number'
    && (r.record === null || isWorkbenchRecord(r.record))
    && Array.isArray(r.planFileExists) && r.planFileExists.every(isPlanFileExistsRow)
    && Array.isArray(r.reviewFileExists) && r.reviewFileExists.every(isReviewFileExistsRow)
  )
}

export function isWorkbenchSaveResponseOk(v: unknown): v is WorkbenchSaveResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return r.ok === true && typeof r.revision === 'number' && isWorkbenchRecord(r.record)
}

export function isArtifactWriteResponseOk(v: unknown): v is ArtifactWriteResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    r.ok === true
    && typeof r.revision === 'number'
    && (r.kind === 'plan' || r.kind === 'review')
    && (r.workPackageId === undefined || (isString(r.workPackageId) && isWorkPackageId(r.workPackageId)))
    && (r.version === undefined || (typeof r.version === 'number' && isPlanVersion(r.version)))
    && (r.reviewId === undefined || (isString(r.reviewId) && isReviewId(r.reviewId)))
  )
}

export function isArtifactContentResponse(v: unknown): v is ArtifactContentResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return r.ok === true && isString(r.content) && typeof r.contentTampered === 'boolean'
}

/**
 * Kind-coupled rows (the repos-pool addressSlotOk precedent — optional fields
 * are coupled, not independent): plan rows carry exactly (workPackageId, version),
 * review rows exactly reviewId, unknown rows exactly name. A row whose kind
 * and anchors disagree collapses to a guard failure instead of joining
 * halfway in the UI.
 */
function isWorkbenchScanRow(v: unknown): v is WorkbenchScanRow {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (!isString(r.requirementId) || r.requirementId.length === 0) return false
  if (r.kind === 'plan') {
    return (
      isString(r.workPackageId) && isWorkPackageId(r.workPackageId)
      && typeof r.version === 'number' && isPlanVersion(r.version)
      && r.reviewId === undefined && r.name === undefined
    )
  }
  if (r.kind === 'review') {
    return (
      isString(r.reviewId) && isReviewId(r.reviewId)
      && r.workPackageId === undefined && r.version === undefined && r.name === undefined
    )
  }
  if (r.kind === 'unknown') {
    return (
      isString(r.name) && r.name.length > 0
      && r.workPackageId === undefined && r.version === undefined && r.reviewId === undefined
    )
  }
  return false
}

function isWorkbenchTrashRow(v: unknown): v is WorkbenchTrashRow {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return isString(r.requirementId) && r.requirementId.length > 0 && isString(r.deletedAt) && r.deletedAt.length > 0
}

export function isWorkbenchScanResponse(v: unknown): v is WorkbenchScanResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    r.ok === true
    && Array.isArray(r.orphans) && r.orphans.every(isWorkbenchScanRow)
    && Array.isArray(r.missing) && r.missing.every(isWorkbenchScanRow)
    && Array.isArray(r.trash) && r.trash.every(isWorkbenchTrashRow)
  )
}

export function isErrorResponse(v: unknown): v is ErrorResponse {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    r.ok === false
    && isString(r.code)
    && (r.currentRevision === undefined || typeof r.currentRevision === 'number')
  )
}
