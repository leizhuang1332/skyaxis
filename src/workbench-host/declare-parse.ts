/**
 * Declare-block parsing (P3b) — pure functions, no IO (the repos-pool
 * import.ts two-layer discipline):
 *
 *  - findDeclareFence: SHAPE only — locates the LAST CLOSED column-0 fenced
 *    block whose first non-empty line is the `# skyaxis-declare` marker.
 *    Column-0 only (the declare block is top-level output, never a nested
 *    list item); closed only (a truncated/interrupted turn leaves the fence
 *    open and simply does not extract — no half-block ever parses).
 *  - parseDeclare: LEGALITY + ADMISSIBILITY — strict YAML.parse (bare
 *    catch: the yaml library throws ReferenceError on alias bombs, not just
 *    YAMLParseError — the repos-pool note), then per-row validation against
 *    the loaded record. Whole-block syntax failures return a blockError
 *    (envelope, not a 400 — the paste path must keep the text editable);
 *    row-level failures land in skipped[] with closed-enum reasons —
 *    「坏行跳过并列出，不整块拒绝」.
 *
 * Known top-level keys only: workPackage / claims / artifacts / knowledge /
 * stageReady + the analysis proposal keys (findings / criteria /
 * clarifications — 回传轮与文件交付轮; they ride proposals[], not entries[])
 * + the split proposal key (workPackages — 0012 拆分结果文件通道轮; same
 * proposals[] discipline). Unknown keys are ignored silently (YAGNI — the
 * generated SOW skeleton teaches exactly these). The block-level workPackage
 * scopes BOTH built claims and artifacts; absent ⇒ built claims are
 * targetless ('bad-shape') while artifacts import without an owning package.
 */
import YAML from 'yaml'
import type {
  DeclareArtifactEntry,
  DeclareBuiltEntry,
  DeclareEntry,
  DeclareKnowledgeEntry,
  DeclareSkip,
  DeclareSkipReason,
  WorkbenchFinding,
  WorkbenchRecord,
} from '../workbench-shared/protocol.js'
import { WORKBENCH_INLINE_MAX_CHARS } from '../workbench-shared/protocol.js'
import { contentHashOf } from './artifact-store.js'
// fence.ts owns the marker-agnostic fence + error helpers (shared with the
// review parser); this module keeps only the declare-specific vocabulary.
import { asString, errorLine, findMarkerFence, isRecord, rowLabel } from './fence.js'

const DECLARE_MARKER = '# skyaxis-declare'
/** 0012: the suggested-ordinal / criterion-id shapes (the wire id predicates' regexes, parse-local). */
const WORK_PACKAGE_REF_RE = /^WP[1-9]\d*$/
const CRITERION_REF_RE = /^C[1-9]\d*$/
const RELEASE_TYPES: readonly string[] = ['sql', 'config', 'flag', 'mq', 'other']
const KNOWLEDGE_TYPES: readonly string[] = ['business', 'convention']
const FINDING_CATEGORIES: readonly string[] = ['feasibility', 'conflict', 'compatibility', 'risk', 'capacity', 'other']
const SEVERITIES: readonly string[] = ['high', 'medium', 'low']

/**
 * One parsed FINDING proposal (analysis declare block) — CONTENT only: the
 * host mints the ledger row id at seed time, so the parse stays reusable and
 * the input side never carries an id it could forge.
 */
export interface DeclareFindingRow {
  readonly category: WorkbenchFinding['category']
  readonly severity: WorkbenchFinding['severity']
  readonly title: string
  readonly detail?: string
}

/** One parsed CRITERION proposal (analysis declare block) — content only, same discipline. */
export interface DeclareCriterionRow {
  readonly text: string
  readonly sourceSection?: string
}

/** One parsed CLARIFICATION proposal (文件交付轮) — content only, same discipline (id is host-minted at seed time). */
export interface DeclareClarificationRow {
  readonly question: string
  readonly recommendation?: string
  readonly blocks?: string
}

/**
 * One parsed WORK-PACKAGE proposal (0012) — content only: `ref` is the
 * session's suggested ordinal (batch-internal reference, never an id —
 * adoptSplitProposals mints the real one). Caps equal the storage caps
 * (title 1..64 / boundary 2000 — the WorkbenchWorkPackageSchema caps).
 */
