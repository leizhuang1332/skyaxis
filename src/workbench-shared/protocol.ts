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

/**
 * releaseItemId pattern: R + at least four digits (`R0001`). This is the
 * third id column and it was the ONE missing from this family — the host
 * mints zero-padded ids (ReleaseItemIdSchema `/^R\d{4,}$/`), so an unpadded
 * `R1` is a ledger-poisoning row: `save()` does not re-validate the schema
 * (only `load()` does), so the illegal id lands on disk and the NEXT load
 * degrades the whole file to schema-rejected — every requirement's
 * workbench goes unreadable at once (the P1b round-2 `coveredBy` incident,
 * milestones/0006). The wire guard is layer 1 against exactly that.
 */
export function isReleaseItemId(value: string): boolean {
  return /^R\d{4,}$/.test(value)
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
  /** Host-minted uuid (P4) — the per-row anchor for edit/remove; optional per the field-evolution discipline (pre-P4 rows carry none, addressed by full-row replace). */
  readonly id?: string
  readonly title: string
  readonly severity: 'high' | 'medium' | 'low'
  /**
   * 'proposed' (P5b) = an AI-proposed finding awaiting the user's ruling.
   * HOST-MINTED ONLY — the saveReviewVerdict input schema stays two-valued,
   * so a client can never write one (the ReleaseItem.status 'pending'
   * discipline: an AI-writable initial state that only a user action moves
   * on). Structurally the same shape as §5.3's「AI 提议 / 用户裁决」column
   * pair, and the epistemic point of decisions/0006 D10: recording an
   * unexamined finding as 'confirmed' would launder "needs checking" into
   * "verified".
   */
  readonly verdict: 'proposed' | 'confirmed' | 'rejected'
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
  /** 'R0001', 'R0002', … — host-minted sequence, see isReleaseItemId. */
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
  /**
   * Free-text remark carried into the release sheet export (research 0006
   * §7.3「分组清单 + 状态 + 备注 + go/no-go 结论」). Optional per the
   * field-evolution discipline — the first ledger release had no release
   * items at all, so nothing to migrate.
   */
  readonly note?: string
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

/**
 * Snapshot of the upstream facts the approved split was based on (P5b,
 * research §7.6 stale reconciliation). Minted at approveSplit, refreshed by
 * confirmSplitStillValid, dropped by reSplit/revoke. PRD rows come from the
 * CLIENT (it already lists the requirement's prds/ directory — the sow-modal
 * cross-module fetcher precedent) so the workbench host never reads the
 * requirements ledger or the workspace filesystem: 0002's「独立文件互不持有
 * 状态」read-path boundary stays intact.
 *
 * `disposedFindings` is a monotone count (findings carry no disposition
 * timestamp), so growth since the snapshot is the trigger.
 */
export interface SplitBaseline {
  readonly at: string
  readonly prd: readonly SplitBaselinePrd[]
  readonly disposedFindings: number
  /**
   * Understand-finalize anchor (0007 D3): the understandApprovedAt stamp the
   * split was approved under. Optional per the field-evolution discipline —
   * baselines minted before 0007 carry none, and ABSENT READS AS ABSENT on
   * the compare side (never a false stale). Revoking the finalize flips the
   * record side to undefined ≠ this string ⇒ stale fires.
   */
  readonly understandApprovedAt?: string
  /**
   * Answered-clarification count at approval (0007 D3): answers are user-
   * owned split-adjudication context that a later answer change should
   * surface as stale. Optional per the field-evolution discipline; absent ⇒
   * compared as 0 (pre-0007 baselines predate clarifications anyway).
   */
  readonly answeredClarifications?: number
  /**
   * Requirement-baseline-doc hash at approval (0008 D4): the docHash the
   * finalized understand carried. Optional per the field-evolution
   * discipline — pre-0008 approvals carry none, and absent reads as absent
   * on the compare side (never a false stale).
   */
  readonly requirementDocHash?: string
}

export interface SplitBaselinePrd {
  readonly name: string
  readonly size: number
  /** File mtime, epoch ms (the requirements PrdDocSummary shape, mirrored). */
  readonly modifiedAt: number
}

// ---------------------------------------------------------------------------
// Understand baseline (0007 定稿软门) — the CREDENTIAL snapshot minted at
// approveUnderstand. It is an ANCHOR, not a second truth source: the split
// task book and the understanding-sheet export both DERIVE from the live
// ledger, they never read this snapshot's content. Its two jobs are (a) the
// approve-something-attach-to credential (the BMAD sign-off discipline) and
// (b) the stale-compare anchor. Deliberately LIGHT (0007 实施裁决①):
// criteria carry full text (≤2000/row caps inherited), findings carry
// METADATA ONLY — id/status/category/severity/title, never detail/resolution
// (20 rows × 32K detail would blow the ledger's inline budget; the full rows
// live on in the live record anyway). No new caps: every row copies data
// already capped at its write gate.
// ---------------------------------------------------------------------------

export interface UnderstandBaselineCriterion {
  readonly id: string
  readonly text: string
  readonly sourceSection?: string
}

export interface UnderstandBaselineFinding {
  readonly id: string
  readonly status: WorkbenchFinding['status']
  readonly category: WorkbenchFinding['category']
  readonly severity: WorkbenchFinding['severity']
  readonly title: string
}

export interface UnderstandBaselineClarification {
  readonly question: string
  readonly answer: string
}

export interface UnderstandBaseline {
  readonly at: string
  readonly criteria: readonly UnderstandBaselineCriterion[]
  readonly findings: readonly UnderstandBaselineFinding[]
  /** ANSWERED rows only ({question, answer}) — unanswered rows are not rulings. */
  readonly clarifications: readonly UnderstandBaselineClarification[]
  /**
   * 0008: the requirement-baseline DOC's disk sha256 at finalize time (the
   * approveUnderstand flow reads `.skyaxis/requirements/<rid>.md` and passes
   * it here — an IO-derived value that never rides the wire). Absent = no
   * doc (or no workspace) at finalize: the finalize still stands (软门), the
   * doc simply is not anchored. Tamper compare on the read side: present and
   * ≠ disk ⇒ contentTampered on the doc card.
   */
  readonly docHash?: string
}

// ---------------------------------------------------------------------------
// Requirement baseline doc (0008 需求基线文档轮) — the CONSOLIDATED requirement
// document the consolidation session writes (original PRD condensed + adopted
// findings/criteria/clarifications + knowledge background merged in; the
// standard-structure doc downstream consumes as THE requirement source of
// truth). Same workspace transport convention as the analysis report: the
// consolidate task book prescribes this path, the session is the SOLE writer,
// the finalize stamp anchors the disk sha256 (UnderstandBaseline.docHash).
// Layout frozen at v1 — a change is a breaking migration, revise ADR 0009
// first.
// ---------------------------------------------------------------------------

/** Workspace-relative directory for requirement baseline docs (dot-prefix = tool-owned, decisions/0009). */
export const REQUIREMENT_DOC_DIR = '.skyaxis/requirements'

const REQUIREMENT_DOC_REQUIREMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Display-form workspace-relative doc path `.skyaxis/requirements/<requirementId>.md` (forward slashes). */
export function requirementDocRelPath(requirementId: string): string {
  if (!REQUIREMENT_DOC_REQUIREMENT_ID_RE.test(requirementId)) {
    throw new Error(`requirementDocRelPath: requirementId is not a lowercase uuid: ${JSON.stringify(requirementId)}`)
  }
  return `${REQUIREMENT_DOC_DIR}/${requirementId}.md`
}

// ---------------------------------------------------------------------------
// Analysis report file (文件交付轮) — the workspace transport convention.
// The analysis task book prescribes this path; the session writes the whole
// report (prose + embedded declare block) there; the host seeds from the
// file. ONE source for the convention on both halves: the browser renders it
// into the task-book text as a display path (forward slashes, string concat
// — no node:path in the browser half), the host joins its workspace root in
// artifact-path.ts which re-asserts the same uuid gate (defense layer 2).
// Layout template frozen at v1 per the ADR 0005 precedent — a change is a
// breaking migration, revise ADR 0007 first.
// ---------------------------------------------------------------------------

/** Workspace-relative directory for AI analysis reports (dot-prefix = tool-owned, decisions/0007). */
export const ANALYSIS_REPORT_DIR = '.skyaxis/analysis'

const ANALYSIS_REPORT_REQUIREMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Display-form workspace-relative report path `.skyaxis/analysis/<requirementId>.md` (forward slashes). */
export function analysisReportRelPath(requirementId: string): string {
  if (!ANALYSIS_REPORT_REQUIREMENT_ID_RE.test(requirementId)) {
    throw new Error(`analysisReportRelPath: requirementId is not a lowercase uuid: ${JSON.stringify(requirementId)}`)
  }
  return `${ANALYSIS_REPORT_DIR}/${requirementId}.md`
}

// ---------------------------------------------------------------------------
// Analysis proposals (回传轮) — the analysis session's report, seeded into
// the ledger as PENDING rows awaiting the user's ruling. Epistemics = the
// P5b ReviewVerdict 'proposed' discipline: rows are HOST-MINTED ONLY (the
// seedAnalysis action reads the session and mints them; no client input
// schema carries proposal content), never counted by badges/stale/matrix
// (those read findings[]/criteria[] only), and only user actions promote.
// ---------------------------------------------------------------------------

export interface WorkbenchProposedFinding {
  /** host uuid, minted at seed time (adopt mints a FRESH uuid for the formal row — the findings-family habit). */
  readonly id: string
  readonly category: WorkbenchFinding['category']
  readonly severity: WorkbenchFinding['severity']
  readonly title: string
  readonly detail?: string
}

export interface WorkbenchProposedCriterion {
  readonly id: string
  readonly text: string
  readonly sourceSection?: string
}

/**
 * One pending CLARIFICATION proposal (文件交付轮): a 待澄清 row — a question
 * the analysis session needs the requirement owner to answer. `answer` /
 * `answeredAt` are USER-OWNED state (the adjudication discipline: the AI
 * asks, only the user answers — the report file stays single-writer, the
 * ledger carries every ruling). Caps equal the criterion caps (question/
 * recommendation/answer 2000, blocks 256).
 */
export interface WorkbenchProposedClarification {
  readonly id: string
  readonly question: string
  /** The session's recommended answer (「把问题措辞成『是』即接受推荐」). */
  readonly recommendation?: string
  /** Which conclusion the question blocks (short citation, e.g. F2 / PRD#3.2). */
  readonly blocks?: string
  readonly answer?: string
  readonly answeredAt?: string
}

/**
 * SINGLE CONTAINER: the invariant "every row belongs to the container's own
 * seed" is structural (four sibling optionals would allow legally-typed but
 * semantically-illegal states). `session` is bound at delivery (re-delivery
 * only swaps the pointer — the replacement window keeps the old batch until
 * the new seed lands); `seed` anchors idempotency (same sessionId + hash →
 * unchanged, deleted rows never resurrect); rows carry NO sessionId/at —
 * batch provenance lives on `seed` alone and unfolds into
 * WorkbenchFinding.sessionId at adopt time.
 */
export interface WorkbenchAnalysisProposals {
  readonly session: {
    readonly sessionId: string
    readonly boundAt: string
    /**
     * Task-book anchor (回传轮 四次诊断): the SOW text's head (~200 chars).
     * The delivery's created session proved to be a SHELL — DSH's send flow
     * materializes the real conversation under a fresh id ~2s later — so the
     * anchor content-addresses the real session when the bound one is a shell
     * (searchSessions by the anchor text; unique per delivery).
     */
    readonly anchor?: string
  }
  readonly seed?: {
    readonly sessionId: string
    readonly contentHash: string
    readonly seededAt: string
    readonly findings: number
    readonly criteria: number
    /** 文件交付轮 batch count — optional per the field-evolution discipline (pre-clarification stamps). */
    readonly clarifications?: number
    /**
     * The report's stage-ready proposal (0007): the AI's 「本阶段就绪」flag,
     * surfaced in S1 as a CONSULTATION line only — advancing stays with the
     * user (the declare.stageReadyProposal discipline). Optional per the
     * field-evolution discipline (pre-0007 stamps carry none).
     */
    readonly stageReady?: boolean
  }
  readonly findings: readonly WorkbenchProposedFinding[]
  readonly criteria: readonly WorkbenchProposedCriterion[]
  /** 文件交付轮 third proposal group — optional per the field-evolution discipline. */
  readonly clarifications?: readonly WorkbenchProposedClarification[]
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
  /**
   * Rollback-plan acknowledgement stamp (P3a, user-ratified 2026-10-08):
   * the third go/no-go condition of the S5 release sheet — "全部 confirmed
   * 以上 + 无漂移告警 + 回滚预案确认" (research 0006 §7.3). A single
   * record-level stamp, structurally the same shape as splitApprovedAt:
   * host-set-only (confirmRollbackPlan / revokeRollbackPlan), no audit
   * array, presence = the user has reviewed the rollback plan. It is NOT a
   * per-item field — the plan covers the release as a whole.
   */
  readonly rollbackPlanConfirmedAt?: string
  /**
   * Stale-reconciliation baseline (P5b) — present exactly while the split is
   * approved. Optional per the field-evolution discipline: records approved
   * before P5b carry none, and a missing baseline reads as "no comparison
   * possible" (the badge stays hidden — honest absence, never a false GO).
   */
  readonly splitBaseline?: SplitBaseline
  /**
   * Understand-finalize stamp (0007 定稿软门) — presence = the requirement's
   * understanding phase has been closed out by the user (a CONTENT event,
   * deliberately decoupled from `stage`, the ATTENTION pointer: finalize
   * never advances, advance never finalizes). Host-set-only, like
   * splitApprovedAt; revoke strips stamp + baseline together (the key-strip
   * precedent). NOT a hard gate: the split actions and criteria edits stay
   * available with or without it (P3「阶段是指示器不是闸门」intact — the
   * industry survey found approval-heaviness is where tools lose users).
   */
  readonly understandApprovedAt?: string
  /** The credential snapshot minted with the stamp above (see its section note). */
  readonly understandBaseline?: UnderstandBaseline
  readonly criteria: readonly WorkbenchCriterion[]
  readonly findings: readonly WorkbenchFinding[]
  readonly workPackages: readonly WorkbenchWorkPackage[]
  readonly releaseItems: readonly ReleaseItem[]
  readonly reviewReports: readonly ReviewReportEntry[]
  readonly knowledgeCandidates: readonly KnowledgeCandidate[]
  /**
   * Analysis-proposal container (回传轮) — optional per the field-evolution
   * discipline: pre-round records carry none; absent = never delivered.
   */
  readonly analysis?: WorkbenchAnalysisProposals
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
  /**
   * Client-supplied PRD snapshot (P5b, optional for backward compat): the
   * only upstream fact the host cannot see (PRD docs live in the requirement
   * workspace, read by the client — the sow-modal cross-module precedent, so
   * the workbench host never touches the requirements ledger or filesystem).
   * `disposedFindings` is NOT sent — the host derives it from the very record
   * it is stamping, so it can never disagree with the ledger. Absent baseline
   * ⇒ no PRD arm of stale detection (findings arm still works).
   */
  readonly baseline?: {
    readonly prd: readonly SplitBaselinePrd[]
  }
}

/**
 * Archive the approved split and reopen the list for re-planning (§7.6
 * 「重新拆分（旧工作包列表归档保留，新列表生成）」). Archiving reuses the
 * existing dropped state (P1b round-3's ratified「放弃 = 从当前计划中排除，
 * 可恢复」semantics) rather than adding a second archive mechanism — so it is
 * only legal while every active package is not-yet-started: an in-dev/built/
 * accepted package carries plans, sessions and acceptances that a re-split
 * would silently orphan. The client disables the action and discloses why
 * (the criteria.lockedHint honesty precedent).
 */
export interface ReSplitRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'reSplit'
}

