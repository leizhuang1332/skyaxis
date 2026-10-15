/**
 * Workbench host-side zod schemas: the storage read boundary (workbench.yaml
 * / knowledge.yaml) and the endpoint request-body boundary. The inferred
 * types are asserted mutually assignable with the hand-written protocol
 * types — the two halves cannot drift without a type error.
 *
 * First ledger release — no legacy data exists, so nested arrays are
 * REQUIRED (a hand-edited yaml missing a field degrades the whole file to
 * schema-rejected and refuses to overwrite: the protective stance). Every
 * FUTURE field is optional/default with the guards relaxed in the same
 * commit (the 0003 lesson, decisions/0005 field-evolution discipline).
 */
import { z } from 'zod'
import type {
  DeclareImportRequestBody,
  WorkbenchMutateRequestBody,
  WorkbenchKnowledgeMutateRequestBody,
  WorkbenchKnowledgeRecord,
  WorkbenchRecord,
} from '../workbench-shared/protocol.js'
import { WORKBENCH_INLINE_MAX_CHARS, WORKBENCH_STAGES } from '../workbench-shared/protocol.js'

const STAGE_OR_CLOSED_VALUES = [...WORKBENCH_STAGES, 'closed'] as const
const FINDING_CATEGORY_VALUES = ['feasibility', 'conflict', 'compatibility', 'risk', 'capacity', 'other'] as const
const SEVERITY_VALUES = ['high', 'medium', 'low'] as const
const FINDING_STATUS_VALUES = ['open', 'resolved', 'wont-fix'] as const
const WORK_PACKAGE_STATUS_VALUES = ['planned', 'plan-draft', 'plan-approved', 'in-dev', 'built', 'accepted', 'dropped'] as const
const SESSION_PURPOSE_VALUES = ['analysis', 'dev', 'review'] as const
const RELEASE_TYPE_VALUES = ['sql', 'config', 'flag', 'mq', 'other'] as const
const RELEASE_STATUS_VALUES = ['pending', 'confirmed', 'applied', 'verified', 'rolled-back'] as const
/**
 * TWO verdict enums, deliberately (P5b). The STORAGE side accepts 'proposed'
 * — the host-minted seed state for an AI-proposed finding. The INPUT side
 * does not: a client must never be able to write one, and editing a proposed
 * row forces the user to land on a real ruling. These two schemas used to
 * share one constant; adding the third value without splitting would have
 * quietly handed the AI-proposal state to the client and undone §5.3's
 * 「AI 提议 / 用户裁决」separation (the ReleaseItem.status 'pending'
 * discipline: SaveReleaseItemSchema carries no status field either).
 */
const VERDICT_INPUT_VALUES = ['confirmed', 'rejected'] as const
const VERDICT_STORAGE_VALUES = ['proposed', 'confirmed', 'rejected'] as const
const DISPOSITION_VALUES = ['to-fix', 'fixed', 'wont-fix'] as const
const CANDIDATE_TYPE_VALUES = ['business', 'convention'] as const
const CANDIDATE_STATUS_VALUES = ['pending', 'promoted', 'dismissed'] as const

/**
 * The ledger's id column constraints (the LedgerBranchSchema precedent):
 * every writer must hold a row against THESE patterns — a violating row
 * poisons the whole file on the next load (schema-degraded), not just its
 * own record. The patterns mirror the wire guards (protocol.ts 细化② layer 1);
 * the host re-asserts them before every artifact path join (layer 2).
 */
const WorkPackageIdSchema = z.string().regex(/^WP[1-9]\d*$/)
const CriterionIdSchema = z.string().regex(/^C[1-9]\d*$/)
const ReleaseItemIdSchema = z.string().regex(/^R\d{4,}$/)
/** sha256 hex, lowercase — the only form the host ever writes. */
const ContentHashSchema = z.string().regex(/^[0-9a-f]{64}$/)
const SessionIdSchema = z.string().min(1).max(256)
const TimestampSchema = z.iso.datetime({ offset: true })

