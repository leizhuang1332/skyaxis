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
  WorkbenchMutateRequestBody,
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
const VERDICT_OUTCOME_VALUES = ['confirmed', 'rejected'] as const
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
  coveredBy: z.array(CriterionIdSchema),
})

const ReviewVerdictSchema = z.object({
  title: z.string().trim().min(1).max(64),
  severity: z.enum(SEVERITY_VALUES),
  verdict: z.enum(VERDICT_OUTCOME_VALUES),
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

export const WorkbenchRecordSchema = z.object({
  requirementId: z.uuid(),
  stage: z.enum(STAGE_OR_CLOSED_VALUES),
  stageHistory: z.array(StageChangeSchema),
  /** Hard gate ① stamp — host-set-only (approveSplit / revokeSplitApproval). */
  splitApprovedAt: TimestampSchema.optional(),
  criteria: z.array(WorkbenchCriterionSchema),
  findings: z.array(WorkbenchFindingSchema),
  workPackages: z.array(WorkbenchWorkPackageSchema),
  releaseItems: z.array(ReleaseItemSchema),
  reviewReports: z.array(ReviewReportEntrySchema),
  knowledgeCandidates: z.array(KnowledgeCandidateSchema),
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

const ApproveSplitSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('approveSplit'),
})

const RevokeSplitApprovalSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirementId: z.uuid(),
  action: z.literal('revokeSplitApproval'),
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

export const WorkbenchMutateSchema = z.discriminatedUnion('action', [
  AdvanceStageSchema,
  SaveFindingSchema,
  RemoveFindingSchema,
  SaveWorkPackageSchema,
  RemoveWorkPackageSchema,
  MoveWorkPackageSchema,
  ApproveSplitSchema,
  RevokeSplitApprovalSchema,
  ApprovePlanSchema,
  StartWorkPackageSchema,
  MarkWorkPackageBuiltSchema,
  AcceptWorkPackageSchema,
  ReopenWorkPackageSchema,
  DropWorkPackageSchema,
  SaveCriterionSchema,
  RemoveCriterionSchema,
])

// ---------------------------------------------------------------------------
// Compile-time alignment with the shared protocol (drift = type error)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-unused-vars */
type _ProtocolWorkbenchRecordAssignableToSchema = WorkbenchRecord extends z.infer<typeof WorkbenchRecordSchema> ? true : never
type _SchemaWorkbenchRecordAssignableToProtocol = z.infer<typeof WorkbenchRecordSchema> extends WorkbenchRecord ? true : never
type _MutateRequestAligned = WorkbenchMutateRequestBody extends z.infer<typeof WorkbenchMutateSchema> ? true : never