/** §7.6「确认仍有效」— re-mint the baseline from the client's current snapshot, list untouched. */
export interface ConfirmSplitStillValidRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'confirmSplitStillValid'
  readonly baseline: {
    readonly prd: readonly SplitBaselinePrd[]
  }
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

// --- Understand finalize (S1 收口, 0007 定稿软门; OUTSIDE the split lock —
// finalizing is the user's own content event over S1 state, and the split
// contract freezes list × coverage, not the understanding credential. The
// confirmRollbackPlan record-stamp pair is the structural precedent.) ---

/**
 * Finalize the requirement understanding: stamps understandApprovedAt +
 * mints the UnderstandBaseline credential. ZERO PAYLOAD — the baseline is
 * derived host-side from the very record being stamped (the approveSplit
 * disposedFindings discipline: it can never disagree with the ledger).
 * Approving twice is a 400 (the approve-family rule: a client bug, not a
 * state race). Not a gate: nothing downstream locks or unlocks on it.
 */
export interface ApproveUnderstandRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'approveUnderstand'
}

/** Strip the finalize stamp + baseline together (key-strip precedent). */
export interface RevokeUnderstandRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'revokeUnderstand'
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

// --- Release items (S5 delivery; OUTSIDE the split gate — see the
// record-actions.ts note. Registration happens from the implement stage
// onward and rollback is a safety action: neither may be locked out by a
// revoked split approval.) ---