export const PlanEntrySchema = z.object({
  version: z.number().int().positive(),
  approvedAt: TimestampSchema.optional(),
  note: z.string().max(2000).optional(),
  contentHash: ContentHashSchema.optional(),
})

const SessionBindingSchema = z.object({
  sessionId: SessionIdSchema,
  purpose: z.enum(SESSION_PURPOSE_VALUES),
  boundAt: TimestampSchema,
})

const CommitRefSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{7,40}$/),
  repoId: z.uuid().optional(),
  note: z.string().max(2000),
  at: TimestampSchema,
})

const AcceptanceSchema = z.object({
  at: TimestampSchema,
  result: z.enum(['pass', 'fail']),
  note: z.string().max(2000).optional(),
})

export const WorkbenchWorkPackageSchema = z.object({
  id: WorkPackageIdSchema,
  title: z.string().trim().min(1).max(64),
  boundary: z.string().max(2000),
  order: z.number().int().nonnegative(),
  dependsOn: z.array(WorkPackageIdSchema),
  parallel: z.boolean().optional(),
  covers: z.array(CriterionIdSchema),
  status: z.enum(WORK_PACKAGE_STATUS_VALUES),
  plans: z.array(PlanEntrySchema),
  sessions: z.array(SessionBindingSchema),
  commits: z.array(CommitRefSchema),
  acceptances: z.array(AcceptanceSchema),
})

export const WorkbenchFindingSchema = z.object({
  id: z.uuid(),
  category: z.enum(FINDING_CATEGORY_VALUES),
  severity: z.enum(SEVERITY_VALUES),
  title: z.string().trim().min(1).max(64),
  // Inline ledger text — the shared cap is the one truth (D4-⑤).
  detail: z.string().max(WORKBENCH_INLINE_MAX_CHARS),
  status: z.enum(FINDING_STATUS_VALUES),
  resolution: z.string().max(2000).optional(),
  sessionId: SessionIdSchema.optional(),
  createdAt: TimestampSchema,
})

export const WorkbenchCriterionSchema = z.object({
  id: CriterionIdSchema,
  text: z.string().max(2000),
  sourceSection: z.string().max(256).optional(),
  coveredBy: z.array(WorkPackageIdSchema), // work-package ids, NOT criterion ids (research §6.1: coveredBy: moduleId[] — a C-pattern here poisons the file on the first covering save)
})

const ReviewVerdictSchema = z.object({
  id: z.uuid().optional(),
  title: z.string().trim().min(1).max(64),
  severity: z.enum(SEVERITY_VALUES),
  verdict: z.enum(VERDICT_STORAGE_VALUES),
  disposition: z.enum(DISPOSITION_VALUES).optional(),
  note: z.string().max(2000).optional(),
})

export const ReviewReportEntrySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  at: TimestampSchema,
  title: z.string().max(128).optional(),
  contentHash: ContentHashSchema.optional(),
  verdicts: z.array(ReviewVerdictSchema),
})

export const ReleaseItemSchema = z.object({
  id: ReleaseItemIdSchema,
  type: z.enum(RELEASE_TYPE_VALUES),
  title: z.string().trim().min(1).max(64),
  // Inline ledger text — the shared cap is the one truth (D4-⑤).
  content: z.string().max(WORKBENCH_INLINE_MAX_CHARS),
  contentHash: ContentHashSchema,
  envs: z.array(z.string().min(1).max(64)),
  workPackageId: WorkPackageIdSchema.optional(),
  sessionId: SessionIdSchema.optional(),
  status: z.enum(RELEASE_STATUS_VALUES),
  appliedAt: TimestampSchema.optional(),
  note: z.string().max(2000).optional(),
})

export const KnowledgeCandidateSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(64),
  // Inline ledger text — the shared cap is the one truth (D4-⑤).
  draft: z.string().max(WORKBENCH_INLINE_MAX_CHARS),
  type: z.enum(CANDIDATE_TYPE_VALUES),
  proposedSessionId: SessionIdSchema.optional(),
  at: TimestampSchema,
  status: z.enum(CANDIDATE_STATUS_VALUES),
})

