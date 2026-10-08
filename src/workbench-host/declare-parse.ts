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
  WorkbenchRecord,
} from '../workbench-shared/protocol.js'
import { WORKBENCH_INLINE_MAX_CHARS } from '../workbench-shared/protocol.js'
import { contentHashOf } from './artifact-store.js'

const DECLARE_MARKER = '# skyaxis-declare'
const RELEASE_TYPES: readonly string[] = ['sql', 'config', 'flag', 'mq', 'other']
const KNOWLEDGE_TYPES: readonly string[] = ['business', 'convention']

export interface DeclareParseSuccess {
  ok: true
  entries: readonly DeclareEntry[]
  skipped: readonly DeclareSkip[]
  stageReady: boolean
}

export interface DeclareParseBlockError {
  ok: false
  blockError: 'no-declare-block' | 'yaml-syntax'
  blockErrorLine?: number
}

export type DeclareParseResult = DeclareParseSuccess | DeclareParseBlockError

/** One closed fenced block: body lines between the opening ``` (± info string) and the closing ```. */
interface FenceBlock {
  body: string[]
}

function collectFences(lines: readonly string[]): FenceBlock[] {
  const blocks: FenceBlock[] = []
  let body: string[] | null = null
  for (const line of lines) {
    if (body === null) {
      // Column-0 opening fence, optional info string (```yaml etc.).
      if (/^```[A-Za-z0-9_-]*\s*$/.test(line)) body = []
      continue
    }
    if (/^```\s*$/.test(line)) {
      blocks.push({ body })
      body = null
      continue
    }
    body.push(line)
  }
  // An unclosed fence at EOF is truncated output — dropped, not parsed.
  return blocks
}

/**
 * The LAST declare-marker fence body in `text`, or null. Bare bodies (the
 * marker line with no surrounding fence — the fetch path hands back exactly
 * that shape) are accepted when the text itself starts with the marker.
 */
export function findDeclareFence(text: string): string | null {
  const blocks = collectFences(text.split(/\r?\n/))
  for (let index = blocks.length - 1; index >= 0; index--) {
    const body = blocks[index]!.body
    const first = body.find((line) => line.trim().length > 0)
    if (first !== undefined && first.trim() === DECLARE_MARKER) return [...body, ''].join('\n')
  }
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return firstLine === DECLARE_MARKER ? `${text}\n` : null
}

/** Yaml errors carry linePos[{line}] — extracted language-neutrally, never the raw message. */
function errorLine(error: unknown): number | undefined {
  const linePos = (error as { linePos?: Array<{ line?: unknown }> } | null)?.linePos
  const line = Array.isArray(linePos) ? linePos[0]?.line : undefined
  return typeof line === 'number' ? line : undefined
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

function skipOf(key: string, label: string, reason: DeclareSkipReason): DeclareSkip {
  return { key, label, reason }
}

/** Best-effort label for a skipped row: its title when readable, else empty (the key still identifies it). */
function rowLabel(row: unknown): string {
  const title = asString(isRecord(row) ? row.title : undefined)?.trim()
  return title !== undefined && title.length > 0 ? title.slice(0, 64) : ''
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

  return { ok: true, entries, skipped, stageReady: doc.stageReady === true }
}