/**
 * Register or edit one release item. `contentHash` is NEVER client-writable
 * (host sha256 at write, the D4-③ discipline for plans applied here); an
 * edit re-hashes, so drift can only ever come from outside the endpoint.
 */
export interface SaveReleaseItemRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'saveReleaseItem'
  /** id present = edit (pending items only), absent = create (host mints R####). */
  readonly releaseItem: {
    readonly id?: string
    readonly type: ReleaseItem['type']
    readonly title: string
    readonly content: string
    readonly envs: readonly string[]
    readonly workPackageId?: string
    readonly sessionId?: string
    readonly note?: string
  }
}

export interface RemoveReleaseItemRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'removeReleaseItem'
  readonly id: string
}

/** pending → confirmed: the user accepts an AI-declared item onto the sheet. */
export interface ConfirmReleaseItemRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'confirmReleaseItem'
  readonly id: string
}

/** confirmed → applied (strict chain; host stamps appliedAt). */
export interface MarkReleaseItemAppliedRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'markReleaseItemApplied'
  readonly id: string
}

/** applied → verified. */
export interface MarkReleaseItemVerifiedRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'markReleaseItemVerified'
  readonly id: string
}

/** Any live status → rolled-back (terminal). */
export interface RollbackReleaseItemRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'rollbackReleaseItem'
  readonly id: string
}

/** The go/no-go third condition — record-level, not per item. */
export interface ConfirmRollbackPlanRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'confirmRollbackPlan'
}

export interface RevokeRollbackPlanRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'revokeRollbackPlan'
}

// --- Review reports (S4; OUTSIDE the split gate — adjudication is the
// user's power, reports are review-stage artifacts, and the manual path is
// the R5 shortest route; the findings/candidates/releaseItems family). ---

/**
 * Add or edit one verdict row on a report (P4, manual entry — the structured
 * review convention is deferred to P5 by user ruling). id absent = add
 * (host mints a uuid); present = full-row replace.
 */