const StageChangeSchema = z.object({
  stage: z.enum(STAGE_OR_CLOSED_VALUES),
  at: TimestampSchema,
  note: z.string().max(2000).optional(),
})

// Analysis proposals (回传轮) — caps per field EQUAL the formal-row caps
// (finding title 64 / detail 32K; criterion text 2000 / sourceSection 256):
// parse caps mirror these, so a seeded row always survives load().
export const ProposedFindingSchema = z.object({
  id: z.uuid(),
  category: z.enum(FINDING_CATEGORY_VALUES),
  severity: z.enum(SEVERITY_VALUES),
  title: z.string().trim().min(1).max(64),
  detail: z.string().max(WORKBENCH_INLINE_MAX_CHARS).optional(),
})

export const ProposedCriterionSchema = z.object({
  id: z.uuid(),
  text: z.string().min(1).max(2000),
  sourceSection: z.string().max(256).optional(),
})

/** 文件交付轮: caps equal the criterion caps (question/recommendation/answer 2000, blocks 256) — parse caps mirror these. */
export const ProposedClarificationSchema = z.object({
  id: z.uuid(),
  question: z.string().trim().min(1).max(2000),
  recommendation: z.string().max(2000).optional(),
  blocks: z.string().max(256).optional(),
  answer: z.string().max(2000).optional(),
  answeredAt: TimestampSchema.optional(),
})

export const AnalysisProposalsSchema = z.object({
  session: z.object({
    sessionId: SessionIdSchema,
    boundAt: TimestampSchema,
    anchor: z.string().min(1).max(512).optional(),
  }),
  seed: z.object({
    sessionId: SessionIdSchema,
    contentHash: ContentHashSchema,
    seededAt: TimestampSchema,
    findings: z.number().int().nonnegative(),
    criteria: z.number().int().nonnegative(),
    clarifications: z.number().int().nonnegative().optional(),
    /** 0007 stage-ready proposal — consultation only, never auto-advance. */
    stageReady: z.boolean().optional(),
  }).optional(),
  findings: z.array(ProposedFindingSchema),
  criteria: z.array(ProposedCriterionSchema),
  /** 文件交付轮 third proposal group — optional per the field-evolution discipline. */
  clarifications: z.array(ProposedClarificationSchema).optional(),
})

const SplitBaselinePrdSchema = z.object({
  name: z.string().min(1).max(256),
  size: z.number().int().nonnegative(),
  modifiedAt: z.number().int().nonnegative(),
})

/**
 * Stale-reconciliation baseline (P5b). Sub-fields are REQUIRED (no legacy
 * data predates the field itself, and a half-populated baseline would make
 * the comparison lie — the protective stance from the file header). The two
 * 0007 additions are the exception — OPTIONAL by the field-evolution
 * discipline: baselines minted before 0007 carry neither, and absent reads
 * as absent on the compare side (never a false stale).
 */
const SplitBaselineSchema = z.object({
  at: TimestampSchema,
  prd: z.array(SplitBaselinePrdSchema),
  disposedFindings: z.number().int().nonnegative(),
  understandApprovedAt: TimestampSchema.optional(),
  answeredClarifications: z.number().int().nonnegative().optional(),
  /** 0008 D4: the requirement-baseline doc hash the finalized understand carried (absent = pre-0008 / no doc). */
  requirementDocHash: z.string().min(1).optional(),
})

// 0007 定稿软门 — the understand-finalize credential. Sub-fields REQUIRED
// (the same half-populated-baseline-lies stance); HOST-MINTED ONLY, never on
// any input schema (approveUnderstand carries zero payload).
const UnderstandBaselineCriterionSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(2000),
  sourceSection: z.string().max(256).optional(),
})

const UnderstandBaselineFindingSchema = z.object({
  id: z.uuid(),
  status: z.enum(FINDING_STATUS_VALUES),
  category: z.enum(FINDING_CATEGORY_VALUES),
  severity: z.enum(SEVERITY_VALUES),
  title: z.string().min(1).max(64),
})

const UnderstandBaselineClarificationSchema = z.object({
  question: z.string().min(1).max(2000),
  answer: z.string().min(1).max(2000),
})

