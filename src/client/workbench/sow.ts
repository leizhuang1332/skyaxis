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
 * Analysis redesign (research 0008; the 挂账轮 after 0006's slices): the
 * analysis purpose gets its OWN nine-block assembly — goal / snapshot /
 * inputs / knowledge / constraints / workflow / output — while split/dev/
 * review keep the original five-block shape untouched (user ruling: this
 * round is analysis-only). The dividing line for reference-vs-embed is
 * physical location: PRDs (prds/) and clone repos (repos/) live INSIDE the
 * delivered session's cwd, so they are cited by path (industry consensus:
 * spec-kit "REQUIRED: Read <path>", Anthropic just-in-time lightweight
 * identifiers, Codex "reference paths only"); the workbench ledger lives
 * outside the workspace, so its data stays an embedded snapshot (P1).
 *
 * Honesty anchor: every document ends with the revision stamp — the ledger
 * may move on after generation and nothing auto-syncs.
 */
import type {
  WorkbenchFinding,
  WorkbenchKnowledgeRecord,
  WorkbenchRecord,
  WorkbenchStageOrClosed,
  WorkbenchWorkPackage,
} from '../../workbench-shared/protocol.js'
import { analysisReportRelPath } from '../../workbench-shared/protocol.js'
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
  /**
   * analysis context: the FULL prds/ listing (path-referenced by the inputs
   * block — every doc the session may read, not just the embedded focus).
   * null/absent = listing unavailable (loading or failed — the honest
   * unknown); [] = confirmed empty. sizeBytes is optional because injected
   * fetchPrdList fakes may omit it.
   */
  analysisPrdDocs?: readonly { name: string; sizeBytes?: number }[] | null
  /**
   * analysis context: linked repos as clone-directory rows. Computed
   * CALLER-side (pool-name join lives with the fetch), dirName only when the
   * pool name resolved — unresolved repos ride the count below instead of a
   * fabricated directory name (honest absence, the contextPaths precedent).
   */
  analysisRepos?: readonly { dirName: string; poolName?: string; branch: string }[]
  /** analysis context: linked repos whose clone dir could not be resolved. */
  analysisUnknownRepos?: number
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

// Analysis artifact labels (fixed zh like STAGE_LABEL above — the document
// does not localize; these mirror the finding.* dictionary values 1:1 so the
// session's prose groups map straight onto the manual-entry form enums).
const FINDING_CATEGORY_LABEL: Record<WorkbenchFinding['category'], string> = {
  feasibility: '可行性',
  conflict: '冲突',
  compatibility: '兼容性',
  risk: '风险',
  capacity: '容量',
  other: '其他',
}