export interface SaveReviewVerdictRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'saveReviewVerdict'
  readonly reportId: string
  /**
   * Deliberately TWO-valued while the stored ReviewVerdict.verdict is three:
   * 'proposed' is host-minted only (the seed channel), so no client can write
   * one — editing a proposed row forces the user to land on a real ruling.
   */
  readonly verdict: {
    readonly id?: string
    readonly title: string
    readonly severity: 'high' | 'medium' | 'low'
    readonly verdict: 'confirmed' | 'rejected'
    readonly disposition?: 'to-fix' | 'fixed' | 'wont-fix'
    readonly note?: string
  }
}

export interface RemoveReviewVerdictRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'removeReviewVerdict'
  readonly reportId: string
  readonly id: string
}

/**
 * Remove one report ENTRY — the body file stays on disk as a scan-visible
 * orphan (the P1b ledger/reference split: reads degrade, orphans collect).
 */
export interface RemoveReviewReportRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'removeReviewReport'
  readonly id: string
}

/** S6 manual distillation of a knowledge candidate (research §7.4 channel ② — 复盘时手动提炼). */
export interface SaveKnowledgeCandidateRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'saveKnowledgeCandidate'
  readonly candidate: {
    readonly title: string
    readonly draft: string
    readonly type: 'business' | 'convention'
  }
}

// --- Session bindings (P2: manual binding from the S3 detail dialog) ---

export interface BindSessionRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'bindSession'
  readonly id: string
  /** Host-minted binding row {sessionId, purpose, boundAt}; sessions[] is append-only (no unbind). */
  readonly sessionId: string
  readonly purpose: 'analysis' | 'dev' | 'review'
}

// --- Knowledge candidates (S6; OUTSIDE the split gate — retro spans the
// whole lifecycle. Activate is the dual-ledger promote: candidate → promoted
// in workbench.yaml (this union's optimistic lock) + an active row in
// knowledge.yaml as a best-effort tail write keyed by the SAME id.) ---

export interface ActivateKnowledgeCandidateRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'activateKnowledgeCandidate'
  /** Candidate uuid — becomes the knowledge row's id (the idempotent-promote link). */
  readonly id: string
  readonly knowledge: {
    readonly scope: 'global' | 'workspace' | 'requirement'
    readonly type: 'business' | 'convention'
    /** P5a: mode 'path' joins (the saveKnowledge channel already carried it). */
    readonly trigger: { readonly mode: 'always' | 'keyword' | 'manual' | 'path'; readonly value?: string }
    /** workspace scope only — required when scope is 'workspace'. */
    readonly path?: string
  }
}

export interface EditKnowledgeCandidateRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'editKnowledgeCandidate'
  readonly id: string
  readonly candidate: {
    readonly title: string
    readonly draft: string
    readonly type: 'business' | 'convention'
  }
}

export interface DismissKnowledgeCandidateRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'dismissKnowledgeCandidate'
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
  | ReSplitRequest
  | ConfirmSplitStillValidRequest
  | ApprovePlanRequest
  | StartWorkPackageRequest
  | MarkWorkPackageBuiltRequest
  | AcceptWorkPackageRequest
  | ReopenWorkPackageRequest
  | DropWorkPackageRequest
  | RestoreWorkPackageRequest
  | SaveCriterionRequest
  | RemoveCriterionRequest
  | ApproveUnderstandRequest
  | RevokeUnderstandRequest
  | SaveReleaseItemRequest
  | RemoveReleaseItemRequest
  | ConfirmReleaseItemRequest
  | MarkReleaseItemAppliedRequest
  | MarkReleaseItemVerifiedRequest
  | RollbackReleaseItemRequest
  | ConfirmRollbackPlanRequest
  | RevokeRollbackPlanRequest
  | SaveReviewVerdictRequest
  | RemoveReviewVerdictRequest
  | RemoveReviewReportRequest
  | SaveKnowledgeCandidateRequest
  | BindSessionRequest
  | ActivateKnowledgeCandidateRequest
  | EditKnowledgeCandidateRequest
  | DismissKnowledgeCandidateRequest
  | BindAnalysisSessionRequest
  | SeedAnalysisRequest
  | AdoptFindingProposalRequest
  | DismissFindingProposalRequest
  | AdoptCriterionProposalRequest
  | DismissCriterionProposalRequest
  | AnswerAnalysisClarificationRequest
  | DismissAnalysisClarificationRequest

// ---------------------------------------------------------------------------
// Analysis-proposal actions (回传轮). The input schemas carry NO proposal
// CONTENT — rows are minted host-side by seedAnalysis (which reads the
// session itself), so a client can never write a proposal directly (the
// P5b「input schema stays two-valued」discipline). bind/seed target the
// container by sessionId; adopt/dismiss target a row by id.
// ---------------------------------------------------------------------------

export interface BindAnalysisSessionRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'bindAnalysisSession'
  readonly sessionId: string
  /** Task-book anchor head (~200 chars) — rides the delivery bind (see WorkbenchAnalysisProposals.session.anchor). */
  readonly anchor?: string
}

export interface SeedAnalysisRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'seedAnalysis'
  readonly sessionId: string
}

export interface AdoptFindingProposalRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'adoptFindingProposal'
  readonly id: string
}

export interface DismissFindingProposalRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'dismissFindingProposal'
  readonly id: string
}

export interface AdoptCriterionProposalRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'adoptCriterionProposal'
  readonly id: string
}

export interface DismissCriterionProposalRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'dismissCriterionProposal'
  readonly id: string
}

/**
 * 文件交付轮: the requirement owner answers a pending clarification. The
 * answer is USER content (1..2000 after trim — the saveFinding payload
 * discipline, distinct from the no-proposal-content rule which bars AI
 * proposal rows from the wire), stored on the pending row in the ledger —
 * never written back into the report file (single-writer, decisions/0007).
 */
export interface AnswerAnalysisClarificationRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'answerAnalysisClarification'
  readonly id: string
  readonly answer: string
}

/** 文件交付轮: drop a pending clarification without answering (「不答/忽略」 — the dismiss-proposal family). */
export interface DismissAnalysisClarificationRequest {
  readonly expectedRevision: number
  readonly requirementId: string
  readonly action: 'dismissAnalysisClarification'
  readonly id: string
}

// ---------------------------------------------------------------------------
// Knowledge base (P2) — a SEPARATE route with its own action union and its
// own optimistic lock: knowledge.yaml is a global asset store, not a
// per-requirement ledger (no implicit-record semantics; a different revision
// space). The activate-promote above is the ONLY cross-ledger action and it
// treats knowledge.yaml as a tail-write projection.
// ---------------------------------------------------------------------------

