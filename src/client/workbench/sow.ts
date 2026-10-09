/**
 * SOW (statement of work / 任务书) assembly — pure functions, no React, no
 * fetch (0006 P2; research 0006 §7.1).
 *
 * The generated document is a self-contained CHINESE working file handed to
 * an AI session: markdown section headers are fixed zh literals (language-
 * neutral w.r.t. the dictionary — the sow.section* keys exist for UI chrome,
 * the artifact itself does not localize), and the output convention block
 * carries the machine-readable declare skeleton whose key is `workPackage:`
 * per decision 0006 (the old `module:` key is gone).
 *
 * Honesty anchor: every document ends with the revision stamp — the ledger
 * may move on after generation and nothing auto-syncs.
 */
import type {
  WorkbenchKnowledgeRecord,
  WorkbenchRecord,
  WorkbenchStageOrClosed,
  WorkbenchWorkPackage,
} from '../../workbench-shared/protocol.js'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'

// ---------------------------------------------------------------------------
// PRD splitting
// ---------------------------------------------------------------------------

export interface PrdSection {
  /** ATX heading text; '' = the pre-first-heading preamble block. */
  heading: string
  /** Section body (trimmed). */
  text: string
}

/**
 * Split a PRD markdown into ATX-headed sections. Text before the first
 * heading collapses into ONE preamble section (heading ''), omitted when
 * blank; a document with no headings at all is one preamble section; an
 * empty document splits into nothing.
 */
export function splitPrdSections(markdown: string): PrdSection[] {
  const sections: PrdSection[] = []
  let heading = ''
  let body: string[] | null = null
  const flush = (): void => {
    if (body === null) return
    const text = body.join('\n').trim()
    if (text.length > 0) sections.push({ heading, text })
    body = null
  }
  for (const line of markdown.split(/\r?\n/)) {
    if (/^#{1,6}\s+/.test(line)) {
      flush()
      heading = line.replace(/^#{1,6}\s+/, '').trim()
      body = []
      continue
    }
    if (body !== null) body.push(line)
    else {
      // Still before the first heading — open the implicit preamble block.
      heading = ''
      body = [line]
    }
  }
  flush()
  return sections
}

// ---------------------------------------------------------------------------
// Knowledge matching (research 0006 §7.4 trigger rules, injection face)
// ---------------------------------------------------------------------------

export type KnowledgeMatchKind = 'always' | 'keyword' | 'manual' | 'path'

export interface KnowledgePick {
  record: WorkbenchKnowledgeRecord
  match: KnowledgeMatchKind
}

/**
 * Glob → RegExp for ABSOLUTE path-trigger matching (P5a): `**` spans any
 * characters including separators, a single `*` stays within one segment,
 * both slash kinds normalize to `/`. Anchored to the full path. Escapes
 * every other metachar so the value is data, never a pattern injection.
 */
export function globToRegExp(glob: string): RegExp {
  const normalized = glob.replaceAll('\\', '/')
  let pattern = '^'
  let index = 0
  while (index < normalized.length) {
    const char = normalized[index]
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        pattern += '[\\s\\S]*'
        index += 2
        // A `**/` or `/**/` sequence: the trailing slash is optional so
        // `src/**/x` also matches `src/x` (the gitignore convention).
        if (normalized[index] === '/') {
          pattern += '(?:/)?'
          index += 1
        }
        continue
      }
      pattern += '[^/]*'
      index += 1
      continue
    }
    pattern += char === '/' ? '/' : char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    index += 1
  }
  return new RegExp(`${pattern}$`)
}

/** An absolute glob names a concrete location (drive letter or leading slash). */
function isAbsoluteGlob(glob: string): boolean {
  return /^([A-Za-z]:|\/)/.test(glob.replaceAll('\\', '/'))
}

/**
 * Resolve the injection pool for one target text. Only active rows enter;
 * `always` rows always list, `keyword` rows list only on a case-insensitive
 * substring hit of their trimmed value, `manual` rows list unflagged (the
 * modal presents them unchecked), and `path` rows (P5a) match the
 * requirement's CONTEXT PATHS (workspace root + linkedRepo clone dirs):
 *
 *  - RELATIVE glob (`src/**`): lists whenever the requirement HAS a context
 *    path —「this workspace's src/** work」, the v1 deterministic semantics
 *    (refining to "src/ actually touched" needs file enumeration; v2). No
 *    context paths ⇒ never listed (the honest absence).
 *  - ABSOLUTE glob (`C:/ws/q/repos/**`): must prefix-match a context path
 *    at segment boundaries (globToRegExp).
 */