const UnderstandBaselineSchema = z.object({
  at: TimestampSchema,
  criteria: z.array(UnderstandBaselineCriterionSchema),
  findings: z.array(UnderstandBaselineFindingSchema),
  clarifications: z.array(UnderstandBaselineClarificationSchema),
  /** 0008: disk sha256 of `.skyaxis/requirements/<rid>.md` at finalize (IO-derived, host-minted only). */
  docHash: z.string().min(1).optional(),
})

export const WorkbenchRecordSchema = z.object({
  requirementId: z.uuid(),
  stage: z.enum(STAGE_OR_CLOSED_VALUES),
  stageHistory: z.array(StageChangeSchema),
  /** Hard gate ① stamp — host-set-only (approveSplit / revokeSplitApproval). */
  splitApprovedAt: TimestampSchema.optional(),
  /** S5 go/no-go third condition — host-set-only (confirm/revokeRollbackPlan). */
  rollbackPlanConfirmedAt: TimestampSchema.optional(),
  /** P5b stale baseline — present exactly while the split is approved. */
  splitBaseline: SplitBaselineSchema.optional(),
  /** 0007 定稿软门 stamp — host-set-only (approve/revokeUnderstand). */
  understandApprovedAt: TimestampSchema.optional(),
  /** 0007 credential snapshot — minted with the stamp, stripped with it. */
  understandBaseline: UnderstandBaselineSchema.optional(),
  criteria: z.array(WorkbenchCriterionSchema),
  findings: z.array(WorkbenchFindingSchema),
  workPackages: z.array(WorkbenchWorkPackageSchema),
  releaseItems: z.array(ReleaseItemSchema),
  reviewReports: z.array(ReviewReportEntrySchema),
  knowledgeCandidates: z.array(KnowledgeCandidateSchema),
  /** Analysis-proposal container — optional per the field-evolution discipline. */
  analysis: AnalysisProposalsSchema.optional(),
})

export const WorkbenchFileSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  records: z.array(WorkbenchRecordSchema),
})

/** Parse output, with the protocol's readonly array face (records are shared immutable). */
export type WorkbenchFile = Omit<z.infer<typeof WorkbenchFileSchema>, 'records'> & {
  records: readonly WorkbenchRecord[]
}

// ---------------------------------------------------------------------------
// knowledge.yaml — host-internal this round (no HTTP endpoint, no wire types;
// consumed by the FileStore, the D6 cascade and the tombstone snapshot). The
// P2 injection endpoint brings its wire types in the same commit as the
// route (the protocol iron rule applied forward, not a reservation excuse).
// ---------------------------------------------------------------------------

/**
 * scope-resolved ownership keys, distinct from provenance (birthplace audit):
 * promote changes scope while provenance stays — mixing them would strand
 * promoted rows off their origin or fake a live requirement binding.
 */
export const KnowledgeRecordSchema = z.object({
  id: z.uuid(),
  scope: z.enum(['global', 'workspace', 'requirement']),
  type: z.enum(CANDIDATE_TYPE_VALUES),
  title: z.string().trim().min(1).max(64),
  // knowledge.yaml content stays inline — a record-attribute snippet (D4-⑤).
  content: z.string().max(WORKBENCH_INLINE_MAX_CHARS),
  /** Workspace-scope ownership key (research 0006 §6.2「workspace 带 path」). */
  path: z.string().min(1).max(4096).optional(),
  /** Requirement-scope ownership key — what the D6 cascade filters on. */
  requirementId: z.uuid().optional(),
  trigger: z.object({
    mode: z.enum(['always', 'path', 'keyword', 'manual']),
    value: z.string().max(256).optional(),
  }),
  status: z.enum(['active', 'archived']),
  provenance: z.object({
    requirementId: z.uuid().optional(),
    sessionId: SessionIdSchema.optional(),
    at: TimestampSchema,
  }),
}).superRefine((row, ctx) => {
  if (row.scope === 'workspace' && row.path === undefined) {
    ctx.addIssue({ code: 'custom', message: 'workspace-scope knowledge requires path' })
  }
  if (row.scope === 'requirement' && row.requirementId === undefined) {
    ctx.addIssue({ code: 'custom', message: 'requirement-scope knowledge requires requirementId' })
  }
})