/** One active/archived knowledge row on the wire (host KnowledgeRecord mirrored). */
export interface WorkbenchKnowledgeRecord {
  readonly id: string
  readonly scope: 'global' | 'workspace' | 'requirement'
  readonly type: 'business' | 'convention'
  readonly title: string
  /** Inline ledger text — capped by WORKBENCH_INLINE_MAX_CHARS (D4-⑤). */
  readonly content: string
  /** workspace-scope ownership key. */
  readonly path?: string
  /** requirement-scope ownership key (what the D6 cascade filters on). */
  readonly requirementId?: string
  readonly trigger: {
    readonly mode: 'always' | 'path' | 'keyword' | 'manual'
    readonly value?: string
  }
  readonly status: 'active' | 'archived'
  readonly provenance: {
    readonly requirementId?: string
    readonly sessionId?: string
    readonly at: string
  }
}

export interface WorkbenchKnowledgeListResponseOk {
  readonly ok: true
  readonly revision: number
  /**
   * Filtered by the query: scope==='requirement' && requirementId match ∪
   * scope==='global' (the user-ratified P2 view; workspace rows join P5
   * path matching). Both statuses travel; the client filters active.
   */
  readonly records: readonly WorkbenchKnowledgeRecord[]
}

export interface WorkbenchKnowledgeListResponseDegraded {
  readonly ok: false
  readonly degraded: true
  readonly reason: 'parse' | 'schema' | 'io'
  readonly hasBackup: boolean
}

export type WorkbenchKnowledgeListResponse = WorkbenchKnowledgeListResponseOk | WorkbenchKnowledgeListResponseDegraded

export interface WorkbenchKnowledgeSaveResponseOk {
  readonly ok: true
  readonly revision: number
  readonly record: WorkbenchKnowledgeRecord
}

export interface SaveKnowledgeRequest {
  readonly expectedRevision: number
  readonly action: 'saveKnowledge'
  /** Absent = manual create (host mints a uuid, status 'active'); present = full-row replace edit. */
  readonly knowledge: {
    readonly id?: string
    readonly scope: 'global' | 'workspace' | 'requirement'
    readonly type: 'business' | 'convention'
    readonly title: string
    readonly content: string
    readonly path?: string
    readonly requirementId?: string
    /** Full four-mode surface: path arrives with its P5 consumers, no wire churn later. */
    readonly trigger: { readonly mode: 'always' | 'path' | 'keyword' | 'manual'; readonly value?: string }
  }
}

export interface ArchiveKnowledgeRequest {
  readonly expectedRevision: number
  readonly action: 'archiveKnowledge'
  readonly id: string
}

export type WorkbenchKnowledgeMutateRequestBody = SaveKnowledgeRequest | ArchiveKnowledgeRequest

// ---------------------------------------------------------------------------
// Declare-block import (P3b) — a SEPARATE route (like knowledge): its
// preview/commit response envelopes cannot fit the main union's
// {ok, revision, record}, the repos-pool import two-stage precedent. It
// writes the SAME workbench.yaml revision space — the optimistic lock is
// shared with the main union, so concurrent writers 409 against each other
// (correct, not a bug).
// ---------------------------------------------------------------------------

export const WORKBENCH_DECLARE_PATH = '/api/skyaxis/workbench/declare'

/** Cap on declare text (UTF-16 code units) — bounds YAML.parse and transport. */
export const DECLARE_MAX_CHARS = 128 * 1024

/** GET fetch degradation — read paths degrade in a 200 envelope, never error. */
export type DeclareFetchMissing = 'no-service' | 'not-found' | 'unreadable' | 'no-declare-block'

/**
 * P5b review fetch — the same envelope shape, its own closed enum so the
 * review modal's reason→dictionary map stays exhaustive (the SKIP_REASON_KEY
 * discipline: a shared enum would leave a hole in one of the two maps).
 * The route is query-discriminated by `kind=declare|review` (the artifacts
 * route's precedent), sharing one reader engine.
 */
export type ReviewFetchMissing = 'no-service' | 'not-found' | 'unreadable' | 'no-review-block'

export interface DeclareFetchResponseText {
  readonly ok: true
  /** The extracted declare-block body (fence markers stripped, marker line kept). */
  readonly text: string
}

export interface DeclareFetchResponseMissing {
  readonly ok: true
  readonly missing: DeclareFetchMissing
}

export type DeclareFetchResponse = DeclareFetchResponseText | DeclareFetchResponseMissing

/**
 * P5b review fetch response. Unlike the declare face (which hands back the
 * fence BODY), the review face hands back the WHOLE assistant message: a
 * review report IS free-form markdown and the convention block is part of it,
 * so the fetched text is exactly what the report body should store (its
 * contentHash then covers the block and the idempotency anchor works on the
 * whole document).
 */
export interface ReviewFetchResponseText {
  readonly ok: true
  readonly text: string
}

export interface ReviewFetchResponseMissing {
  readonly ok: true
  readonly missing: ReviewFetchMissing
}

export type ReviewFetchResponse = ReviewFetchResponseText | ReviewFetchResponseMissing

/**
 * Per-row skip reasons for the review convention block (closed enum). Under
 * 落法 A these never cross the wire as rows — the report is created either
 * way and only the seeded COUNT plus the advisory blockError travel — but the
 * host classifies with them and the tests pin the classification.
 */
export type ReviewSkipReason =
  | 'bad-shape'
  | 'bad-severity'
  | 'bad-title'
  | 'over-cap'

/** Per-row skip reasons — closed enum so the client maps to dictionary keys (the rejection-keys discipline). */
export type DeclareSkipReason =
  | 'bad-shape'
  | 'bad-type'
  | 'bad-severity'
  | 'bad-title'
  | 'bad-content'
  | 'over-cap'
  | 'bad-envs'
  | 'wp-not-found'
  | 'wp-not-in-dev'

export interface DeclareSkip {
  /** Stable key within this parse (`built-0`, `artifact-2`, …). */
  readonly key: string
  /** Best-effort human label of the raw row (title when readable, else the key). */
  readonly label: string
  readonly reason: DeclareSkipReason
}

export interface DeclareBuiltEntry {
  readonly kind: 'built'
  readonly key: string
  readonly workPackageId: string
}