export function matchKnowledge(records: readonly WorkbenchKnowledgeRecord[], targetText: string, contextPaths?: readonly string[]): KnowledgePick[] {
  const normalizedPaths = contextPaths?.map((path) => path.replaceAll('\\', '/')) ?? []
  const hasContext = normalizedPaths.length > 0
  const picks: KnowledgePick[] = []
  for (const record of records) {
    if (record.status !== 'active') continue
    if (record.trigger.mode === 'always') {
      picks.push({ record, match: 'always' })
      continue
    }
    if (record.trigger.mode === 'keyword') {
      const value = (record.trigger.value ?? '').trim().toLowerCase()
      if (value.length > 0 && targetText.toLowerCase().includes(value)) {
        picks.push({ record, match: 'keyword' })
      }
      continue
    }
    if (record.trigger.mode === 'path') {
      const glob = (record.trigger.value ?? '').trim()
      if (glob.length === 0 || !hasContext) continue
      if (isAbsoluteGlob(glob)) {
        const pattern = globToRegExp(glob)
        if (normalizedPaths.some((path) => pattern.test(path))) {
          picks.push({ record, match: 'path' })
        }
        continue
      }
      picks.push({ record, match: 'path' })
      continue
    }
    if (record.trigger.mode === 'manual') {
      picks.push({ record, match: 'manual' })
    }
  }
  return picks
}

/**
 * Selected-set size in UTF-8 bytes (title + content per row) — the
 * KNOWLEDGE_INJECTION_MAX_BYTES budget unit.
 */