export type KnowledgeRecord = z.infer<typeof KnowledgeRecordSchema>

export const KnowledgeFileSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  records: z.array(KnowledgeRecordSchema),
})

export type KnowledgeFile = Omit<z.infer<typeof KnowledgeFileSchema>, 'records'> & {
  records: readonly KnowledgeRecord[]
}

// ---------------------------------------------------------------------------
// Endpoint request bodies
// ---------------------------------------------------------------------------

const AdvanceStageSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('advanceStage'),
  stage: z.enum(STAGE_OR_CLOSED_VALUES),
  note: z.string().max(2000).optional(),
})

const SaveFindingSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('saveFinding'),
  /** id present = edit, absent = create (id minted host-side). */
  finding: z.object({
    id: z.uuid().optional(),
    category: z.enum(FINDING_CATEGORY_VALUES),
    severity: z.enum(SEVERITY_VALUES),
    title: z.string().trim().min(1).max(64),
    detail: z.string().max(WORKBENCH_INLINE_MAX_CHARS),
    status: z.enum(FINDING_STATUS_VALUES),
    resolution: z.string().max(2000).optional(),
    sessionId: SessionIdSchema.optional(),
  }),
})

const RemoveFindingSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('removeFinding'),
  id: z.uuid(),
})

// Work-package CRUD — wire-level shape checks only; referential integrity
// (dependsOn/covers pointing at existing rows) lives in record-actions.ts
// where the parsed record is at hand.
const WorkPackageInputSchema = z.object({
  id: WorkPackageIdSchema.optional(),
  title: z.string().trim().min(1).max(64),
  boundary: z.string().max(2000),
  dependsOn: z.array(WorkPackageIdSchema),
  parallel: z.boolean().optional(),
  covers: z.array(CriterionIdSchema),
})

const SaveWorkPackageSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('saveWorkPackage'),
  workPackage: WorkPackageInputSchema,
})

const RemoveWorkPackageSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('removeWorkPackage'),
  id: WorkPackageIdSchema,
})

const MoveWorkPackageSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('moveWorkPackage'),
  id: WorkPackageIdSchema,
  direction: z.enum(['up', 'down']),
})

/** Client-supplied baseline input: no `at` — the host mints the stamp. */
const SplitBaselineInputSchema = z.object({
  prd: z.array(SplitBaselinePrdSchema),
})

const ApproveSplitSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('approveSplit'),
  baseline: SplitBaselineInputSchema.optional(),
})

const RevokeSplitApprovalSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('revokeSplitApproval'),
})

/** P5b §7.6: archive the active list (all → dropped) and reopen it for re-planning. */
const ReSplitSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('reSplit'),
})

/** P5b §7.6「确认仍有效」: re-mint the baseline, list untouched. */
const ConfirmSplitStillValidSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('confirmSplitStillValid'),
  baseline: SplitBaselineInputSchema,
})

const WorkPackageActionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  id: WorkPackageIdSchema,
})

const ApprovePlanSchema = WorkPackageActionSchema.extend({ action: z.literal('approvePlan') })
const StartWorkPackageSchema = WorkPackageActionSchema.extend({ action: z.literal('startWorkPackage') })
const MarkWorkPackageBuiltSchema = WorkPackageActionSchema.extend({ action: z.literal('markWorkPackageBuilt') })
const ReopenWorkPackageSchema = WorkPackageActionSchema.extend({ action: z.literal('reopenWorkPackage') })
const DropWorkPackageSchema = WorkPackageActionSchema.extend({ action: z.literal('dropWorkPackage') })
const RestoreWorkPackageSchema = WorkPackageActionSchema.extend({ action: z.literal('restoreWorkPackage') })