export interface DeclareArtifactEntry {
  readonly kind: 'artifact'
  readonly key: string
  readonly type: ReleaseItem['type']
  readonly title: string
  readonly content: string
  readonly envs: readonly string[]
  /** Block-level workPackage scope, stamped when present AND resolvable. */
  readonly workPackageId?: string
  /** Advisory: an existing row has the same (type, title, contentHash). Import stays legal (correction = new item + old rolled-back may be identical). */
  readonly duplicate: boolean
}

export interface DeclareKnowledgeEntry {
  readonly kind: 'knowledge'
  readonly key: string
  readonly type: 'business' | 'convention'
  readonly title: string
  readonly draft: string
  readonly duplicate: boolean
}

export type DeclareEntry = DeclareBuiltEntry | DeclareArtifactEntry | DeclareKnowledgeEntry

export interface DeclarePreviewResponseOk {
  readonly ok: true
  /** Anchor: the revision this preview was computed against (the real import must carry it back). */
  readonly revision: number
  /** Importable rows (validation failures live in skipped[] — not checkable). */
  readonly entries: readonly DeclareEntry[]
  readonly skipped: readonly DeclareSkip[]
  /** AI proposal only — displayed as an advisory line, NEVER persisted (§5.1 four powers). */
  readonly stageReady: boolean
  /** Whole-block rejection: entries/skipped are empty; the client keeps the text editable. */
  readonly blockError?: 'no-declare-block' | 'yaml-syntax'
  readonly blockErrorLine?: number
}

export interface DeclareReport {
  readonly built: number
  readonly artifacts: number
  readonly knowledge: number
  /** Commit-time guard rejections (races between preview and commit). */
  readonly skipped: readonly DeclareSkip[]
}

export interface DeclareCommitResponseOk {
  readonly ok: true
  readonly revision: number
  readonly record: WorkbenchRecord
  readonly report: DeclareReport
}

export interface DeclareImportRequestBody {
  readonly expectedRevision: number
  readonly requirementId: string
  /** Present = parse-only preview, nothing is written (repos-pool dryRun semantics). */
  readonly dryRun?: boolean
  /** Declare text — a fenced block, a bare block body, or pasted prose containing one. */
  readonly text: string
  /** Provenance stamped onto imported rows (releaseItems.sessionId / candidates.proposedSessionId). */
  readonly sessionId?: string
  /** Entry keys to import (commit only; unknown keys are ignored). */
  readonly selected?: readonly string[]
}

/** SOW knowledge-injection caps (client-side assembly v1; mechanism fixed, values adjustable). */
export const KNOWLEDGE_INJECTION_MAX_ENTRIES = 8
export const KNOWLEDGE_INJECTION_MAX_BYTES = 8 * 1024

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
export const WORKBENCH_KNOWLEDGE_PATH = '/api/skyaxis/workbench/knowledge'

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
  /**
   * Ids of release items whose stored contentHash disagrees with a fresh
   * hash of their content — a READ-TIME projection (never a ledger field,
   * the fileExists precedent). Content written through the endpoint always
   * re-hashes in the same write, so drift has exactly one cause: the ledger
   * yaml was edited outside the endpoint. Warn, don't block (细化④).
   */
  readonly releaseDrifted: readonly string[]
}

/**
 * seedAnalysis advisory (回传轮 observability): the ZERO-WRITE outcomes carry
 * WHY nothing was collected, so the waiting row can disclose it instead of
 * failing silently (the diagnosis round's lesson —「not written yet」and
 * 「written but unreadable」were indistinguishable). Optional on the shared
 * save envelope; only seedAnalysis ever sets it. The report-file-* family
 * (文件交付轮) names the workspace file channel's misses — they are the
 * ACTIONABLE headline when both channels miss (the file is the prescribed
 * one; see endpoint.ts seedAnalysisFlow for the fallback ladder).
 */
export type SeedMissingReason = DeclareFetchMissing | 'yaml-syntax'
  | 'report-file-missing' | 'report-file-too-large' | 'report-file-syntax'

export interface WorkbenchSaveResponseOk {
  readonly ok: true
  readonly revision: number
  readonly record: WorkbenchRecord
  readonly seedMissing?: SeedMissingReason
  /** Declare-reader scan fingerprint, attached to the no-declare-block miss only. */
  readonly seedScan?: string
  /** True when the bound log held NO user message — the delivery SHELL (drives the client-side legacy repair). */
  readonly seedShell?: boolean
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
  /**
   * Review writes only (P5b) — how many `# skyaxis-review` findings were
   * seeded as proposed verdict rows on a NEWLY created report. Absent on the
   * idempotent-convergence path (a retry never re-seeds: that would resurrect
   * rows the user deleted) and on plan writes.
   */
  readonly seeded?: number
  /**
   * Review writes only, ADVISORY — unlike the declare route's blockError
   * (where a bad block means nothing imports), a review report is free-form
   * markdown: a missing or unparseable convention block still creates the
   * report with zero seeded rows. The client discloses it, never fails.
   */
  readonly reviewBlockError?: 'no-review-block' | 'yaml-syntax'
  readonly reviewBlockErrorLine?: number
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
/**
 * Three-valued on the READ side (P5b): the browser guard must accept
 * host-minted 'proposed' rows or the whole detail response fails its guard
 * and the client reads a healthy ledger as an http-error. The WRITE side
 * (SaveReviewVerdictRequest) stays two-valued — see that interface.
 */
const VERDICT_OUTCOMES = ['proposed', 'confirmed', 'rejected']
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
    (r.id === undefined || isString(r.id))
    && isString(r.title) && r.title.length > 0
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
    isString(r.id) && isReleaseItemId(r.id)
    && isString(r.type) && RELEASE_TYPES.includes(r.type)
    && isString(r.title) && r.title.length > 0
    && isString(r.content)
    && isString(r.contentHash) && r.contentHash.length > 0
    && Array.isArray(r.envs) && r.envs.every((e) => isString(e))
    && (r.workPackageId === undefined || (isString(r.workPackageId) && isWorkPackageId(r.workPackageId)))
    && (r.sessionId === undefined || isString(r.sessionId))
    && isString(r.status) && RELEASE_STATUSES.includes(r.status)
    && (r.appliedAt === undefined || isString(r.appliedAt))
    && (r.note === undefined || isString(r.note))
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

function isWorkbenchProposedFinding(v: unknown): v is WorkbenchProposedFinding {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.id) && r.id.length > 0
    && isString(r.category) && FINDING_CATEGORIES.includes(r.category)
    && isString(r.severity) && SEVERITIES.includes(r.severity)
    && isString(r.title) && r.title.length > 0
    && (r.detail === undefined || isString(r.detail))
  )
}