export function knowledgeBytes(picks: readonly WorkbenchKnowledgeRecord[]): number {
  const encoder = new TextEncoder()
  let total = 0
  for (const record of picks) {
    total += encoder.encode(record.title + record.content).length
  }
  return total
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

export interface SowContext {
  purpose: 'analysis' | 'split' | 'dev' | 'review'
  requirement: RequirementRecord
  /** null = the workbench record is not established yet (first-use entry). */
  record: WorkbenchRecord | null
  revision: number
  /** ISO timestamp of generation; its date part lands in the stamp. */
  generatedAt: string
  /** dev context carries the target work package. */
  workPackage?: WorkbenchWorkPackage
  /** dev context: the highest approvedAt plan version's body (absent = none). */
  approvedPlanText?: string
  /** Checked PRD sections. */
  prdSections?: readonly PrdSection[]
  prdDocumentName?: string
  /** Selected knowledge rows (in pool order). */
  knowledgePicks?: readonly WorkbenchKnowledgeRecord[]
  /** dev context: append per-dependency summaries. */
  includeDeps?: boolean
}

const STAGE_LABEL: Record<WorkbenchStageOrClosed, string> = {
  understand: '需求理解',
  plan: '探索规划',
  implement: '执行实施',
  review: '评审',
  deliver: '交付',
  retro: '沉淀',
  closed: '已关闭',
}

const WP_STATUS_LABEL: Record<WorkbenchWorkPackage['status'], string> = {
  planned: '已登记',
  'plan-draft': '计划草拟中',
  'plan-approved': '计划已批准',
  'in-dev': '开发中',
  built: '待验收',
  accepted: '已验收',
  dropped: '已放弃',
}

const PREAMBLE_HEADING = '开篇'

function requirementBlock(ctx: SowContext): string {
  const lines = ['[需求]', `标题：${ctx.requirement.title}`, `描述：${ctx.requirement.description}`]
  if (ctx.record === null) {
    lines.push('（工作台记录未建立）')
    return lines.join('\n')
  }
  lines.push(`当前阶段：${STAGE_LABEL[ctx.record.stage]}`)
  for (const wp of ctx.record.workPackages) {
    lines.push(`${wp.id} ${wp.title} · ${WP_STATUS_LABEL[wp.status]}（${wp.status}）`)
  }
  // split needs the criteria as the breakdown contract; review needs them as
  // the acceptance checklist it audits coverage against (P5b).
  if (ctx.purpose === 'split' || ctx.purpose === 'review') {
    for (const criterion of ctx.record.criteria) {
      lines.push(`${criterion.id} ${criterion.text}`)
    }
  }
  return lines.join('\n')
}

function prdBlock(ctx: SowContext): string {
  const sections = ctx.prdSections ?? []
  const lines = ['[PRD 节选]']
  if (sections.length === 0) {
    lines.push('（未选择）')
    return lines.join('\n')
  }
  if (ctx.prdDocumentName !== undefined && ctx.prdDocumentName.length > 0) {
    lines.push(`文档：${ctx.prdDocumentName}`)
  }
  for (const section of sections) {
    lines.push('', `## ${section.heading.length > 0 ? section.heading : PREAMBLE_HEADING}`, section.text)
  }
  return lines.join('\n')
}

function workPackageBlock(ctx: SowContext): string {
  const wp = ctx.workPackage
  if (wp === undefined) return ''
  const lines = ['[工作包]', `${wp.id}　${wp.title}`, `边界：${wp.boundary}`]
  lines.push(`依赖：${wp.dependsOn.length > 0 ? wp.dependsOn.join('、') : '无'}`)
  const covered = (ctx.record?.criteria ?? []).filter((criterion) => wp.covers.includes(criterion.id))
  if (covered.length > 0) {
    lines.push('覆盖标准：')
    for (const criterion of covered) lines.push(`- ${criterion.id} ${criterion.text}`)
  } else {
    lines.push('覆盖标准：无')
  }
  if (ctx.approvedPlanText !== undefined && ctx.approvedPlanText.length > 0) {
    lines.push('### 已批准计划', ctx.approvedPlanText)
  } else {
    lines.push('（尚无已批准计划）')
  }
  if (ctx.includeDeps === true && wp.dependsOn.length > 0) {
    const byId = new Map((ctx.record?.workPackages ?? []).map((dep) => [dep.id, dep]))
    const summaries = wp.dependsOn
      .map((depId) => byId.get(depId))
      .filter((dep) => dep !== undefined)
      .map((dep) => `- ${dep.id} ${dep.title} · ${dep.boundary}`)
    if (summaries.length > 0) {
      lines.push('依赖工作包摘要：', ...summaries)
    }
  }
  return lines.join('\n')
}

function knowledgeBlock(ctx: SowContext): string {
  const lines = ['[知识注入]']
  const records = ctx.knowledgePicks ?? []
  if (records.length === 0) {
    lines.push('（无）')
    return lines.join('\n')
  }
  for (const record of records) {
    lines.push(`### ${record.title}`, `（触发：${record.trigger.mode}）`, record.content)
  }
  return lines.join('\n')
}

function outputBlock(ctx: SowContext): string {
  // Review purpose gets its OWN convention block (# skyaxis-review + findings),
  // distinct from the declare block — the declare path below stays byte-identical
  // (sow.test.ts pins its exact string). Findings teach the block-mapping shape
  // via YAML comments (P3b lesson: the research §7.1 inline-comma form throws
  // BLOCK_AS_IMPLICIT_KEY, so a model copying it would emit an unparseable block).
  if (ctx.purpose === 'review') {
    return [
      '[输出约定]',
      '评审结束时先给出完整报告正文（markdown），并在结尾附上如下机器可读的发现块（条目用缩进键值，勿用行内逗号）：',
      '```yaml',
      '# skyaxis-review',
      '# findings 每条 = 一个待用户裁决的发现；severity: high|medium|low',
      '# 条目形如：',
      '#   - title: 发现标题（64 字内）',
      '#     severity: high',
      'findings: []',
      '```',
      '说明：findings 只列发现，裁决（成立/驳回）与处置由用户在工作台完成——不要替用户下结论。',
    ].join('\n')
  }
  const lines = ['[输出约定]', '结束时请输出如下机器可读的声明块（条目用缩进键值，勿用行内逗号）：', '```yaml', '# skyaxis-declare']
  if (ctx.purpose === 'dev' && ctx.workPackage !== undefined) {
    // dev 骨架：workPackage 键（决策 0006 连带，旧 module: 键已废）+ built
    // 声明 + 产物登记；artifacts 仅 dev 语境出现。条目形状用合法 YAML 注释
    // 教学（P3b：research §7.1 的行内逗号示例是非法 YAML——BLOCK_AS_
    // IMPLICIT_KEY 整块抛错，模型照抄会让声明块不可解析）。
    lines.push(
      `workPackage: ${ctx.workPackage.id}`,
      'claims:',
      '  - built: true',
      '# artifacts 条目形如（type: sql|config|flag|mq|other）：',
      '#   - type: sql',
      '#     title: 标题（64 字内）',
      '#     content: |',
      '#       SQL 或配置值（多行用块状写法）',
      '#     envs: [prod]',
      'artifacts: []',
    )
  }
  lines.push(
    '# knowledge 条目形如（type: business|convention）：',
    '#   - type: convention',
    '#     title: 标题',
    '#     draft: 内容',
    'knowledge: []',
    'stageReady: false',
    '```',
  )
  return lines.join('\n')
}

/**
 * Assemble the five-block markdown document (research 0006 §7.1) plus the
 * trailing revision stamp. Section headers are fixed zh; the declare
 * skeleton is dev-shaped (`workPackage:` + claims) or the plain shape.
 */
export function buildSow(ctx: SowContext): string {
  const blocks = [
    requirementBlock(ctx),
    prdBlock(ctx),
    ctx.purpose === 'dev' && ctx.workPackage !== undefined ? workPackageBlock(ctx) : '',
    knowledgeBlock(ctx),
    outputBlock(ctx),
  ].filter((block) => block.length > 0)
  const date = ctx.generatedAt.slice(0, 10)
  const stamp = `生成于 revision ${ctx.revision} · ${date} · 此后账本变更不自动同步`
  return [...blocks, stamp].join('\n\n')
}