const SEVERITY_LABEL: Record<WorkbenchFinding['severity'], string> = {
  high: '高',
  medium: '中',
  low: '低',
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

function knowledgeBlock(ctx: SowContext, header: string): string {
  const lines = [header]
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

/**
 * The PLAIN declare skeleton (fence CONTENT, non-dev purposes) — shared
 * verbatim by the five-block output convention so the imported block shape
 * cannot drift between purposes (sow.test.ts pins this exact string for the
 * split/dev path; declare-parse consumes whatever the session emits against
 * it).
 */
function declarePlainSkeleton(): string[] {
  return [
    '# knowledge 条目形如（type: business|convention）：',
    '#   - type: convention',
    '#     title: 标题',
    '#     draft: 内容',
    'knowledge: []',
    'stageReady: false',
  ]
}

/**
 * The ANALYSIS declare skeleton (回传轮 + 文件交付轮) — the plain shape plus
 * the three proposal keys the watcher's seedAnalysis parses into S1 待裁决
 * rows (findings/criteria/clarifications). It is deliberately NOT shared
 * with split/dev: their declarePlainSkeleton stays byte-identical (the user
 * ruling that froze the other three purposes' documents), and the analysis
 * document is the only one whose report flows back through this contract.
 */
function declareAnalysisSkeleton(): string[] {
  return [
    '# findings 每条 = 分析发现提议（category: feasibility|conflict|compatibility|risk|capacity|other；severity: high|medium|low）：',
    '#   - category: conflict',
    '#     severity: high',
    '#     title: 标题（64 字内）',
    '#     detail: 说明与证据出处（PRD#章节 或 代码 路径:行号）',
    '# criteria 每条 = 验收标准提议：',
    '#   - text: 一句可判定的话',
    '#     sourceSection: PRD#章节',
    '# clarifications 每条 = 待澄清问题（必须附你的推荐答案，把问题措辞成「是」即接受推荐）：',
    '#   - question: 问题（一句）',
    '#     recommendation: 推荐答案',
    '#     blocks: 阻塞了哪条结论（如 F2 / PRD#3.2）',
    ...declarePlainSkeleton(),
  ]
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
  lines.push(...declarePlainSkeleton(), '```')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Analysis assembly (research 0008; goal/snapshot/inputs/knowledge/
// constraints/workflow/output — spec-kit analyze.md skeleton, zh)
// ---------------------------------------------------------------------------

/** Backslashes fold to forward so Windows host paths read uniformly. */
function toDisplayPath(path: string): string {
  return path.replaceAll('\\', '/')
}

/** One-decimal KB, the modal's kbLabel convention. */
function kbSize(sizeBytes: number): string {
  return `${(sizeBytes / 1024).toFixed(1)} KB`
}

function analysisGoalBlock(ctx: SowContext): string {
  return [
    '## 目标',
    `为需求「${ctx.requirement.title}」的需求理解阶段做一次只读分析，产出一份供需求负责人裁决的分析报告——报告读者没读过你的探索过程，只读结论与证据。本阶段两个产物：`,
    '1. 分析发现——需求与代码现状之间的矛盾、风险与空洞（六类 × 三级，判据见「工作流」第 3 步）。',
    '2. 验收标准建议——可判定的验收条目草案（工作台将逐条人工审定）。',
    '本阶段不做方案设计、不做工作包拆分、不改任何代码——那是后续阶段的事，现在动手会污染分析。',
  ].join('\n')
}

function analysisSnapshotBlock(ctx: SowContext): string {
  const lines = [
    '## 需求快照（工作台账本，生成时快照）',
    `标题：${ctx.requirement.title}`,
    `描述：${ctx.requirement.description}`,
  ]
  if (ctx.record === null) {
    lines.push('（工作台记录未建立）')
    return lines.join('\n')
  }
  lines.push(`当前阶段：${STAGE_LABEL[ctx.record.stage]}`)
  // Re-runs refine rather than re-propose: the session sees what the ledger
  // already holds. Only OPEN findings list (disposed ones no longer block).
  lines.push('已有验收标准：')
  if (ctx.record.criteria.length === 0) lines.push('（尚无）')
  for (const criterion of ctx.record.criteria) lines.push(`- ${criterion.id} ${criterion.text}`)
  const open = ctx.record.findings.filter((finding) => finding.status === 'open')
  lines.push('未处置发现：')
  if (open.length === 0) lines.push('（尚无）')
  for (const finding of open) {
    lines.push(`- [${FINDING_CATEGORY_LABEL[finding.category]}·${SEVERITY_LABEL[finding.severity]}] ${finding.title}`)
  }
  // 回传轮: pending proposals list too — a re-run analysis session must see
  // what is already on the table (adopted rows are the two groups above;
  // unadjudicated rows live only here) so it refines instead of re-proposing.
  // 文件交付轮: ANSWERED clarifications re-enter as settled facts (the
  // ledger is the answer's home — the file is never written back), and
  // unanswered ones join the do-not-re-propose list.
  const pendingFindings = ctx.record.analysis?.findings ?? []
  const pendingCriteria = ctx.record.analysis?.criteria ?? []
  const clarifications = ctx.record.analysis?.clarifications ?? []
  const answeredClarifications = clarifications.filter((row) => row.answer !== undefined)
  const pendingClarifications = clarifications.filter((row) => row.answer === undefined)
  if (answeredClarifications.length > 0) {
    lines.push('已答澄清（需求方已回答，视为已定事实，勿重复提问）：')
    for (const row of answeredClarifications) {
      lines.push(`- 问：${row.question} / 已答：${row.answer}`)
    }
  }
  if (pendingFindings.length > 0 || pendingCriteria.length > 0 || pendingClarifications.length > 0) {
    lines.push('待裁决提议（已收取未裁决，勿重复提议）：')
    for (const row of pendingFindings) {
      lines.push(`- [${FINDING_CATEGORY_LABEL[row.category]}·${SEVERITY_LABEL[row.severity]}] ${row.title}`)
    }
    for (const row of pendingCriteria) {
      lines.push(`- 标准：${row.text}`)
    }
    for (const row of pendingClarifications) {
      lines.push(`- 澄清：${row.question}`)
    }
  }
  if (ctx.record.workPackages.length > 0) {
    lines.push('工作包：')
    for (const wp of ctx.record.workPackages) {
      lines.push(`- ${wp.id} ${wp.title} · ${WP_STATUS_LABEL[wp.status]}（${wp.status}）`)
    }
  }
  return lines.join('\n')
}

function analysisInputBlock(ctx: SowContext): string {
  const lines = [
    '## 输入（用文件读取能力按路径阅读；不要凭记忆，不要猜）',
  ]
  const workspace = ctx.requirement.workspacePath.trim()
  if (workspace === '') {
    // Honest absence — without a bound workspace there are no prds/ or repos/
    // to cite (the host PRD endpoints require one too).
    lines.push('（工作区未绑定——无 PRD 与仓库可引用，分析只能基于需求描述）')
    return lines.join('\n')
  }
  lines.push(`工作区根目录：${toDisplayPath(workspace)}（下列相对路径以此为根）`)
  const docs = ctx.analysisPrdDocs
  const focus = ctx.prdDocumentName
  const headings = (ctx.prdSections ?? []).map((section) => (section.heading.length > 0 ? section.heading : PREAMBLE_HEADING))
  if (docs == null) {
    // Listing unavailable (loading or failed) — an honest unknown, NOT the
    // same as a confirmed-empty directory.
    lines.push('（PRD 文档列表未可得——可列举 prds/ 目录确认）')
  } else if (docs.length === 0) {
    lines.push('（prds/ 目录暂无文档——分析只能基于需求描述与代码）')
  } else {
    lines.push('PRD 文档（prds/ 目录）：')
    for (const doc of docs) {
      const size = doc.sizeBytes !== undefined ? `（${kbSize(doc.sizeBytes)}）` : ''
      if (doc.name === focus) {
        lines.push(headings.length > 0
          ? `- 必读 prds/${doc.name}${size}——重点章节：${headings.join('、')}；其余章节按需`
          : `- 必读 prds/${doc.name}${size}`)
      } else {
        lines.push(`- 按需 prds/${doc.name}${size}`)
      }
    }
  }
  const repos = ctx.analysisRepos ?? []
  if (repos.length === 0 && (ctx.analysisUnknownRepos ?? 0) === 0) {
    lines.push('（本需求未关联仓库）')
  } else {
    if (repos.length > 0) {
      lines.push('代码仓库（repos/ 目录，均已检出关联分支）：')
      for (const repo of repos) {
        const name = repo.poolName !== undefined ? `${repo.poolName}，` : ''
        lines.push(`- 必读 repos/${repo.dirName}（${name}分支 ${repo.branch}）——与需求相关的模块与现有实现`)
      }
    }
    const unknown = ctx.analysisUnknownRepos ?? 0
    if (unknown > 0) {
      lines.push(`（另有 ${unknown} 个已关联仓库的克隆目录名暂不可得——可列举 repos/ 目录对照）`)
    }
  }
  lines.push('路径不存在或不可读：停下来在「待澄清」中报告——不要假设内容，不要自行创建替代文件。')
  return lines.join('\n')
}

const ANALYSIS_KNOWLEDGE_HEADER = '## 参考知识（工作台注入，已审定）'

/**
 * 文件交付轮: the strict-readonly line carries the report-file carve-out
 * when the workspace channel is armed (the report file is the ONE write the
 * task book prescribes); a requirement without a workspace keeps the
 * conversation-delivery wording verbatim (the honest fallback channel).
 */
function analysisConstraintsBlock(ctx: SowContext): string {
  const fileChannel = ctx.requirement.workspacePath.trim() !== ''
  const readonly = fileChannel
    ? '- 严格只读：不修改、创建、删除任何文件；不建分支、不提交、不推送——唯一例外：把分析报告写入「输出」节指定路径的报告文件（目录不存在则创建，覆盖写）；除此之外以任何方式不改变工作区状态。'
    : '- 严格只读：不修改、创建、删除任何文件；不建分支、不提交、不推送——以任何方式不改变工作区状态。分析报告在会话内交付，不写文件。'
  return [
    '## 约束',
    readonly,
    '- 不裁决：发现与验收标准皆为建议，录入、裁决、阶段推进全部由用户在工作台完成；发现处置建议可以给，但不要顺手实施。',
    '- 有据：每条发现给出证据出处（PRD#章节 或 代码 路径:行号）；查不到依据的结论显式标「推测」；与参考知识条目冲突的发现至少「高」级并注明知识条目标题。',
    '- 有限停止：仅四类情况停下来问用户——PRD 与代码矛盾到无从下手 / 需要工作区外的系统或权限 / 不可逆或破坏性操作 / 只有需求方能拍板的取舍；其余自行推进。',
    '- 依据边界：以 PRD 与工作区代码为准；外部信息仅作辅助且注明来源。',
  ].join('\n')
}

const ANALYSIS_WORKFLOW = [
  '## 工作流',
  '1. 通读重点 PRD 与需求描述，列出需求要点清单——区分「硬约束」与「愿望」，每条注 PRD 出处章节。',
  '2. 探索工作区与各仓库：目录结构、与需求相关的模块与现有实现——限定在需求相关范围，不做全库漫游；探察过的文件路径记入报告（「已通读」必须有清单为证）。',
  '3. 逐类排查（六类 = 工作台发现表单的类别枚举，每类一条判据）：',
  '   - 可行性：现有架构/依赖能否支撑；做不到或代价异常的点。',
  '   - 冲突：与现有逻辑、既定行为、已注入知识直接矛盾。',
  '   - 兼容性：接口/数据/上下游受影响面；破坏性变更。',
  '   - 风险：安全、外部依赖、未知技术点、运维隐患。',
  '   - 容量：数据量级、性能、超时、资源上限。',
  '   - 其他：上述之外值得用户裁决的点（少用）。',
  '   歧义哨兵：无量化标准的形容词（快速/实时/稳定/安全/高效/灵活/易用…）与未决占位（TODO/TBD/待定/待补充…）都应落到发现或待澄清。',
  '4. 起草验收标准建议：站在「交付后如何判定通过」的角度，逐条对应需求要点。',
  '5. 汇总待澄清问题，每问附你的推荐答案（把问题措辞成「是」即接受推荐）。',
  '先查后问：能从 PRD、代码、目录里查证的事实自己去查；只有影响结论的取舍留给需求方——本任务允许且期待你在真正的歧义处提问，而不是自行假设。',
].join('\n')

/**
 * 文件交付轮: with a bound workspace the report is FILE-delivered — the
 * session writes the whole document (prose + embedded declare block) to the
 * prescribed absolute path and the workbench seeds from the file (the
 * conversation stream stops being the contract surface). Without a workspace
 * the original conversation delivery stands verbatim (the fallback channel
 * — no reachable directory to prescribe).
 */
function analysisOutputBlock(ctx: SowContext): string {
  const workspace = ctx.requirement.workspacePath.trim()
  const fileChannel = workspace !== ''
  const delivery = fileChannel
    ? `分析结束时把完整报告写入报告文件（markdown 正文 + 结尾机器可读声明块，一次成文），路径：${toDisplayPath(workspace)}/${analysisReportRelPath(ctx.requirement.id)}（绝对路径；目录不存在则创建；覆盖写——不追加、不留多份）。声明块条目用缩进键值，勿用行内逗号；块体必须完整包在 \`\`\`yaml 围栏内——三个反引号起、三个反引号收，缺围栏无法收取。报告按三节组织：`
    : '分析结束时先给出分析报告（markdown，会话内交付，不写文件），随后附上机器可读的声明块（条目用缩进键值，勿用行内逗号；块体必须完整包在 ```yaml 围栏内——三个反引号起、三个反引号收，缺围栏无法收取）。报告按三节组织：'
  return [
    '## 输出',
    delivery,
    '1. 分析发现——每条一行起：F1 [类别·级别] 标题；随后说明（一两句）、证据出处（PRD#章节 或 代码 路径:行号）、（可选）处置建议。按级别降序、同级按类分组；编号 F1、F2… 稳定不重排；总量以 20 条为度，更多的聚合成一行溢出说明。六类逐类给过结论——没有发现的类如实写「未发现」，不要硬凑；六类全零时，显式说明残余风险与探索缺口（哪些范围没查、为什么）。',
    '2. 验收标准建议——每条：A1 一句可判定的话（来源：PRD#章节）；写不出可判定形式的不要写。',
    '3. 待澄清——每问：问题 + 推荐答案 + 阻塞了哪条结论。',
    '（级别判据：高 = 不处理则需求不成立、返工面大、或触碰安全/数据/已注入约定；中 = 不阻塞成立但须在方案期解决；低 = 提示性、可延后。）',
    '```yaml',
    '# skyaxis-declare',
    ...declareAnalysisSkeleton(),
    '```',
    '说明：findings、criteria 与 clarifications 会由工作台自动收为待裁决提议行（采纳与否、如何回答由用户裁决）；knowledge 只列值得沉淀的知识候选（业务知识/开发约定，入工作台审阅队列）；stageReady 是阶段就绪提议，仅供预览——录入、裁决与阶段推进全部由用户完成，不要替用户下结论。',
    fileChannel
      ? '完成自检（全部满足才算收尾）：需求要点已列且注章节 · 探察过的文件清单已列 · 每条发现有类别/级别/出处 · 每条标准建议可判定 · 每个待澄清问题带推荐答案 · 六类逐类有结论 · 声明块已附 · 报告已写入上述路径。'
      : '完成自检（全部满足才算收尾）：需求要点已列且注章节 · 探察过的文件清单已列 · 每条发现有类别/级别/出处 · 每条标准建议可判定 · 每个待澄清问题带推荐答案 · 六类逐类有结论 · 声明块已附。',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

function revisionStamp(ctx: SowContext): string {
  const date = ctx.generatedAt.slice(0, 10)
  return `生成于 revision ${ctx.revision} · ${date} · 此后账本变更不自动同步`
}

/**
 * Assemble the SOW markdown plus the trailing revision stamp. Analysis gets
 * the nine-block research-0008 assembly; split/dev/review keep the original
 * five-block shape (research 0006 §7.1) — the dispatch is the user-ratified
 * scope boundary of this round. Section headers are fixed zh; the declare
 * skeleton is dev-shaped (`workPackage:` + claims) or the plain shape.
 */
export function buildSow(ctx: SowContext): string {
  if (ctx.purpose === 'analysis') {
    const blocks = [
      `# skyaxis 分析任务书 · ${ctx.requirement.title}`,
      analysisGoalBlock(ctx),
      analysisSnapshotBlock(ctx),
      analysisInputBlock(ctx),
      knowledgeBlock(ctx, ANALYSIS_KNOWLEDGE_HEADER),
      analysisConstraintsBlock(ctx),
      ANALYSIS_WORKFLOW,
      analysisOutputBlock(ctx),
    ]
    return [...blocks, revisionStamp(ctx)].join('\n\n')
  }
  const blocks = [
    requirementBlock(ctx),
    prdBlock(ctx),
    ctx.purpose === 'dev' && ctx.workPackage !== undefined ? workPackageBlock(ctx) : '',
    knowledgeBlock(ctx, '[知识注入]'),
    outputBlock(ctx),
  ].filter((block) => block.length > 0)
  return [...blocks, revisionStamp(ctx)].join('\n\n')
}