// The fail path's required rework note is enforced in record-actions.ts, not
// here: a superRefine on a discriminated-union member rides zod v4's refined
// union typing edge, and existence/state/required-note rules read better in
// one guard branch anyway.
const AcceptWorkPackageSchema = WorkPackageActionSchema.extend({
  action: z.literal('acceptWorkPackage'),
  result: z.enum(['pass', 'fail']),
  note: z.string().max(2000).optional(),
})

const SaveCriterionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('saveCriterion'),
  criterion: z.object({
    id: CriterionIdSchema.optional(),
    text: z.string().max(2000),
    sourceSection: z.string().max(256).optional(),
  }),
})

const RemoveCriterionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('removeCriterion'),
  id: CriterionIdSchema,
})

// Release items (S5, P3a) — OUTSIDE the split gate (the record-actions.ts
// note carries the three ratified reasons). The write-side shape omits the
// three host-owned fields (id on create, contentHash, status, appliedAt):
// the client never writes them, so the schema never accepts them — a
// smuggled `status: 'verified'` is a 400 here, not a business-guard trip.
const SaveReleaseItemSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('saveReleaseItem'),
  releaseItem: z.object({
    id: ReleaseItemIdSchema.optional(),
    type: z.enum(RELEASE_TYPE_VALUES),
    title: z.string().trim().min(1).max(64),
    content: z.string().max(WORKBENCH_INLINE_MAX_CHARS),
    envs: z.array(z.string().trim().min(1).max(64)),
    workPackageId: WorkPackageIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    note: z.string().max(2000).optional(),
  }),
})

const ReleaseItemActionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  id: ReleaseItemIdSchema,
})

const RemoveReleaseItemSchema = ReleaseItemActionSchema.extend({ action: z.literal('removeReleaseItem') })
const ConfirmReleaseItemSchema = ReleaseItemActionSchema.extend({ action: z.literal('confirmReleaseItem') })
const MarkReleaseItemAppliedSchema = ReleaseItemActionSchema.extend({ action: z.literal('markReleaseItemApplied') })
const MarkReleaseItemVerifiedSchema = ReleaseItemActionSchema.extend({ action: z.literal('markReleaseItemVerified') })
const RollbackReleaseItemSchema = ReleaseItemActionSchema.extend({ action: z.literal('rollbackReleaseItem') })

// Record-level rollback-plan stamp (the go/no-go third condition) — no id.
const ConfirmRollbackPlanSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('confirmRollbackPlan'),
})

const RevokeRollbackPlanSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('revokeRollbackPlan'),
})

// 0007 定稿软门 — record-level understand stamp pair, ZERO payload (the
// baseline is host-derived from the stamped record itself; the
// confirmRollbackPlan pair is the structural precedent).
const ApproveUnderstandSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('approveUnderstand'),
})

const RevokeUnderstandSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('revokeUnderstand'),
})

// Review reports (S4, P4) — OUTSIDE the split gate (see record-actions.ts).
// The rejected-note and rejected-no-disposition rules are BUSINESS guards in
// the pure core (the AcceptWorkPackage note applies: superRefine on a
// discriminated-union member rides zod v4's typing edge).
const ReviewVerdictInputSchema = z.object({
  id: z.uuid().optional(),
  title: z.string().trim().min(1).max(64),
  severity: z.enum(SEVERITY_VALUES),
  verdict: z.enum(VERDICT_INPUT_VALUES),
  disposition: z.enum(DISPOSITION_VALUES).optional(),
  note: z.string().max(2000).optional(),
})

export const SaveReviewVerdictSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('saveReviewVerdict'),
  reportId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  verdict: ReviewVerdictInputSchema,
})

export const RemoveReviewVerdictSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('removeReviewVerdict'),
  reportId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  id: z.uuid(),
})

export const RemoveReviewReportSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('removeReviewReport'),
  id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
})

export const SaveKnowledgeCandidateSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('saveKnowledgeCandidate'),
  candidate: z.object({
    title: z.string().trim().min(1).max(64),
    draft: z.string().max(WORKBENCH_INLINE_MAX_CHARS),
    type: z.enum(CANDIDATE_TYPE_VALUES),
  }),
})