function isWorkbenchProposedCriterion(v: unknown): v is WorkbenchProposedCriterion {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.id) && r.id.length > 0
    && isString(r.text) && r.text.length > 0
    && (r.sourceSection === undefined || isString(r.sourceSection))
  )
}

function isWorkbenchProposedClarification(v: unknown): v is WorkbenchProposedClarification {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.id) && r.id.length > 0
    && isString(r.question) && r.question.length > 0
    && (r.recommendation === undefined || isString(r.recommendation))
    && (r.blocks === undefined || isString(r.blocks))
    && (r.answer === undefined || isString(r.answer))
    && (r.answeredAt === undefined || isString(r.answeredAt))
  )
}

function isWorkbenchAnalysisProposals(v: unknown): v is WorkbenchAnalysisProposals {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  const session = typeof r.session === 'object' && r.session !== null ? r.session as Record<string, unknown> : null
  if (session === null
    || !isString(session.sessionId) || session.sessionId.length === 0
    || !isString(session.boundAt)) return false
  if (r.seed !== undefined) {
    const s = r.seed as Record<string, unknown>
    // Read-side leniency on contentHash (the releaseItem.contentHash habit):
    // presence + non-empty string, never format-checked on the wire.
    if (
      !isString(s.sessionId) || s.sessionId.length === 0
      || !isString(s.contentHash) || s.contentHash.length === 0
      || !isString(s.seededAt)
      || typeof s.findings !== 'number' || typeof s.criteria !== 'number'
      || (s.clarifications !== undefined && typeof s.clarifications !== 'number')
      || (s.stageReady !== undefined && typeof s.stageReady !== 'boolean')
    ) return false
  }
  if (session.anchor !== undefined && (!isString(session.anchor) || session.anchor.length === 0 || session.anchor.length > 512)) return false
  return (
    Array.isArray(r.findings) && r.findings.every(isWorkbenchProposedFinding)
    && Array.isArray(r.criteria) && r.criteria.every(isWorkbenchProposedCriterion)
    && (r.clarifications === undefined || (Array.isArray(r.clarifications) && r.clarifications.every(isWorkbenchProposedClarification)))
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

function isSplitBaselinePrd(v: unknown): v is SplitBaselinePrd {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return isString(r.name) && r.name.length > 0
    && typeof r.size === 'number'
    && typeof r.modifiedAt === 'number'
}

function isSplitBaseline(v: unknown): v is SplitBaseline {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return isString(r.at) && r.at.length > 0
    && Array.isArray(r.prd) && r.prd.every(isSplitBaselinePrd)
    && typeof r.disposedFindings === 'number'
    && (r.understandApprovedAt === undefined || (isString(r.understandApprovedAt) && r.understandApprovedAt.length > 0))
    && (r.answeredClarifications === undefined || typeof r.answeredClarifications === 'number')
    && (r.requirementDocHash === undefined || (isString(r.requirementDocHash) && r.requirementDocHash.length > 0))
}

function isUnderstandBaselineCriterion(v: unknown): v is UnderstandBaselineCriterion {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.id) && r.id.length > 0
    && isString(r.text) && r.text.length > 0
    && (r.sourceSection === undefined || isString(r.sourceSection))
  )
}

function isUnderstandBaselineFinding(v: unknown): v is UnderstandBaselineFinding {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.id) && r.id.length > 0
    && isString(r.status) && FINDING_STATUSES.includes(r.status)
    && isString(r.category) && FINDING_CATEGORIES.includes(r.category)
    && isString(r.severity) && SEVERITIES.includes(r.severity)
    && isString(r.title) && r.title.length > 0
  )
}

function isUnderstandBaselineClarification(v: unknown): v is UnderstandBaselineClarification {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.question) && r.question.length > 0
    && isString(r.answer) && r.answer.length > 0
  )
}

function isUnderstandBaseline(v: unknown): v is UnderstandBaseline {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.at) && r.at.length > 0
    && Array.isArray(r.criteria) && r.criteria.every(isUnderstandBaselineCriterion)
    && Array.isArray(r.findings) && r.findings.every(isUnderstandBaselineFinding)
    && Array.isArray(r.clarifications) && r.clarifications.every(isUnderstandBaselineClarification)
    && (r.docHash === undefined || (isString(r.docHash) && r.docHash.length > 0))
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
    && (r.rollbackPlanConfirmedAt === undefined || (isString(r.rollbackPlanConfirmedAt) && r.rollbackPlanConfirmedAt.length > 0))
    && (r.splitBaseline === undefined || isSplitBaseline(r.splitBaseline))
    && (r.understandApprovedAt === undefined || (isString(r.understandApprovedAt) && r.understandApprovedAt.length > 0))
    && (r.understandBaseline === undefined || isUnderstandBaseline(r.understandBaseline))
    && Array.isArray(r.criteria) && r.criteria.every(isWorkbenchCriterion)
    && Array.isArray(r.findings) && r.findings.every(isWorkbenchFinding)
    && Array.isArray(r.workPackages) && r.workPackages.every(isWorkbenchWorkPackage)
    && Array.isArray(r.releaseItems) && r.releaseItems.every(isReleaseItem)
    && Array.isArray(r.reviewReports) && r.reviewReports.every(isReviewReportEntry)
    && Array.isArray(r.knowledgeCandidates) && r.knowledgeCandidates.every(isKnowledgeCandidate)
    && (r.analysis === undefined || isWorkbenchAnalysisProposals(r.analysis))
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
    && Array.isArray(r.releaseDrifted) && r.releaseDrifted.every(isString)
  )
}

export function isWorkbenchSaveResponseOk(v: unknown): v is WorkbenchSaveResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (r.ok !== true || typeof r.revision !== 'number' || !isWorkbenchRecord(r.record)) return false
  if (r.seedMissing !== undefined) {
    const reasons = ['no-service', 'not-found', 'unreadable', 'no-declare-block', 'yaml-syntax', 'report-file-missing', 'report-file-too-large', 'report-file-syntax']
    if (typeof r.seedMissing !== 'string' || !reasons.includes(r.seedMissing)) return false
  }
  if (r.seedScan !== undefined && typeof r.seedScan !== 'string') return false
  if (r.seedShell !== undefined && typeof r.seedShell !== 'boolean') return false
  return true
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
    && (r.seeded === undefined || (typeof r.seeded === 'number' && r.seeded >= 0))
    && (r.reviewBlockError === undefined || r.reviewBlockError === 'no-review-block' || r.reviewBlockError === 'yaml-syntax')
    && (r.reviewBlockErrorLine === undefined || typeof r.reviewBlockErrorLine === 'number')
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