export interface DeclareWorkPackageRow {
  readonly ref: string
  readonly title: string
  readonly boundary: string
  readonly dependsOn: readonly string[]
  readonly parallel?: boolean
  readonly covers: readonly string[]
}

/**
 * Analysis proposals ride DeclareParseSuccess as a SEPARATE field, never
 * inside entries[]: entries are the S5 import-preview wire face (declare
 * preview response + import modal default-checks every non-duplicate entry),
 * and proposal rows have no commit path there — the seedAnalysis flow is
 * their only consumer. Keeping them out means the S5 wire and modal stay
 * byte-identical whether or not a block carries proposals.
 */
export interface DeclareProposals {
  readonly findings: readonly DeclareFindingRow[]
  readonly criteria: readonly DeclareCriterionRow[]
  readonly clarifications: readonly DeclareClarificationRow[]
  /** 0012: the split session's work-package suggestions (the split result file's declare block). */
  readonly workPackages: readonly DeclareWorkPackageRow[]
}

export interface DeclareParseSuccess {
  ok: true
  entries: readonly DeclareEntry[]
  skipped: readonly DeclareSkip[]
  stageReady: boolean
  readonly proposals: DeclareProposals
  /** 0016 P2a: advisory delivery metadata (summary / files / verification) — never gates the import. */
  readonly declareSummary?: string
  readonly declareFiles?: readonly string[]
  readonly declareVerification?: readonly { command: string; outcome: string }[]
  /** 0016 P2b: commit proposals — hash+note pairs the user confirms into wp.commits[]（未校验标注）. */
  readonly declareCommits?: readonly { hash: string; note: string }[]
}

export interface DeclareParseBlockError {
  ok: false
  blockError: 'no-declare-block' | 'yaml-syntax'
  blockErrorLine?: number
}

export type DeclareParseResult = DeclareParseSuccess | DeclareParseBlockError

/** The LAST declare-marker fence body in `text`, or null (see findMarkerFence). */
export function findDeclareFence(text: string): string | null {
  return findMarkerFence(text, DECLARE_MARKER)
}

function skipOf(key: string, label: string, reason: DeclareSkipReason): DeclareSkip {
  return { key, label, reason }
}