// Session binding (P2) — under the lifecycle gate (split approved).
const BindSessionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('bindSession'),
  id: WorkPackageIdSchema,
  sessionId: SessionIdSchema,
  purpose: z.enum(SESSION_PURPOSE_VALUES),
})

// Knowledge candidates (S6, OUTSIDE the split gate). The activate promote's
// cross-ledger coupling rules (workspace ⇒ path, keyword ⇒ value) are
// business guards in record-actions, not superRefine — the discriminated-
// union member typing edge (the AcceptWorkPackage note applies here too).
const KnowledgeTriggerInputSchema = z.object({
  mode: z.enum(['always', 'keyword', 'manual', 'path']),
  value: z.string().max(256).optional(),
})

const ActivateKnowledgeCandidateSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('activateKnowledgeCandidate'),
  id: z.uuid(),
  knowledge: z.object({
    scope: z.enum(['global', 'workspace', 'requirement']),
    type: z.enum(CANDIDATE_TYPE_VALUES),
    trigger: KnowledgeTriggerInputSchema,
    path: z.string().min(1).max(4096).optional(),
  }),
})

const EditKnowledgeCandidateSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('editKnowledgeCandidate'),
  id: z.uuid(),
  candidate: z.object({
    title: z.string().trim().min(1).max(64),
    draft: z.string().max(WORKBENCH_INLINE_MAX_CHARS),
    type: z.enum(CANDIDATE_TYPE_VALUES),
  }),
})

const DismissKnowledgeCandidateSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('dismissKnowledgeCandidate'),
  id: z.uuid(),
})

// Analysis proposals (回传轮). NO proposal content ever rides the wire:
// seedAnalysis carries only the sessionId and the HOST reads+mints the rows
// (the P5b「input schema stays two-valued」discipline — a client cannot write
// a proposal, only rule on host-minted ones).
const BindAnalysisSessionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('bindAnalysisSession'),
  sessionId: SessionIdSchema,
  anchor: z.string().min(1).max(512).optional(),
})

const SeedAnalysisSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('seedAnalysis'),
  sessionId: SessionIdSchema,
})

const ProposalActionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  id: z.uuid(),
})

const AdoptFindingProposalSchema = ProposalActionSchema.extend({ action: z.literal('adoptFindingProposal') })
const DismissFindingProposalSchema = ProposalActionSchema.extend({ action: z.literal('dismissFindingProposal') })
const AdoptCriterionProposalSchema = ProposalActionSchema.extend({ action: z.literal('adoptCriterionProposal') })
const DismissCriterionProposalSchema = ProposalActionSchema.extend({ action: z.literal('dismissCriterionProposal') })

// 文件交付轮: the ANSWER is user content (the saveFinding payload discipline),
// not AI proposal content — it rides the wire because only the user knows it.
const AnswerAnalysisClarificationSchema = ProposalActionSchema.extend({
  action: z.literal('answerAnalysisClarification'),
  answer: z.string().trim().min(1).max(2000),
})
const DismissAnalysisClarificationSchema = ProposalActionSchema.extend({ action: z.literal('dismissAnalysisClarification') })

export const WorkbenchMutateSchema = z.discriminatedUnion('action', [
  AdvanceStageSchema,
  SaveFindingSchema,
  RemoveFindingSchema,
  SaveWorkPackageSchema,
  RemoveWorkPackageSchema,
  MoveWorkPackageSchema,
  ApproveSplitSchema,
  RevokeSplitApprovalSchema,
  ReSplitSchema,
  ConfirmSplitStillValidSchema,
  ApprovePlanSchema,
  StartWorkPackageSchema,
  MarkWorkPackageBuiltSchema,
  AcceptWorkPackageSchema,
  ReopenWorkPackageSchema,
  DropWorkPackageSchema,
  RestoreWorkPackageSchema,
  SaveCriterionSchema,
  RemoveCriterionSchema,
  ApproveUnderstandSchema,
  RevokeUnderstandSchema,
  SaveReleaseItemSchema,
  RemoveReleaseItemSchema,
  ConfirmReleaseItemSchema,
  MarkReleaseItemAppliedSchema,
  MarkReleaseItemVerifiedSchema,
  RollbackReleaseItemSchema,
  ConfirmRollbackPlanSchema,
  RevokeRollbackPlanSchema,
  SaveReviewVerdictSchema,
  RemoveReviewVerdictSchema,
  RemoveReviewReportSchema,
  SaveKnowledgeCandidateSchema,
  BindSessionSchema,
  ActivateKnowledgeCandidateSchema,
  EditKnowledgeCandidateSchema,
  DismissKnowledgeCandidateSchema,
  BindAnalysisSessionSchema,
  SeedAnalysisSchema,
  AdoptFindingProposalSchema,
  DismissFindingProposalSchema,
  AdoptCriterionProposalSchema,
  DismissCriterionProposalSchema,
  AnswerAnalysisClarificationSchema,
  DismissAnalysisClarificationSchema,
])