// ---------------------------------------------------------------------------
// Knowledge guards (browser side) — scope-coupled like the repos-pool
// addressSlotOk precedent: workspace ⇒ path present, requirement ⇒
// requirementId present; a row whose scope and keys disagree collapses to a
// guard failure instead of joining halfway in the UI.
// ---------------------------------------------------------------------------

const KNOWLEDGE_SCOPES = ['global', 'workspace', 'requirement']
const KNOWLEDGE_TYPES = ['business', 'convention']
const KNOWLEDGE_TRIGGER_MODES = ['always', 'path', 'keyword', 'manual']
const KNOWLEDGE_STATUSES = ['active', 'archived']

export function isWorkbenchKnowledgeRecord(v: unknown): v is WorkbenchKnowledgeRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (!isString(r.id) || r.id.length === 0) return false
  if (!isString(r.scope) || !KNOWLEDGE_SCOPES.includes(r.scope)) return false
  if (!isString(r.type) || !KNOWLEDGE_TYPES.includes(r.type)) return false
  if (!isString(r.title) || r.title.length === 0) return false
  if (!isString(r.content)) return false
  if (r.scope === 'workspace' && !isString(r.path)) return false
  if (r.scope === 'requirement' && !isString(r.requirementId)) return false
  if (typeof r.trigger !== 'object' || r.trigger === null) return false
  const trigger = r.trigger as Record<string, unknown>
  if (!isString(trigger.mode) || !KNOWLEDGE_TRIGGER_MODES.includes(trigger.mode)) return false
  if (trigger.value !== undefined && !isString(trigger.value)) return false
  if (!isString(r.status) || !KNOWLEDGE_STATUSES.includes(r.status)) return false
  if (typeof r.provenance !== 'object' || r.provenance === null) return false
  const provenance = r.provenance as Record<string, unknown>
  return (provenance.requirementId === undefined || isString(provenance.requirementId))
    && (provenance.sessionId === undefined || isString(provenance.sessionId))
    && isString(provenance.at) && provenance.at.length > 0
}

export function isWorkbenchKnowledgeListResponse(v: unknown): v is WorkbenchKnowledgeListResponse {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (r.ok === true) {
    return typeof r.revision === 'number' && Array.isArray(r.records) && r.records.every(isWorkbenchKnowledgeRecord)
  }
  return (
    r.ok === false && r.degraded === true
    && (r.reason === 'parse' || r.reason === 'schema' || r.reason === 'io')
    && typeof r.hasBackup === 'boolean'
  )
}

export function isWorkbenchKnowledgeSaveResponseOk(v: unknown): v is WorkbenchKnowledgeSaveResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return r.ok === true && typeof r.revision === 'number' && isWorkbenchKnowledgeRecord(r.record)
}

// ---------------------------------------------------------------------------
// Declare guards (browser side)
// ---------------------------------------------------------------------------

const DECLARE_FETCH_MISSING = ['no-service', 'not-found', 'unreadable', 'no-declare-block']
const REVIEW_FETCH_MISSING = ['no-service', 'not-found', 'unreadable', 'no-review-block']
const DECLARE_SKIP_REASONS = ['bad-shape', 'bad-type', 'bad-severity', 'bad-title', 'bad-content', 'over-cap', 'bad-envs', 'wp-not-found', 'wp-not-in-dev']
const DECLARE_ENTRY_TYPES = ['sql', 'config', 'flag', 'mq', 'other']
const DECLARE_KNOWLEDGE_TYPES = ['business', 'convention']

export function isDeclareFetchResponse(v: unknown): v is DeclareFetchResponse {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (r.ok !== true) return false
  if (isString(r.text)) return r.missing === undefined
  return isString(r.missing) && DECLARE_FETCH_MISSING.includes(r.missing)
}

export function isReviewFetchResponse(v: unknown): v is ReviewFetchResponse {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (r.ok !== true) return false
  if (isString(r.text)) return r.missing === undefined
  return isString(r.missing) && REVIEW_FETCH_MISSING.includes(r.missing)
}

function isDeclareSkip(v: unknown): v is DeclareSkip {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return isString(r.key) && r.key.length > 0
    && isString(r.label)
    && isString(r.reason) && DECLARE_SKIP_REASONS.includes(r.reason)
}

function isDeclareEntry(v: unknown): v is DeclareEntry {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (!isString(r.key) || r.key.length === 0) return false
  if (r.kind === 'built') {
    return isString(r.workPackageId) && isWorkPackageId(r.workPackageId)
  }
  if (r.kind === 'artifact') {
    return isString(r.type) && DECLARE_ENTRY_TYPES.includes(r.type)
      && isString(r.title) && r.title.length > 0
      && isString(r.content)
      && Array.isArray(r.envs) && r.envs.every((e) => isString(e))
      && (r.workPackageId === undefined || (isString(r.workPackageId) && isWorkPackageId(r.workPackageId)))
      && typeof r.duplicate === 'boolean'
  }
  if (r.kind === 'knowledge') {
    return isString(r.type) && DECLARE_KNOWLEDGE_TYPES.includes(r.type)
      && isString(r.title) && r.title.length > 0
      && isString(r.draft)
      && typeof r.duplicate === 'boolean'
  }
  return false
}

export function isDeclarePreviewResponse(v: unknown): v is DeclarePreviewResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (r.ok !== true || typeof r.revision !== 'number' || typeof r.stageReady !== 'boolean') return false
  if (!Array.isArray(r.entries) || !r.entries.every(isDeclareEntry)) return false
  if (!Array.isArray(r.skipped) || !r.skipped.every(isDeclareSkip)) return false
  if (r.blockError !== undefined && r.blockError !== 'no-declare-block' && r.blockError !== 'yaml-syntax') return false
  if (r.blockErrorLine !== undefined && typeof r.blockErrorLine !== 'number') return false
  return true
}

export function isDeclareCommitResponse(v: unknown): v is DeclareCommitResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (r.ok !== true || typeof r.revision !== 'number' || !isWorkbenchRecord(r.record)) return false
  const report = r.report
  if (typeof report !== 'object' || report === null) return false
  const p = report as Record<string, unknown>
  return typeof p.built === 'number' && typeof p.artifacts === 'number' && typeof p.knowledge === 'number'
    && Array.isArray(p.skipped) && p.skipped.every(isDeclareSkip)
}