export function parseDeclare(input: { text: string; record: WorkbenchRecord }): DeclareParseResult {
  const fence = findDeclareFence(input.text)
  if (fence === null) return { ok: false, blockError: 'no-declare-block' }

  let document: unknown
  try {
    document = YAML.parse(fence)
  } catch (error) {
    return { ok: false, blockError: 'yaml-syntax', ...(errorLine(error) !== undefined ? { blockErrorLine: errorLine(error) } : {}) }
  }
  // Comment-only / empty fences parse to null — an empty declare, not an error.
  const doc = isRecord(document) ? document : {}

  const entries: DeclareEntry[] = []
  const skipped: DeclareSkip[] = []

  // Block-level workPackage scope: resolved once, referenced by built + artifacts.
  const scopeRaw = asString(doc.workPackage)?.trim()
  const scope = scopeRaw !== undefined && scopeRaw.length > 0 ? scopeRaw : undefined
  const scopeWp = scope !== undefined ? input.record.workPackages.find((wp) => wp.id === scope) : undefined
  const scopeValid = scope === undefined || scopeWp !== undefined

  const claims = Array.isArray(doc.claims) ? doc.claims : []
  claims.forEach((claim, index) => {
    const key = `built-${index}`
    if (!isRecord(claim) || claim.built !== true) {
      skipped.push(skipOf(key, rowLabel(claim), 'bad-shape'))
      return
    }
    if (scope === undefined) {
      skipped.push(skipOf(key, rowLabel(claim), 'bad-shape')) // built without a target
      return
    }
    if (!scopeValid) {
      skipped.push(skipOf(key, scope, 'wp-not-found'))
      return
    }
    if (input.record.splitApprovedAt === undefined || (scopeWp!.status !== 'in-dev' && scopeWp!.status !== 'built')) {
      skipped.push(skipOf(key, scope, 'wp-not-in-dev'))
      return
    }
    // 0030 D2-A: 收取即翻转 makes a built WP the import face's COMMON shape —
    // the built claim already landed in the seed write; disclose as a benign
    // skip, never the error-toned「不可标记 built」judgment.
    if (scopeWp!.status === 'built') {
      skipped.push(skipOf(key, scope, 'wp-already-built'))
      return
    }
    entries.push({ kind: 'built', key, workPackageId: scope } satisfies DeclareBuiltEntry)
  })

  const artifacts = Array.isArray(doc.artifacts) ? doc.artifacts : []
  artifacts.forEach((row, index) => {
    const key = `artifact-${index}`
    if (!isRecord(row)) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-shape'))
      return
    }
    const type = asString(row.type)
    if (type === undefined || !RELEASE_TYPES.includes(type)) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-type'))
      return
    }
    const title = asString(row.title)?.trim()
    if (title === undefined || title.length === 0 || title.length > 64) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-title'))
      return
    }
    const content = asString(row.content)
    if (content === undefined || content.length === 0) {
      skipped.push(skipOf(key, title, 'bad-content'))
      return
    }
    if (content.length > WORKBENCH_INLINE_MAX_CHARS) {
      skipped.push(skipOf(key, title, 'over-cap'))
      return
    }
    const envsRaw = row.envs
    let envs: readonly string[]
    if (envsRaw === undefined) {
      envs = []
    } else if (Array.isArray(envsRaw) && envsRaw.every((e) => asString(e) !== undefined)) {
      envs = (envsRaw as unknown[]).map((e) => e as string)
      if (envs.some((env) => env.trim().length === 0 || env.length > 64)) {
        skipped.push(skipOf(key, title, 'bad-envs'))
        return
      }
      envs = envs.map((env) => env.trim())
    } else {
      skipped.push(skipOf(key, title, 'bad-envs'))
      return
    }
    if (!scopeValid) {
      skipped.push(skipOf(key, title, 'wp-not-found'))
      return
    }
    const contentHash = contentHashOf(content)
    const duplicate = input.record.releaseItems.some((item) => item.type === type && item.title === title && item.contentHash === contentHash)
    entries.push({
      kind: 'artifact',
      key,
      type: type as DeclareArtifactEntry['type'],
      title,
      content,
      envs,
      ...(scope !== undefined ? { workPackageId: scope } : {}),
      duplicate,
    } satisfies DeclareArtifactEntry)
  })

  const knowledge = Array.isArray(doc.knowledge) ? doc.knowledge : []
  knowledge.forEach((row, index) => {
    const key = `knowledge-${index}`
    if (!isRecord(row)) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-shape'))
      return
    }
    const type = asString(row.type)
    if (type === undefined || !KNOWLEDGE_TYPES.includes(type)) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-type'))
      return
    }
    const title = asString(row.title)?.trim()
    if (title === undefined || title.length === 0 || title.length > 64) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-title'))
      return
    }
    const draft = asString(row.draft)
    if (draft === undefined || draft.length === 0) {
      skipped.push(skipOf(key, title, 'bad-content'))
      return
    }
    if (draft.length > WORKBENCH_INLINE_MAX_CHARS) {
      skipped.push(skipOf(key, title, 'over-cap'))
      return
    }
    const duplicate = input.record.knowledgeCandidates.some((c) => c.type === type && c.title === title && c.draft === draft)
    entries.push({ kind: 'knowledge', key, type: type as DeclareKnowledgeEntry['type'], title, draft, duplicate } satisfies DeclareKnowledgeEntry)
  })

  // --- analysis proposals (findings / criteria) — parse caps MUST equal the
  // storage caps (finding title 1..64 / detail 32K; criterion text 2000 /
  // sourceSection 256): an over-cap row the host minted into the ledger
  // would poison its record shard on next load (the nextReleaseItemId
  // lesson; 0032 narrowed the blast radius from the whole ledger to one
  // requirement — the cap still matters). Over-cap rows are SKIPPED, never
  // truncated — truncation is a silent data edit.
  const findings: DeclareFindingRow[] = []
  const findingRows = Array.isArray(doc.findings) ? doc.findings : []
  findingRows.forEach((row, index) => {
    const key = `finding-${index}`
    if (!isRecord(row)) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-shape'))
      return
    }
    const category = asString(row.category)
    if (category === undefined || !FINDING_CATEGORIES.includes(category)) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-type'))
      return
    }
    const severity = asString(row.severity)
    if (severity === undefined || !SEVERITIES.includes(severity)) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-severity'))
      return
    }
    const title = asString(row.title)?.trim()
    if (title === undefined || title.length === 0 || title.length > 64) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-title'))
      return
    }
    const detailRaw = asString(row.detail)?.trim()
    if (detailRaw !== undefined && detailRaw.length > WORKBENCH_INLINE_MAX_CHARS) {
      skipped.push(skipOf(key, title, 'over-cap'))
      return
    }
    findings.push({
      category: category as WorkbenchFinding['category'],
      severity: severity as WorkbenchFinding['severity'],
      title,
      ...(detailRaw !== undefined && detailRaw.length > 0 ? { detail: detailRaw } : {}),
    })
  })

  const criteria: DeclareCriterionRow[] = []
  const criterionRows = Array.isArray(doc.criteria) ? doc.criteria : []
  criterionRows.forEach((row, index) => {
    const key = `criterion-${index}`
    if (!isRecord(row)) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-shape'))
      return
    }
    const text = asString(row.text)?.trim()
    if (text === undefined || text.length === 0) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-content'))
      return
    }
    if (text.length > 2000) {
      skipped.push(skipOf(key, rowLabel(row), 'over-cap'))
      return
    }
    const sourceRaw = asString(row.sourceSection)?.trim()
    if (sourceRaw !== undefined && sourceRaw.length > 256) {
      skipped.push(skipOf(key, rowLabel(row), 'over-cap'))
      return
    }
    criteria.push({
      text,
      ...(sourceRaw !== undefined && sourceRaw.length > 0 ? { sourceSection: sourceRaw } : {}),
    })
  })

  // --- clarifications (文件交付轮) — caps equal the criterion caps (question/
  // recommendation 2000, blocks 256): same storage-cap = parse-cap rule.
  const clarifications: DeclareClarificationRow[] = []
  const clarificationRows = Array.isArray(doc.clarifications) ? doc.clarifications : []
  clarificationRows.forEach((row, index) => {
    const key = `clarification-${index}`
    if (!isRecord(row)) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-shape'))
      return
    }
    const question = asString(row.question)?.trim()
    if (question === undefined || question.length === 0) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-content'))
      return
    }
    if (question.length > 2000) {
      skipped.push(skipOf(key, rowLabel(row), 'over-cap'))
      return
    }
    const recommendationRaw = asString(row.recommendation)?.trim()
    if (recommendationRaw !== undefined && recommendationRaw.length > 2000) {
      skipped.push(skipOf(key, rowLabel(row), 'over-cap'))
      return
    }
    const blocksRaw = asString(row.blocks)?.trim()
    if (blocksRaw !== undefined && blocksRaw.length > 256) {
      skipped.push(skipOf(key, rowLabel(row), 'over-cap'))
      return
    }
    clarifications.push({
      question,
      ...(recommendationRaw !== undefined && recommendationRaw.length > 0 ? { recommendation: recommendationRaw } : {}),
      ...(blocksRaw !== undefined && blocksRaw.length > 0 ? { blocks: blocksRaw } : {}),
    })
  })

  // --- work packages (0012 拆分结果文件通道轮) — decisions/0013 D1: covers
  // are validated against record.criteria HERE (parse time, the claims-row
  // live-record precedent) and dependsOn against the batch-ref ∪ existing-id
  // closure; a bad row is SKIPPED and listed, never silently dropped nor
  // whole-block rejected. Caps equal the storage caps (title 1..64 /
  // boundary 2000). Zero new skip reasons — bad-shape covers ref/dep/
  // closure/covers failures, bad-title/over-cap the length caps.
  const workPackages: DeclareWorkPackageRow[] = []
  const workPackageRows = Array.isArray(doc.workPackages) ? doc.workPackages : []
  const seenRefs = new Set<string>()
  const existingWpIds = new Set(input.record.workPackages.map((workPackage) => workPackage.id))
  const existingCriterionIds = new Set(input.record.criteria.map((criterion) => criterion.id))
  // First pass collects the batch's own refs (the closure set deps may cite).
  const batchRefs = new Set<string>()
  let refsWellFormed = true
  for (const row of workPackageRows) {
    const ref = isRecord(row) ? asString(row.ref)?.trim() : undefined
    if (ref === undefined || !WORK_PACKAGE_REF_RE.test(ref)) {
      refsWellFormed = false
      break
    }
    batchRefs.add(ref)
  }
  workPackageRows.forEach((row, index) => {
    const key = `workPackage-${index}`
    if (!isRecord(row)) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-shape'))
      return
    }
    const ref = asString(row.ref)?.trim()
    if (ref === undefined || !WORK_PACKAGE_REF_RE.test(ref)) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-shape'))
      return
    }
    if (seenRefs.has(ref)) {
      skipped.push(skipOf(key, ref, 'bad-shape')) // duplicate ref — ambiguity in dependsOn resolution
      return
    }
    const title = asString(row.title)?.trim()
    if (title === undefined || title.length === 0 || title.length > 64) {
      skipped.push(skipOf(key, rowLabel(row), 'bad-title'))
      return
    }
    const boundary = asString(row.boundary) ?? ''
    if (boundary.length > 2000) {
      skipped.push(skipOf(key, title, 'over-cap'))
      return
    }
    if (row.parallel !== undefined && typeof row.parallel !== 'boolean') {
      skipped.push(skipOf(key, title, 'bad-shape'))
      return
    }
    const dependsOnRaw = Array.isArray(row.dependsOn) ? row.dependsOn : []
    const dependsOn: string[] = []
    for (const dep of dependsOnRaw) {
      const depRef = asString(dep)?.trim()
      // refsWellFormed gates the closure set's completeness; a dep must cite a
      // batch ref OR an existing ledger id (the re-split context cites both).
      if (depRef === undefined || !WORK_PACKAGE_REF_RE.test(depRef) || !refsWellFormed
        || (!batchRefs.has(depRef) && !existingWpIds.has(depRef))) {
        skipped.push(skipOf(key, title, 'bad-shape'))
        return
      }
      dependsOn.push(depRef)
    }
    const coversRaw = Array.isArray(row.covers) ? row.covers : []
    const covers: string[] = []
    for (const covered of coversRaw) {
      const coveredId = asString(covered)?.trim()
      if (coveredId === undefined || !CRITERION_REF_RE.test(coveredId) || !existingCriterionIds.has(coveredId)) {
        skipped.push(skipOf(key, title, 'bad-shape'))
        return
      }
      covers.push(coveredId)
    }
    seenRefs.add(ref)
    workPackages.push({
      ref,
      title,
      boundary,
      dependsOn,
      ...(row.parallel !== undefined ? { parallel: row.parallel } : {}),
      covers,
    })
  })

  // 0016 P2a: advisory delivery metadata — summary / files / verification.
  // Duck-typed with per-field guards (the skip-don't-invent rule): a missing
  // or wrong-typed field simply stays absent, never blocks the import.
  const declareSummary = asString(doc.summary)?.trim() ?? undefined
  const summary = declareSummary !== undefined && declareSummary.length > 0 ? declareSummary.slice(0, WORKBENCH_INLINE_MAX_CHARS) : undefined
  const filesRaw = Array.isArray(doc.files) ? doc.files : []
  const declareFiles = filesRaw
    .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    .map((f) => f.trim())
    .slice(0, 50)
  const verificationRaw = Array.isArray(doc.verification) ? doc.verification : []
  const declareVerification = verificationRaw
    .filter((v): v is Record<string, unknown> => isRecord(v))
    .map((v) => ({ command: asString(v.command)?.trim() ?? '', outcome: asString(v.outcome)?.trim() ?? '' }))
    .filter((v) => v.command.length > 0)
    .slice(0, 20)

  // 0016 P2b: commit proposals — hash+note pairs, individually guarded.
  const commitsRaw = Array.isArray(doc.commits) ? doc.commits : []
  const declareCommits = commitsRaw
    .filter((c): c is Record<string, unknown> => isRecord(c))
    .map((c) => ({ hash: asString(c.hash)?.trim() ?? '', note: asString(c.note)?.trim() ?? '' }))
    .filter((c) => /^[0-9a-f]{7,40}$/.test(c.hash)) // git sha pattern guard
    .slice(0, 20)

  return {
    ok: true,
    entries,
    skipped,
    stageReady: doc.stageReady === true,
    proposals: { findings, criteria, clarifications, workPackages },
    ...(summary !== undefined ? { declareSummary: summary } : {}),
    ...(declareFiles.length > 0 ? { declareFiles } : {}),
    ...(declareVerification.length > 0 ? { declareVerification } : {}),
    ...(declareCommits.length > 0 ? { declareCommits } : {}),
  }
}
