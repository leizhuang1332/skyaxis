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
 * stageReady. Unknown keys are ignored silently (YAGNI — the generated SOW
 * skeleton teaches exactly these five). The block-level workPackage scopes
 * BOTH built claims and artifacts; absent ⇒ built claims are targetless
 * ('bad-shape') while artifacts import without an owning package.
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
}

export interface DeclareParseSuccess {
  ok: true
  entries: readonly DeclareEntry[]
  skipped: readonly DeclareSkip[]
  stageReady: boolean
  readonly proposals: DeclareProposals
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
    if (input.record.splitApprovedAt === undefined || scopeWp!.status !== 'in-dev') {
      skipped.push(skipOf(key, scope, 'wp-not-in-dev'))
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
  // would poison the whole workbench.yaml on next load (the nextReleaseItemId
  // lesson). Over-cap rows are SKIPPED, never truncated — truncation is a
  // silent data edit.
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

  return { ok: true, entries, skipped, stageReady: doc.stageReady === true, proposals: { findings, criteria } }
}