// ---------------------------------------------------------------------------
// knowledge.yaml mutate route (P2) — its OWN union and optimistic lock (the
// ledger is a global asset store; no implicit-record semantics). The wire
// trigger surface keeps all four modes; the P2 UI only produces three.
// ---------------------------------------------------------------------------

const SaveKnowledgeSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  action: z.literal('saveKnowledge'),
  knowledge: z.object({
    id: z.uuid().optional(),
    scope: z.enum(['global', 'workspace', 'requirement']),
    type: z.enum(CANDIDATE_TYPE_VALUES),
    title: z.string().trim().min(1).max(64),
    content: z.string().max(WORKBENCH_INLINE_MAX_CHARS),
    path: z.string().min(1).max(4096).optional(),
    requirementId: z.uuid().optional(),
    trigger: z.object({
      mode: z.enum(['always', 'path', 'keyword', 'manual']),
      value: z.string().max(256).optional(),
    }),
  }),
})

const ArchiveKnowledgeSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  action: z.literal('archiveKnowledge'),
  id: z.uuid(),
})

export const WorkbenchKnowledgeMutateSchema = z.discriminatedUnion('action', [
  SaveKnowledgeSchema,
  ArchiveKnowledgeSchema,
])

// ---------------------------------------------------------------------------
// Declare import route (P3b) — its own body schema (the route is separate
// from the main union; see protocol.ts).
// ---------------------------------------------------------------------------

export const DeclareImportSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  dryRun: z.boolean().optional(),
  text: z.string().min(1),
  sessionId: SessionIdSchema.optional(),
  selected: z.array(z.string().min(1).max(64)).optional(),
})

// ---------------------------------------------------------------------------
// Compile-time alignment with the shared protocol (drift = type error)
// ---------------------------------------------------------------------------

// LIVE assertions (挂账轮): every pair is a const assignment — a direction
// flip errors the build, unlike the alias-only forms this file carried until
// now (an unused `? true : never` alias never errors; verified by mutation
// in P3a, which is why they were rewritten). Direction is uniformly
// Schema→Protocol, the readonly-tolerant way (zod infers mutable arrays;
// the reverse fails structurally on every readonly field). Required-field
// drift trips these; optional-field drift stays the disk round-trip tests'
// job (workbench-file.test) and the declare endpoint tests' job (wire).

/* eslint-disable @typescript-eslint/no-unused-vars */
const _SchemaWorkbenchRecordAssignableToProtocol: z.infer<typeof WorkbenchRecordSchema> extends WorkbenchRecord ? true : never = true
const _MutateRequestAligned: z.infer<typeof WorkbenchMutateSchema> extends WorkbenchMutateRequestBody ? true : never = true
const _KnowledgeMutateAligned: z.infer<typeof WorkbenchKnowledgeMutateSchema> extends WorkbenchKnowledgeMutateRequestBody ? true : never = true
const _KnowledgeRecordAligned: z.infer<typeof KnowledgeRecordSchema> extends WorkbenchKnowledgeRecord ? true : never = true
const _DeclareImportRequestAligned: z.infer<typeof DeclareImportSchema> extends DeclareImportRequestBody ? true : never = true
