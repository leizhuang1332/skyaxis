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
 * inputs / knowledge / constraints / workflow / output — while dev keeps
 * the original five-block shape (review joined the nine-block family in
 * 0023 with its own two-goal methodology). The dividing line for reference-vs-
 * embed is physical location: PRDs (prds/) and clone repos (repos/) live
 * INSIDE the delivered session's cwd, so they are cited by path (industry
 * consensus: spec-kit "REQUIRED: Read <path>", Anthropic just-in-time
 * lightweight identifiers, Codex "reference paths only"); the workbench
 * ledger lives outside the workspace, so its data stays an embedded
 * snapshot (P1).
 *
 * 0015: dev/review join the path-citation face — the [PRD 节选] embedded
 * block and its section checkboxes RETIRE for every purpose (0009 retired
 * analysis/split/consolidate, 0012 plan; this round closes the pair). The
 * five-block docs gain an [输入] block citing the requirement baseline doc
 * (ledger-decided, the split/plan 必读 line) + clone-repo rows; the
 * requirement/WP/criteria snapshot stays embedded (ledger data, P1).
 *
 * Honesty anchor: dev/review documents end with the revision stamp; the
 * three AI-session purposes dropped it in 0009 (conservative trim, user
 * ruling) — their snapshots carry the 生成时快照 wording instead. The ledger
 * may move on after generation and nothing auto-syncs either way.
 */
import type {
  WorkbenchFinding,
  WorkbenchKnowledgeRecord,
  WorkbenchRecord,
  WorkbenchStageOrClosed,
  WorkbenchWorkPackage,
} from '../../workbench-shared/protocol.js'
import { analysisReportRelPath, requirementDocRelPath, planningDocRelPath, splitResultRelPath, wpPlanRelPath } from '../../workbench-shared/protocol.js'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'

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
  purpose: 'analysis' | 'plan' | 'split' | 'consolidate' | 'dev' | 'review' | 'wp-plan'
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
  /** Selected knowledge rows (in pool order). */
  knowledgePicks?: readonly WorkbenchKnowledgeRecord[]
  /** dev context: append per-dependency summaries. */
  includeDeps?: boolean
  /**
   * analysis/consolidate context: the FULL prds/ listing (path-referenced by
   * the inputs block — every doc the session may read). null/absent =
   * listing unavailable (loading or failed — the honest unknown); [] =
   * confirmed empty. sizeBytes is optional because injected fetchPrdList
   * fakes may omit it. 0015: dev/review/split/plan never fetch a listing —
   * the ledger-decided baseline-doc line replaces it.
   */
  analysisPrdDocs?: readonly { name: string; sizeBytes?: number }[] | null
  /**
   * linked repos as clone-directory rows (every purpose's input block).
   * Computed CALLER-side (pool-name join lives with the fetch), dirName only
   * when the pool name resolved — unresolved repos ride the count below
   * instead of a fabricated directory name (honest absence, the
   * contextPaths precedent).
   */
  analysisRepos?: readonly { dirName: string; poolName?: string; branch: string }[]
  /** linked repos whose clone dir could not be resolved. */
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
  // (0023: review's criteria arm retired — review rides the nine-block
  // assembly with its own snapshot block; this is the dev-only five-block
  // face. 0009: the dead split arm is long gone — split rides the nine-block
  // assembly since 0007 and reads the baseline doc since 0009.)
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
  // 0019 D4-A: the rework history rides the dev task book — a 补投 (fresh
  // session redoing the approved plan) must know why the previous round was
  // rejected, or it may repeat the same miss. Zero acceptances ⇒ zero lines
  // (first deliveries stay untouched).
  if (wp.acceptances.length > 0) {
    lines.push('返工历史：')
    wp.acceptances.forEach((acceptance, index) => {
      lines.push(acceptance.result === 'fail' ? `- 第 ${index + 1} 轮 不通过：${acceptance.note ?? ''}` : `- 第 ${index + 1} 轮 通过`)
    })
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

/**
 * The SPLIT declare skeleton (0012 拆分结果文件通道轮) — the plain shape plus
 * the workPackages proposal key (declareAnalysisSkeleton's teaching form: YAML
 * comment rows, never inline commas). The AI's `ref` is a SUGGESTED ordinal
 * for intra-batch dependency references; the workbench mints the real ids at
 * registration (decisions/0013 D1 — the four-rights closure: proposals never
 * register themselves).
 */
function declareSplitSkeleton(): string[] {
  return [
    '# workPackages 每条 = 工作包建议（ref 为建议序号 WP1/WP2…，仅供批内依赖互引；正式编号由工作台登记时分配）：',
    '#   - ref: WP1',
    '#     title: 标题（64 字内）',
    '#     boundary: 边界（做什么/不做什么）',
    '#     dependsOn: [WP2]   # 批内建议序号，或既有工作包编号',
    '#     parallel: true     # 可与其他包并行',
    '#     covers: [C1, C2]   # 覆盖的验收标准编号（基线文档验收标准节）',
    'workPackages: []',
    ...declarePlainSkeleton(),
  ]
}

function outputBlock(ctx: SowContext): string {
  // (0023: the review arm retired — review's `# skyaxis-review` convention
  // now rides its own nine-block output section; this is the dev-only
  // five-block face, declare path byte-identical as pinned by sow.test.ts.)
  const lines = ['[输出约定]', '结束时请输出如下机器可读的声明块（条目用缩进键值，勿用行内逗号）：', '```yaml', '# skyaxis-declare']
  if (ctx.purpose === 'dev' && ctx.workPackage !== undefined) {
    // dev 骨架：workPackage 键（决策 0006 连带，旧 module: 键已废）+ built
    // 声明 + 产物登记；artifacts 仅 dev 语境出现。条目形状用合法 YAML 注释
    // 教学（P3b：research §7.1 的行内逗号示例是非法 YAML——BLOCK_AS_
    // IMPLICIT_KEY 整块抛错，模型照抄会让声明块不可解析）。
    lines.push(
      `workPackage: ${ctx.workPackage.id}`,
      // 0016 P2a: delivery metadata teaching — summary/files/verification
      '# summary: 一句话总结本次交付做了什么',
      '# files:',
      '#   - src/foo.ts',
      '# verification 每条 = 跑过的验证命令与结果（建议必附——工作台将向用户展示证据）:',
      '#   - command: npm test',
      '#     outcome: pass',
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

/** The reading discipline every input block carries in its header. */
const INPUT_INSTRUCTION = '（用文件读取能力按路径阅读；不要凭记忆，不要猜）'

/** Purpose nouns for the workspace-unbound and prds/-empty honest lines. */
const INPUT_NOUN: Record<SowContext['purpose'], string> = {
  analysis: '分析',
  plan: '规划',
  split: '拆分规划',
  consolidate: '整理',
  dev: '开发',
  review: '评审',
  'wp-plan': '规划',
}

/** Baseline 必读 line noun — names the consumer of the doc (0015: dev/review
 * join the split/plan arm; dev reads against ONE work package). Undefined =
 * the purpose keeps the prds/ listing instead (analysis/consolidate). */
const BASELINE_CONSUMER: Partial<Record<SowContext['purpose'], string>> = {
  split: '本拆分',
  plan: '本次规划',
  dev: '本工作包',
  review: '本次评审',
  'wp-plan': '本规划',
}

/** Honest-absence line noun (定稿无锚 / 未定稿 two states). */
const BASELINE_FALLBACK: Partial<Record<SowContext['purpose'], string>> = {
  split: '本次拆分',
  plan: '本次规划',
  dev: '本次开发',
  review: '本次评审',
  'wp-plan': '本次规划',
}

function analysisInputBlock(ctx: SowContext, header: string): string {
  // 0007: shared by analysis AND split (the purpose noun keeps the analysis
  // bytes IDENTICAL — only the split path reads differently).
  // 0008: consolidate joins — consolidation reads EVERY PRD wholesale (no
  // key-section pointers).
  // 0009: the PRD focus-section pointers RETIRE for analysis too (user
  // ruling — every doc lists as 必读, the consolidate loop shape), and split
  // drops the PRD listing ENTIRELY: the finalized requirement baseline doc is
  // THE requirement source (0009 D2), so criteria/findings/clarifications
  // never ride the split SOW — the doc carries them.
  // 0015: dev/review join the baseline arm — their five-block docs carry an
  // [输入] block of the same rows (header parameterized), and the [PRD 节选]
  // embedded face retires for good.
  const noun = INPUT_NOUN[ctx.purpose]
  const baseline = BASELINE_CONSUMER[ctx.purpose]
  const fallback = BASELINE_FALLBACK[ctx.purpose]
  const lines = [header]
  const workspace = ctx.requirement.workspacePath.trim()
  if (workspace === '') {
    // Honest absence — without a bound workspace there are no prds/ or repos/
    // to cite (the host PRD endpoints require one too).
    lines.push(`（工作区未绑定——无可引用的文档与仓库，${noun}只能基于需求描述）`)
    return lines.join('\n')
  }
  lines.push(`工作区根目录：${toDisplayPath(workspace)}（下列相对路径以此为根）`)
  if (baseline !== undefined) {
    // 0008: the baseline-doc line is decided by the LEDGER (understandBaseline
    // .docHash present = a finalized doc was anchored), never by probing the
    // disk. 0009 D2: the lean shape holds in EVERY state (user ruling — no
    // pre-finalize fallback snapshot): anchored ⇒ 必读行; finalized-without-
    // anchor (pre-0008 approval / docless at finalize) and 未定稿 ⇒ honest
    // absence lines, the requirement description is the sole requirement
    // basis. 0012: 'plan' joins the arm verbatim (its document WRITES the
    // planning; split additionally READS the adopted one — three states
    // below, the 0010 D2 honest-line pattern). 0015: dev/review join — the
    // requirement baseline doc becomes THEIR requirement truth too (the WP
    // boundary + covered criteria stay embedded: ledger data, P1).
    if (ctx.record?.understandBaseline?.docHash !== undefined) {
      lines.push(`- 必读 ${requirementDocRelPath(ctx.requirement.id)}——需求基线文档，${baseline}的唯一需求真源（验收标准以账本为准，其余需求表达以文档为权威；文档与你所见快照冲突时在报告中列出，不要自行取舍）`)
    } else if (ctx.record?.understandApprovedAt !== undefined) {
      lines.push(`（需求理解已定稿但未锚定基线文档——定稿时工作区无此文档；${fallback}以需求描述为唯一需求依据。）`)
    } else {
      lines.push(`（需求理解未定稿——尚无锚定的需求基线文档；${fallback}以需求描述为唯一需求依据。）`)
    }
    if (ctx.purpose === 'split' || ctx.purpose === 'wp-plan') {
      // 0012: the adopted planning doc is the split's SOLUTION source — the
      // ledger decides (planBaseline.docHash present = an adopted doc was
      // anchored), never a disk probe; the honest-absence lines keep the
      // skip path legal (the 0010 D2 doctrinal push, not a gate).
      // 0018: wp-plan joins the READ side (分解服从方案) — the WP's fine
      // task decomposition defers to the adopted solution, exactly as the
      // split's coarse boundaries do. Parameterized nouns keep the split
      // path byte-identical (sow.test pins it).
      const noun = ctx.purpose === 'wp-plan' ? '本规划' : '本拆分'
      const obedience = ctx.purpose === 'wp-plan' ? '分解服从方案：任务与顺序以它为准' : '拆分服从方案：边界与顺序以它为准'
      if (ctx.record?.planBaseline?.docHash !== undefined) {
        lines.push(`- 必读 ${planningDocRelPath(ctx.requirement.id)}——技术规划文档，${noun}的方案真源（${obedience}；文档与基线文档冲突时在报告中列出，不要自行取舍）`)
      } else if (ctx.record?.planAdoptedAt !== undefined) {
        lines.push(`（技术规划已采纳但未锚定——采纳时工作区无此文档；${fallback}以基线文档与仓库现状为方案依据。）`)
      } else {
        lines.push(`（尚无已采纳的技术规划文档——${fallback}以基线文档与仓库现状为方案依据；若规划文档已生成，先在工作台采纳它，再重新生成本任务书。）`)
      }
    }
  } else {
    const docs = ctx.analysisPrdDocs
    if (docs == null) {
      // Listing unavailable (loading or failed) — an honest unknown, NOT the
      // same as a confirmed-empty directory.
      lines.push('（PRD 文档列表未可得——可列举 prds/ 目录确认）')
    } else if (docs.length === 0) {
      lines.push(`（prds/ 目录暂无文档——${noun}只能基于需求描述与代码）`)
    } else {
      // 0009: analysis joins the consolidate loop shape — every doc 必读, no
      // focus doc, no key-section pointers (the checkboxes are gone from the
      // modal for all three AI-session purposes).
      lines.push(ctx.purpose === 'consolidate'
        ? 'PRD 文档（prds/ 目录，全部通读——整理以原文为底，不能只读节选）：'
        : 'PRD 文档（prds/ 目录）：')
      for (const doc of docs) {
        const size = doc.sizeBytes !== undefined ? `（${kbSize(doc.sizeBytes)}）` : ''
        lines.push(`- 必读 prds/${doc.name}${size}`)
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
  lines.push(ctx.purpose === 'analysis'
    ? '路径不存在或不可读：停下来在「待澄清」中报告——不要假设内容，不要自行创建替代文件。'
    : '路径不存在或不可读：停下来向用户报告——不要假设内容，不要自行创建替代文件。')
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
// Split assembly (0007 定稿软门轮：research 0008 九节骨架推广到 split;
// 0009 任务书精简轮 D2: the requirement baseline doc is the split session's
// ONLY requirement source — the snapshot slims to identity + finalize state
// + existing packages, and the PRD listing is gone from the input block).
// ---------------------------------------------------------------------------

function splitGoalBlock(ctx: SowContext): string {
  return [
    '## 目标',
    `为需求「${ctx.requirement.title}」的探索规划阶段做一次只读拆分规划，产出一份工作包清单建议——建议由工作台自动收取为「待登记提议」，需求负责人逐条裁决登记后再决定是否批准拆分。本阶段一个产物：`,
    '1. 工作包清单建议——每个工作包给出：建议序号（ref）、标题、边界（做什么/不做什么）、依赖关系与可并行性、覆盖的验收标准（Cx 引用）、排序理由与依据。',
    '本阶段不重新做方案设计——已采纳的技术规划文档在场时以它为方案真源（见「输入」）；不做开发计划、不改任何代码——计划与实施是后续阶段的事。拆分质量的判据：边界清晰、依赖最小、每条验收标准至少被一个工作包覆盖。',
  ].join('\n')
}

function splitSnapshotBlock(ctx: SowContext): string {
  // 0009 D2: the snapshot slims to identity + finalize state + existing
  // packages — criteria/findings/clarifications ride the requirement baseline
  // doc the input block cites (the doc is THE requirement source; the ledger
  // copy would be a second expression of the same truth). The lean shape
  // holds in every state (user ruling — no pre-finalize fallback).
  const lines = [
    '## 需求快照（工作台账本，生成时快照）',
    `标题：${ctx.requirement.title}`,
    `描述：${ctx.requirement.description}`,
  ]
  if (ctx.record === null) {
    lines.push('（工作台记录未建立——尚无基线文档可用，拆分只能基于需求描述）')
    return lines.join('\n')
  }
  lines.push(`当前阶段：${STAGE_LABEL[ctx.record.stage]}`)
  // 0007: the finalize state is the S1→S2 hand-off marker the split session
  // should know about (finalized = the understanding contract stands as-is;
  // not finalized = rulings may still be moving).
  lines.push(ctx.record.understandApprovedAt !== undefined
    ? `需求理解定稿：已定稿（${ctx.record.understandApprovedAt.slice(0, 10)}）——理解阶段的裁决视为已定输入`
    : '需求理解定稿：未定稿——理解阶段的裁决可能仍在进行')
  if (ctx.record.workPackages.length > 0) {
    lines.push('现有工作包（重拆分语境的参考——现状边界与状态）：')
    for (const wp of ctx.record.workPackages) {
      lines.push(`- ${wp.id} ${wp.title} · ${WP_STATUS_LABEL[wp.status]}（${wp.status}）`)
    }
  }
  return lines.join('\n')
}

function splitConstraintsBlock(ctx: SowContext): string {
  // 0012: with a bound workspace the split result FILE is the delivery — the
  // one write the task book prescribes (the analysis/consolidate carve-out
  // form); without one the conversation delivery stands (the honest fallback).
  const fileChannel = ctx.requirement.workspacePath.trim() !== ''
  return [
    '## 约束',
    fileChannel
      ? '- 严格只读：不修改、创建、删除任何文件；不建分支、不提交、不推送——唯一例外：把拆分结果文件写入「输出」节指定路径（目录不存在则创建，覆盖写）。'
      : '- 严格只读：不修改、创建、删除任何文件；不建分支、不提交、不推送——拆分建议在会话内交付，不写文件。',
    '- 不裁决：工作包清单是建议，登记、修订、批准拆分全部由用户在工作台完成；拆分中发现的新风险以发现形式列出（带证据），不要顺手处置。',
    '- 有据：每条边界/依赖/覆盖判断给出依据（基线文档 FR/C 编号 或 代码 路径:行号）；查不到依据的显式标「推测」。',
    '- 有限停止：仅当需求信息不足以划分任何边界时停下来问用户；其余自行给出带取舍说明的方案。',
  ].join('\n')
}

const SPLIT_WORKFLOW = [
  '## 工作流',
  '1. 通读需求基线文档与需求快照——先明确验收面（基线文档「验收标准」节逐条 C 编号）与已定约束（「已裁决风险」节是输入，不是待办）。',
  '2. 探索与需求相关的模块（限需求相关范围，不做全库漫游）——识别天然边界：表/接口/进程/可独立验证的功能单元。',
  '3. 逐条映射：每条验收标准至少落一个候选工作包；覆盖不了的标准显式列出并说明原因（留给用户裁决）。',
  '4. 起草工作包清单：每包给标题、边界（做什么/不做什么）、依赖（哪些包必须先完成）、可并行性、覆盖的标准（Cx）、排序理由。',
  '5. 自检覆盖矩阵：标准 × 工作包逐格确认；空洞与重复覆盖都写明。',
  '先查后问：能从 PRD、代码、目录里查证的事实自己去查；只有影响拆分形态的取舍留给需求方——提问带推荐方案，而不是自行假设。',
].join('\n')

function splitOutputBlock(ctx: SowContext): string {
  // 0012 拆分结果文件通道: with a bound workspace the result FILE is the
  // delivery (markdown prose + embedded declare block, written once) — the
  // workbench seeds the proposals from the file (the conversation stops being
  // the contract surface, decisions/0007's lesson applied to split). Without
  // a workspace the conversation delivery stands verbatim.
  const workspace = ctx.requirement.workspacePath.trim()
  const fileChannel = workspace !== ''
  const delivery = fileChannel
    ? `拆分结束时把完整建议报告（markdown 正文 + 结尾机器可读声明块，一次成文）写入结果文件，路径：${toDisplayPath(workspace)}/${splitResultRelPath(ctx.requirement.id)}（绝对路径；目录不存在则创建；覆盖写——不追加、不留多份）。报告按以下结构：`
    : '拆分结束时先给出完整建议报告（markdown，会话内交付，不写文件），随后附上机器可读的声明块（条目用缩进键值，勿用行内逗号；块体必须完整包在 ```yaml 围栏内——三个反引号起、三个反引号收，缺围栏无法收取）。报告按以下结构：'
  return [
    '## 输出',
    delivery,
    '1. 工作包清单——每包一节：建议序号（ref，WP1、WP2…——声明块与依赖互引都用它）+ 标题 + 边界（做什么/不做什么）+ 依赖 + 可并行性 + 覆盖标准（Cx）+ 排序理由 + 依据（基线文档 FR/C 编号 / 代码 路径:行号）。',
    '2. 覆盖矩阵——每条验收标准 × 覆盖它的工作包；覆盖不了的标准单独列出并说明。',
    '3. 新发现——拆分过程中发现的新风险/新问题（每条 [类别·级别] 标题 + 证据出处），不要自行处置。',
    '（工作包建议由工作台自动收取为「待登记提议」——逐条裁决登记后才成为正式工作包；登记与批准拆分由用户完成，你的建议不会被直接导入。）',
    '```yaml',
    '# skyaxis-declare',
    ...declareSplitSkeleton(),
    '```',
    '说明：workPackages 是工作包建议（ref 为建议序号，正式编号由工作台登记时分配——勿把 ref 当作账本既有编号引用账本外的内容）；knowledge 只列值得沉淀的知识候选（业务知识/开发约定，入工作台审阅队列）；stageReady 是阶段就绪提议，仅供预览——工作包登记、批准拆分与阶段推进全部由用户完成，不要替用户下结论。',
    fileChannel
      ? '完成自检（全部满足才算收尾）：每包有边界与依赖 · 覆盖矩阵无未说明空洞 · 每条标准有归属或显式说明无归属 · 新发现逐条带证据 · 声明块已附 · 结果文件已写入上述路径。'
      : '完成自检（全部满足才算收尾）：每包有边界与依赖 · 覆盖矩阵无未说明空洞 · 每条标准有归属或显式说明无归属 · 新发现逐条带证据 · 声明块已附。',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Plan assembly (0012 两步化轮, decisions/0013 D2) — the 2a exploration step.
// The split five-piece's twin with ONE divergence: its document WRITES the
// planning file (consolidateOutputBlock's channel form) and carries NO
// declare block (the 整理任务书 precedent — pure document delivery, the
// adoption stamp anchors it, nothing seeds from it).
// ---------------------------------------------------------------------------

function planGoalBlock(ctx: SowContext): string {
  return [
    '## 目标',
    `为需求「${ctx.requirement.title}」的探索规划阶段做一次只读的技术规划，产出一份技术规划文档——文档读者是需求负责人与后续的拆分会话：负责人审阅后在「工作台」采纳或驳回（驳回即重新生成本任务书再投递），已采纳的文档将被拆分任务书列为必读。本阶段一个产物：`,
    '1. 技术规划文档——现状盘点、技术方案、改动面、风险与开放问题、实施顺序草案（六节结构见「输出」）。',
    '本阶段不做工作包拆分清单、不做开发计划、不改任何代码——拆分与实施紧随其后：先有方案再切清单，顺序颠倒会让方案迁就清单而不是清单服从方案。',
  ].join('\n')
}

function planSnapshotBlock(ctx: SowContext): string {
  const lines = [
    '## 需求快照（工作台账本，生成时快照）',
    `标题：${ctx.requirement.title}`,
    `描述：${ctx.requirement.description}`,
  ]
  if (ctx.record === null) {
    lines.push('（工作台记录未建立——尚无基线文档与裁决可用，规划只能基于需求描述）')
    return lines.join('\n')
  }
  lines.push(`当前阶段：${STAGE_LABEL[ctx.record.stage]}`)
  lines.push(ctx.record.understandApprovedAt !== undefined
    ? `需求理解定稿：已定稿（${ctx.record.understandApprovedAt.slice(0, 10)}）——理解阶段的裁决视为已定输入`
    : '需求理解定稿：未定稿——理解阶段的裁决可能仍在进行')
  if (ctx.record.planAdoptedAt !== undefined) {
    lines.push(`技术规划采纳：已采纳（${ctx.record.planAdoptedAt.slice(0, 10)}）——本次为重新规划：新文档将覆盖既有规划文件，采纳锚以重新采纳为准`)
  }
  if (ctx.record.workPackages.length > 0) {
    lines.push('现有工作包（重规划语境的参考——现状边界与状态）：')
    for (const wp of ctx.record.workPackages) {
      lines.push(`- ${wp.id} ${wp.title} · ${WP_STATUS_LABEL[wp.status]}（${wp.status}）`)
    }
  }
  return lines.join('\n')
}

function planConstraintsBlock(ctx: SowContext): string {
  // The consolidate file-channel form verbatim: the planning file is the ONE
  // write the task book prescribes when armed.
  const fileChannel = ctx.requirement.workspacePath.trim() !== ''
  return [
    '## 约束',
    fileChannel
      ? '- 严格只读：不修改、创建、删除任何文件——唯一例外：把技术规划文档写入「输出」节指定路径（目录不存在则创建，覆盖写）。'
      : '- 严格只读：不修改、创建、删除任何文件。',
    '- 不裁决：方案是建议，采纳、驳回、拆分登记、阶段推进全部由用户在工作台完成；规划中发现的新风险写入「风险与开放问题」节，不要顺手处置。',
    '- 有据：现状盘点与改动面的判断给出依据（基线文档 FR/C 编号 或 代码 路径:行号）；查不到依据的显式标「推测」。',
    '- 有限停止：仅当基线文档与代码现状不足以支撑任何方案取舍时停下来问用户；其余自行给出带取舍说明的方案。',
  ].join('\n')
}

const PLAN_WORKFLOW = [
  '## 工作流',
  '1. 通读需求基线文档与需求快照——先明确验收面（基线文档「验收标准」节逐条 C 编号）与既定约束（「已裁决风险」节是输入，不是待办）。',
  '2. 探索与需求相关的模块（限需求相关范围，不做全库漫游）——目录结构、现有实现与可复用件；探察过的文件路径记入文档「现状盘点」（「已探索」必须有清单为证）。',
  '3. 起草技术方案：候选路径、选型理由（为什么不是另一条路）、总体结构与关键设计决策。',
  '4. 风险与开放问题：技术风险与缓解、需要需求方拍板的开放问题（每问附推荐答案——把问题措辞成「是」即接受推荐）。',
  '5. 实施顺序草案：依赖顺序与理由、建议的工作包轮廓（粗粒度边界与并行性——论证材料，正式清单由拆分会话产出并经用户裁决登记）。',
  '先查后问：能从基线文档、代码、目录里查证的事实自己去查；只有影响方案形态的取舍留给需求方——提问带推荐方案，而不是自行假设。',
].join('\n')

function planOutputBlock(ctx: SowContext): string {
  // The consolidateOutputBlock channel form verbatim (file delivery when
  // armed, conversation delivery otherwise) — six sections, NO declare block
  // (the 整理任务书 no-return precedent), no revision stamp (0009 D4).
  const workspace = ctx.requirement.workspacePath.trim()
  const fileChannel = workspace !== ''
  const delivery = fileChannel
    ? `规划结束时把完整文档写入规划文件（markdown，一次成文），路径：${toDisplayPath(workspace)}/${planningDocRelPath(ctx.requirement.id)}（绝对路径；目录不存在则创建；覆盖写——不追加、不留多份）。文档固定六节结构：`
    : '（本需求未绑定工作区——无法指定规划文件路径，请在会话内交付文档全文。绑定工作区后重新生成任务书。）'
  return [
    '## 输出',
    delivery,
    '```markdown',
    '# 技术规划 · <需求标题>',
    '> 规划状态：草稿（采纳由工作台盖章管理）',
    '> 基于 workbench revision <N> 生成 · <日期>',
    '',
    '## 现状盘点',
    '<与需求相关的现有实现：模块、接口、数据——逐条注 路径:行号；探察过的文件清单（「已探索」以清单为证）>',
    '',
    '## 技术方案',
    '<候选路径与选型理由（为什么不是另一条路）；总体结构与关键设计决策；与参考知识冲突处显式标注>',
    '',
    '## 改动面',
    '<模块 × 文件级：新增/修改/删除；与现有实现的接缝>',
    '',
    '## 风险与开放问题',
    '<[风险] 标题：影响与缓解；开放问题：问题 + 推荐答案（待需求方）>',
    '',
    '## 实施顺序草案',
    '<依赖顺序与理由；建议的工作包轮廓（粗粒度边界/并行性）——论证材料，正式清单由拆分产出>',
    '',
    '## 对拆分的建议原则',
    '<边界怎么切、什么必须同包、什么必须分包——给拆分会话的约束建议>',
    '```',
    fileChannel
      ? '完成自检（全部满足才算收尾）：六节齐全 · 现状盘点带文件清单与出处 · 方案有取舍理由 · 改动面到文件级 · 开放问题带推荐答案 · 文档已写入上述路径。'
      : '完成自检（全部满足才算收尾）：六节齐全 · 现状盘点带文件清单与出处 · 方案有取舍理由 · 改动面到文件级 · 开放问题带推荐答案。',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// WP-plan assembly (0018 工作包规划两步化轮, decisions/0018 D1/D7) — the
// sixth AI-session purpose: the WP-granularity member of the nine-block
// family. A read-only planning session drafts the FINE-GRAINED plan (task
// decomposition × file-level changes / test arrangement / risks) into the
// prescribed workspace file; the workbench seeds it into plans[] as a DRAFT
// version and the user approves it (hard gate ② semantics unchanged — the
// approval finally rules on an AI proposal instead of one's own textarea).
// NO declare block (the plan purpose no-return precedent — collection rides
// the file hash), NO revision stamp (0010 D4 AI-context discipline).
// ---------------------------------------------------------------------------

function wpPlanGoalBlock(ctx: SowContext): string {
  const wp = ctx.workPackage
  const target = wp !== undefined ? `工作包 ${wp.id}「${wp.title}」` : '该工作包'
  return [
    '## 目标',
    `为需求「${ctx.requirement.title}」的${target}做一次只读的细粒度开发规划，产出一份工作包计划文件——文件读者是需求负责人：负责人审阅后在「工作台」批准或退回（退回即重新生成本任务书再投递），已批准的计划将全文嵌入开发任务书，成为开发会话的实施依据。本阶段一个产物：`,
    '1. 工作包计划——任务分解（步骤 × 文件级改动面）、测试安排、风险与开放问题（三节结构见「输出」）。',
    '本阶段不写任何实现代码——实施是计划批准后开发会话的事，现在动手会污染规划；不改边界——边界由拆分批准锁定，发现边界问题报告而不是扩界。',
  ].join('\n')
}

function wpPlanSnapshotBlock(ctx: SowContext): string {
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
  lines.push(ctx.record.understandApprovedAt !== undefined
    ? `需求理解定稿：已定稿（${ctx.record.understandApprovedAt.slice(0, 10)}）——理解阶段的裁决视为已定输入`
    : '需求理解定稿：未定稿——理解阶段的裁决可能仍在进行')
  const wp = ctx.workPackage
  if (wp !== undefined) {
    lines.push('[工作包]', `${wp.id}　${wp.title}`, `边界：${wp.boundary}`)
    lines.push(`依赖：${wp.dependsOn.length > 0 ? wp.dependsOn.join('、') : '无'}`)
    const covered = ctx.record.criteria.filter((criterion) => wp.covers.includes(criterion.id))
    if (covered.length > 0) {
      lines.push('覆盖标准：')
      for (const criterion of covered) lines.push(`- ${criterion.id} ${criterion.text}`)
    } else {
      lines.push('覆盖标准：无')
    }
    // Re-plan context: the version chain's SHAPE only, never bodies — the
    // rejected-draft reference embed is a 刀三 candidate (0018 §4.4).
    if (wp.plans.length > 0) {
      lines.push('现有计划版本（重规划语境的参考——历史的轮廓，不代表当前共识）：')
      for (const plan of [...wp.plans].sort((a, b) => b.version - a.version)) {
        lines.push(`- v${plan.version}${plan.approvedAt !== undefined ? ` 已批准（${plan.approvedAt.slice(0, 10)}）` : ' 草稿'}`)
      }
    }
  }
  return lines.join('\n')
}

function wpPlanConstraintsBlock(ctx: SowContext): string {
  // The consolidate file-channel form verbatim: the plan file is the ONE
  // write the task book prescribes when armed.
  const fileChannel = ctx.requirement.workspacePath.trim() !== ''
  return [
    '## 约束',
    fileChannel
      ? '- 严格只读：不修改、创建、删除任何文件；不建分支、不提交、不推送——唯一例外：把工作包计划文件写入「输出」节指定路径（目录不存在则创建，覆盖写——不追加、不留多份）。'
      : '- 严格只读：不修改、创建、删除任何文件；不建分支、不提交、不推送。',
    '- 边界纪律：任务分解必须在给定边界内——不改边界、不增删覆盖标准、不改依赖；发现边界本身有问题（缺关键依赖、切分错位）停下来向用户报告，不要自行扩界或越界规划。',
    '- 不裁决：计划是建议，批准、退回、开工全部由用户在工作台完成；规划中发现的新风险写入「风险与开放问题」节，不要顺手处置。',
    '- 有据：任务分解与改动面的判断给出依据（基线文档 FR/C 编号 或 代码 路径:行号）；查不到依据的显式标「推测」。',
    '- 有限停止：仅当边界内信息不足以规划任何步骤时停下来问用户；其余自行给出带取舍说明的分解。',
  ].join('\n')
}

const WP_PLAN_WORKFLOW = [
  '## 工作流',
  '1. 通读需求基线文档、（如在场）技术规划文档与需求快照——先明确验收面（覆盖标准逐条）与既定方案。',
  '2. 在边界内探索与该包相关的模块（限边界相关范围，不做全库漫游）——现有实现、可复用件、接缝；探察过的文件路径记入计划（「已探索」以清单为证）。',
  '3. 起草任务分解：把边界切成有序、可独立验证的开发任务——每步做什么、改哪些文件（路径级）、产出与判定，并说明步骤间依赖。',
  '4. 测试安排：每步或整体的验证方式（命令 / 手测点），与覆盖标准对应。',
  '5. 风险与开放问题：实施风险与缓解；需要需求方拍板的开放问题（每问附推荐答案——把问题措辞成「是」即接受推荐）。',
  '先查后问：能从基线文档、规划文档、代码、目录里查证的事实自己去查；只有影响分解形态的取舍留给需求方——提问带推荐方案，而不是自行假设。',
].join('\n')

function wpPlanOutputBlock(ctx: SowContext): string {
  const wp = ctx.workPackage
  const workspace = ctx.requirement.workspacePath.trim()
  const fileChannel = workspace !== '' && wp !== undefined
  const delivery = fileChannel
    ? `规划结束时把完整计划写入计划文件（markdown，一次成文），路径：${toDisplayPath(workspace)}/${wpPlanRelPath(wp.id)}（绝对路径；目录不存在则创建；覆盖写——不追加、不留多份）。文件固定三节结构：`
    : '（本需求未绑定工作区——无法指定计划文件路径，请在会话内交付计划全文，由用户手动录入计划草稿。绑定工作区后重新生成任务书。）'
  return [
    '## 输出',
    delivery,
    '```markdown',
    '# 工作包计划 · <WP 编号> <标题>',
    '> 计划状态：草稿（批准由工作台盖章管理）',
    '> 基于 workbench revision <N> 生成 · <日期>',
    '',
    '## 任务分解',
    '<步骤 1：标题——做什么、改哪些文件（路径级）、产出与判定；步骤间依赖；探察过的文件清单（「已探索」以清单为证）>',
    '',
    '## 测试安排',
    '<每步或整体的验证方式（命令 / 手测点），与覆盖标准（Cx）对应>',
    '',
    '## 风险与开放问题',
    '<[风险] 标题：影响与缓解；开放问题：问题 + 推荐答案（待需求方）>',
    '```',
    fileChannel
      ? '完成自检（全部满足才算收尾）：每步有产出与文件级落点 · 步骤依赖已说明 · 测试安排覆盖全部覆盖标准 · 开放问题带推荐答案 · 计划文件已写入上述路径。'
      : '完成自检（全部满足才算收尾）：每步有产出与文件级落点 · 步骤依赖已说明 · 测试安排覆盖全部覆盖标准 · 开放问题带推荐答案。',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Consolidate assembly (0008 需求基线文档轮) — the fifth purpose: the
// consolidation session MERGES the original PRD with the adjudicated
// findings/criteria/clarifications (+ knowledge background) into ONE
// standard-structure requirement baseline doc, the file downstream consumes
// as THE requirement source of truth. Unlike analysis/split the snapshot
// embeds FULL-TEXT adjudication material (detail + resolution + whole Q&A) —
// consolidation needs the complete raw material, not one-line summaries.
// ---------------------------------------------------------------------------

function consolidateGoalBlock(ctx: SowContext): string {
  return [
    '## 目标',
    `为需求「${ctx.requirement.title}」把已裁决的需求理解整理成一份需求基线文档——以原始 PRD 为底，融合已采纳的分析发现、验收标准与澄清答案，去冗余、补背景、消除歧义，产出一份比原始 PRD 更准确、更完整、更适合后续 AI 会话阅读的标准需求文档。文档读者是后续的拆分/开发会话与需求评审人——他们以这份文档为需求的唯一真源。`,
    '本阶段不做新的分析、不做拆分规划、不改任何代码——整理是表达，不是再裁决。',
  ].join('\n')
}

function consolidateSnapshotBlock(ctx: SowContext): string {
  const lines = [
    '## 需求快照（工作台账本，生成时快照——全量素材，整理的原料）',
    `标题：${ctx.requirement.title}`,
    `描述：${ctx.requirement.description}`,
  ]
  if (ctx.record === null) {
    lines.push('（工作台记录未建立——尚无裁决可用，整理只能基于 PRD 原文）')
    return lines.join('\n')
  }
  // FULL-TEXT adjudication material — the one place the SOW embeds detail and
  // resolution (analysis/split keep one-line summaries; consolidation rewrites
  // the expression, so it needs everything).
  lines.push('已采纳的验收标准（C 编号即文档验收标准节的编号——逐条对应，不增不删）：')
  if (ctx.record.criteria.length === 0) lines.push('（尚无）')
  for (const criterion of ctx.record.criteria) {
    const source = criterion.sourceSection !== undefined && criterion.sourceSection.length > 0 ? `（出处 ${criterion.sourceSection}）` : ''
    lines.push(`- ${criterion.id} ${criterion.text}${source}`)
  }
  lines.push('分析发现（全部，含处置结论——已解决带方案全文）：')
  if (ctx.record.findings.length === 0) lines.push('（尚无）')
  for (const finding of ctx.record.findings) {
    const plan = finding.status === 'resolved' && finding.resolution !== undefined && finding.resolution.length > 0 ? `；方案：${finding.resolution}` : ''
    const statusLabel = finding.status === 'open' ? '未处置' : finding.status === 'resolved' ? '已解决' : '不处理'
    lines.push(`- [${FINDING_CATEGORY_LABEL[finding.category]}·${SEVERITY_LABEL[finding.severity]}] ${finding.title}（${statusLabel}）${finding.detail.length > 0 ? `：${finding.detail}` : ''}${plan}`)
  }
  if (ctx.record.findings.some((finding) => finding.status === 'open')) {
    lines.push('（未处置发现须如实列入文档「已裁决风险」节——不得在整理中静默解决或弱化。）')
  }
  const clarifications = ctx.record.analysis?.clarifications ?? []
  const answered = clarifications.filter((row) => row.answer !== undefined)
  if (answered.length > 0) {
    lines.push('已答澄清（需求方已回答——视为已定事实，回填正文并消除原歧义表述）：')
    for (const row of answered) lines.push(`- 问：${row.question}\n  答：${row.answer}`)
  }
  const pendingFindings = ctx.record.analysis?.findings ?? []
  const pendingCriteria = ctx.record.analysis?.criteria ?? []
  const pendingClarifications = clarifications.filter((row) => row.answer === undefined)
  if (pendingFindings.length + pendingCriteria.length + pendingClarifications.length > 0) {
    lines.push('待裁决提议（用户裁决中——一律不得写入文档，视为不存在）：')
    for (const row of pendingFindings) lines.push(`- [${FINDING_CATEGORY_LABEL[row.category]}·${SEVERITY_LABEL[row.severity]}] ${row.title}`)
    for (const row of pendingCriteria) lines.push(`- 标准：${row.text}`)
    for (const row of pendingClarifications) lines.push(`- 澄清：${row.question}`)
  }
  if (ctx.record.understandApprovedAt !== undefined) {
    lines.push(`（当前已定稿于 ${ctx.record.understandApprovedAt.slice(0, 10)}——本次为重新整理：保持既有 FR 编号稳定，不回收不重排。）`)
  }
  return lines.join('\n')
}

function consolidateConstraintsBlock(ctx: SowContext): string {
  const workspace = ctx.requirement.workspacePath.trim()
  const fileChannel = workspace !== ''
  return [
    '## 约束',
    fileChannel
      ? `- 严格只读：不修改、创建、删除任何文件——唯一例外：把需求基线文档写入「输出」节指定路径（目录不存在则创建，覆盖写）。`
      : '- 严格只读：不修改、创建、删除任何文件。',
    '- 不改判：已裁决的发现处置、已采纳的标准、已答的澄清是既定输入——整理只负责表达，不新增裁决、不弱化风险、不替需求方做未做的决定。',
    '- 澄清回填：已答澄清的答案要融进对应表述并替换原歧义写法——不留自相矛盾的新旧双表述。',
    '- 编号纪律：验收标准 C 编号与快照逐条对应，不增不删不改号；功能需求 FR 编号一经发布不回收不重排（既有文档存在时保持稳定）。',
    '- 有据：每条 FR 与验收标准带溯源标注（PRD#章节 / 发现编号 / 澄清来源）；PRD 没有依据、整理中推断的内容显式进「假设」节（内联 [ASSUMPTION] 标记 + 文末索引）。',
    '- 术语单一：全文同一概念只用同一术语（术语表为唯一来源）；未决问题如实列入 Open Questions，不猜测、不硬凑。',
  ].join('\n')
}

const CONSOLIDATE_WORKFLOW = [
  '## 工作流',
  '1. 通读全部 PRD 文档与需求快照——先分清：已定事实（标准/处置/已答澄清）、已知风险（含未处置）、PRD 原始表达中的冗余与歧义。',
  '2. 重组为十节结构（见「输出」）：以 PRD 为底去冗余（重复表述合并、过时表述按已答澄清替换、装饰性文字剔除），把裁决结论融进对应条目。',
  '3. 逐条标注溯源：FR 与验收标准的每一条注明来自 PRD#章节 / 发现编号 / 澄清来源；推断项标 [ASSUMPTION] 并入文末索引。',
  '4. 自检可判定性：每条 FR 一句一条、含可观察的行为；歧义形容词（快速/稳定/灵活…）要么量化、要么删除、要么进 Open Questions。',
  '5. 对照快照核对：C 编号逐条对齐、未处置发现未消失、待裁决提议零出现。',
].join('\n')

function consolidateOutputBlock(ctx: SowContext): string {
  const workspace = ctx.requirement.workspacePath.trim()
  const fileChannel = workspace !== ''
  const delivery = fileChannel
    ? `整理结束时把完整文档写入基线文件（markdown，一次成文），路径：${toDisplayPath(workspace)}/${requirementDocRelPath(ctx.requirement.id)}（绝对路径；目录不存在则创建；覆盖写——不追加、不留多份）。文档固定十节结构：`
    : '（本需求未绑定工作区——无法指定基线文件路径，请在会话内交付文档全文。绑定工作区后重新生成任务书。）'
  return [
    '## 输出',
    delivery,
    '```markdown',
    '# 需求基线 · <需求标题>',
    '> 基线状态：<草稿/已定稿——由工作台定稿盖章管理，此处写「草稿」>',
    '> 基于 workbench revision <N> 整理 · <日期>',
    '',
    '## 背景与目标',
    '<PRD 意图综述 + 参考知识补充的权威背景；目标用可判定的完成定义收口>',
    '',
    '## 非目标',
    '<明确排除与缓办的事项——去冗余的落点，PRD 未提但整理中判定应排除的进假设节>',
    '',
    '## 术语表',
    '- <术语>：<定义>（全文唯一用词，不得引入同义词）',
    '',
    '## 功能需求',
    '### FR-1 <短名>',
    '<一句一条：系统 MUST/SHALL <可观察行为>。',
    '> 溯源：PRD#章节 / 发现 <编号> / 澄清 <编号>；推断处标 [ASSUMPTION: …]>',
    '',
    '## 验收标准',
    '<C 编号与工作台账本逐条对应——每条：判定条件（可观察、可量化），> 溯源：PRD#章节 / 标准采纳',
    '',
    '## 边界与异常',
    '<IF <异常条件> THE SYSTEM SHALL <处置行为>——边界情形与降级行为>',
    '',
    '## 已裁决风险',
    '<[类别·级别] 标题：结论（已解决——方案：… / 不处理 / 未处置——如实标注）>',
    '',
    '## 澄清记录',
    '### 已答（已定事实）',
    '- 问：<问题> 答：<答案>（已回填正文）',
    '### Open Questions（未答——待需求方）',
    '- 问：<问题>（推荐答案：…）',
    '',
    '## 假设',
    '<[ASSUMPTION: …] 内联于正文；本节汇总索引，逐条可被需求方否决>',
    '',
    '## 变更记录',
    '| 日期 | 版本 | 说明 | 来源 |',
    '```',
    fileChannel
      ? '完成自检（全部满足才算收尾）：十节齐全 · C 编号与快照逐条对齐 · 每条 FR/AC 带溯源 · 澄清已回填且无新旧矛盾表述 · 未处置发现如实在场 · 待裁决提议零出现 · [ASSUMPTION] 有索引 · 文档已写入上述路径。'
      : '完成自检（全部满足才算收尾）：十节齐全 · C 编号与快照逐条对齐 · 每条 FR/AC 带溯源 · 澄清已回填且无新旧矛盾表述 · 未处置发现如实在场 · 待裁决提议零出现 · [ASSUMPTION] 有索引。',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Review assembly (0023 评审方法论轮, decisions 0023) — review joins the
// nine-block family with its own TWO-GOAL wording: ① criteria conformance
// (逐条验收标准核验 — the PR-Agent TicketCompliance precedent: satisfied /
// unmet / requires-further-human-verification, zh 无法核验) and ② a quality
// sweep (六维 + per-dimension judging criteria, the 0008 recipe applied to
// review). The snapshot carries the ledger's criteria AND the per-WP
// confirmed commits as the 改动面 anchor (zero commits = honest absence);
// constraints gain 不运行代码 (what needs a run is not-verifiable, honestly
// listed — never run on the reviewer's own initiative); the output contract
// adds criteriaChecks + findings detail to the `# skyaxis-review` block.
// NO revision stamp (the family discipline since 0009/0010: the AI-context
// honesty anchor is the snapshot header's 生成时快照 wording); dev keeps the
// five-block shape and its stamp untouched.
// ---------------------------------------------------------------------------

function reviewGoalBlock(ctx: SowContext): string {
  return [
    '## 目标',
    `为需求「${ctx.requirement.title}」的评审阶段做一次只读代码评审，回答两个问题——当前代码实现满足验收标准吗（需求完成情况）？代码本身有没有缺陷、漏洞或显著风险（代码质量情况）？产出一份供需求负责人裁决的评审报告——报告读者没读过你的评审过程，只读结论与证据。本阶段两个产物：`,
    '1. 验收核验——逐条验收标准 × 当前代码，给出 满足 / 不满足 / 无法核验（仅凭读代码判不了的如实标注，并说明需要什么人工验证），每条带证据（路径:行号）。',
    '2. 质量发现——代码缺陷、安全漏洞与显著风险（六维排查，判据见「工作流」第 4 步），每条带说明、证据与触发场景。',
    '本阶段不改任何代码、不运行代码、不裁决——验收通过与处置由用户在工作台完成；修复是后续开发会话的事，现在动手会污染评审。',
  ].join('\n')
}

function reviewSnapshotBlock(ctx: SowContext): string {
  const lines = [
    '## 需求快照（工作台账本，生成时快照）',
    `标题：${ctx.requirement.title}`,
    `描述：${ctx.requirement.description}`,
  ]
  if (ctx.record === null) {
    lines.push('（工作台记录未建立——无验收标准与工作包可核验，评审以质量发现为主）')
    return lines.join('\n')
  }
  lines.push(`当前阶段：${STAGE_LABEL[ctx.record.stage]}`)
  // The checklist the reviewer audits against — the ledger is the criteria
  // truth (P5b), the baseline doc carries the surrounding requirement prose.
  lines.push('验收标准（你将逐条核验它们）：')
  if (ctx.record.criteria.length === 0) lines.push('（尚无）')
  for (const criterion of ctx.record.criteria) lines.push(`- ${criterion.id} ${criterion.text}`)
  // 0023 D1-A: the per-WP confirmed commits are the 改动面 anchor — the
  // reviewer scopes to them (plus package boundaries) instead of roaming the
  // whole repo. Zero confirmed commits = the honest absence line (the
  // boundary + baseline doc stand in as the scope).
  lines.push('工作包与改动面（提交由用户逐条确认，是你定位本次改动的主要锚）：')
  if (ctx.record.workPackages.length === 0) {
    lines.push('（尚无工作包——改动面以基线文档与仓库现状为准）')
    return lines.join('\n')
  }
  for (const wp of ctx.record.workPackages) {
    lines.push(`- ${wp.id} ${wp.title} · ${WP_STATUS_LABEL[wp.status]}（${wp.status}）`)
    if (wp.commits.length === 0) {
      lines.push('  （尚无已确认提交——该包改动面以其边界与基线文档描述为准）')
      continue
    }
    for (const commit of wp.commits) {
      lines.push(`  - 提交 ${commit.hash.slice(0, 7)} ${commit.note}`)
    }
  }
  return lines.join('\n')
}

function reviewConstraintsBlock(ctx: SowContext): string {
  return [
    '## 约束',
    // Review is read-only INCLUDING runs: a reviewer-initiated run writes
    // artifacts and its outcome belongs to the user's own verification —
    // the not-verifiable channel carries those criteria honestly instead.
    '- 严格只读：不修改、创建、删除任何文件；不建分支、不提交、不推送；不运行代码、测试或构建——需要运行才能核验的标准判「无法核验」并写明需要什么人工验证，不要替人运行。评审报告在会话内交付，不写文件。',
    '- 不裁决：核验结论与发现皆为建议，验收（通过/不通过）、处置、阶段推进全部由用户在工作台完成；发现处置建议可以给，但不要顺手实施。',
    '- 有据：每条核验与每条发现给出证据（路径:行号）；查不到依据的结论显式标「推测」；与参考知识条目冲突的发现至少「高」级并注明知识条目标题。',
    // PR-Agent's flagging discipline, zh: thorough on clear bugs/security,
    // certain before flagging the rest, uncertainty disclosed when impact is
    // high, zero findings stated gracefully.
    '- 如实分级：有把握才报——明确的缺陷与安全问题要彻底查；低严重度的问题说得出具体触发场景才报；不确定但可能高危（如数据丢失、安全）的，注明不确定处再报，否则宁可不报；不夸大影响——仅在特定输入或环境才出现的问题开头就说明条件；某维度没有发现时如实写「未发现」，不要硬凑。',
    '- 有限停止：仅当关键输入（基线文档、仓库）不可读，或验收标准信息不足以核验任何一条时停下来问用户；其余自行推进。',
  ].join('\n')
}

const REVIEW_WORKFLOW = [
  '## 工作流',
  '1. 通读需求基线文档与需求快照——列出核验清单：每条验收标准一个判定点（快照「验收标准」节的 C 编号即清单）。',
  '2. 定位改动面：以快照「工作包与改动面」的包边界与提交为锚；无提交的包以边界与基线文档描述为界。探索限改动面及其直接接缝，不做全库漫游；探察过的文件路径记入报告（「已评审」以清单为证）。',
  '3. 逐条核验：每条标准找到对应实现，读代码判定 满足 / 不满足 / 无法核验，记证据（路径:行号）；一条标准横跨多个包时逐包注明；找不到对应关系的（标准与代码对不上号）判「无法核验」并说明找过哪里。',
  '4. 六维质量排查（每维一条判据，逐维给结论）：',
  '   - 缺陷：会实际出错的逻辑、边界、并发与资源问题——说得出具体触发场景才算，泛泛的「可能有问题」不算。',
  '   - 安全：注入、输入校验、认证与会话、访问控制、敏感信息、加密误用，六类逐一过（OWASP 代码评审清单的常设类别）。',
  '   - 性能与容量：数据量级、超时、资源上限、明显低效的路径。',
  '   - 复杂度与可维护性：对改动逐段两问——不看注释能看懂吗？真的需要吗（为推测性未来写的过度设计也是缺陷）？重复与误导性命名/注释在此列。',
  '   - 测试：本次改动有没有对应测试；明显缺口逐条列出。',
  '   - 一致性：与既有实现、既定行为、参考知识直接冲突处。',
  '5. 汇总报告（三节结构见「输出」），总体结论先行，无法核验项单独成列。',
  '先查后问：能从代码、基线文档、目录里查证的自己查；只有影响结论的取舍留给需求方——提问带推荐答案，而不是自行假设。',
].join('\n')

function reviewOutputBlock(ctx: SowContext): string {
  return [
    '## 输出',
    '评审结束时先给出完整报告正文（markdown，会话内交付，不写文件），并在结尾附上机器可读的发现块（条目用缩进键值，勿用行内逗号；块体必须完整包在 ```yaml 围栏内——三个反引号起、三个反引号收，缺围栏无法收取）。报告按三节组织：',
    '1. 总体结论——两三句：验收面达成概况（n 满足 / m 不满足 / k 无法核验）、总体风险等级（判据见下）、建议用户优先查看的文件。',
    '2. 验收核验——每条一行起：C1 满足｜证据：路径:行号；不满足的随后一两句说明差距；无法核验的写明需要什么人工验证（如「需人工在浏览器验证」「需运行测试套件」）。按 C 编号排序，一条不漏。',
    '3. 质量发现——每条一行起：Q1 [维度·级别] 标题；随后说明（一两句）、证据（路径:行号）、（如适用）触发场景。按级别降序、同级按维度分组；编号 Q1、Q2… 稳定不重排；六维逐维给过结论——没有发现的维度如实写「未发现」，不要硬凑；全部为零时显式说明残余风险与未覆盖范围（哪些没查、为什么）。',
    '（级别判据：高 = 明确缺陷或安全漏洞、不处理则验收不成立或触碰安全/数据/已注入约定；中 = 不阻塞验收但应在验收通过前解决；低 = 提示性、可延后。）',
    '（总体风险判据：高 = 存在「高」级发现或验收面有「不满足」；中 = 无「高」级发现但存在「中」级发现或需人工细看的非平凡区域；低 = 无重要问题。）',
    '```yaml',
    '# skyaxis-review',
    '# criteriaChecks 每条 = 一条验收标准的核验结论；result: satisfied|unmet|not-verifiable',
    '# 条目形如：',
    '#   - ref: C1',
    '#     result: satisfied',
    '#     evidence: 路径:行号（not-verifiable 时写需要什么人工验证）',
    'criteriaChecks: []',
    '# findings 每条 = 一个待用户裁决的发现；severity: high|medium|low',
    '# 条目形如：',
    '#   - title: 发现标题（64 字内）',
    '#     severity: high',
    '#     detail: 说明与证据（路径:行号）',
    'findings: []',
    '```',
    '说明：criteriaChecks 与 findings 皆是提议——核验结论供用户对照，发现的裁决（成立/驳回）与处置由用户在工作台完成，不要替用户下结论；机器块与报告正文一致（正文详述，块收结构化结论）。',
    '完成自检（全部满足才算收尾）：每条标准有判定与证据 · 无法核验项已列明所需人工验证 · 六维逐维有结论 · 每条发现有级别/证据/触发场景 · 机器块已附（criteriaChecks 覆盖全部标准、findings 与正文一致）。',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

function revisionStamp(ctx: SowContext): string {
  // 0009: dev/review originally; 0023: dev only — review joined the
  // nine-block family and follows its discipline (the honesty anchor is the
  // snapshot header's 生成时快照 wording).
  const date = ctx.generatedAt.slice(0, 10)
  return `生成于 revision ${ctx.revision} · ${date} · 此后账本变更不自动同步`
}

/**
 * Assemble the SOW markdown. Analysis/split/consolidate get the nine-block
 * research-0008 assembly; dev keeps the original five-block shape (research
 * 0006 §7.1); review rejoined the nine-block family in 0023 with its own
 * two-goal methodology (decisions 0023). 0009: the revision stamp retires
 * for the AI-session purposes (conservative trim, user ruling — the
 * ledger-move honesty rides the snapshot's 生成时快照 header); dev keeps it.
 * Section headers are fixed zh; the declare skeleton is dev-shaped
 * (`workPackage:` + claims) or the plain shape.
 */
export function buildSow(ctx: SowContext): string {
  if (ctx.purpose === 'analysis') {
    const blocks = [
      `# 分析任务书 · ${ctx.requirement.title}`,
      analysisGoalBlock(ctx),
      analysisSnapshotBlock(ctx),
      analysisInputBlock(ctx, `## 输入${INPUT_INSTRUCTION}`),
      knowledgeBlock(ctx, ANALYSIS_KNOWLEDGE_HEADER),
      analysisConstraintsBlock(ctx),
      ANALYSIS_WORKFLOW,
      analysisOutputBlock(ctx),
    ]
    return blocks.join('\n\n')
  }
  if (ctx.purpose === 'split') {
    // 0007: the nine-block research-0008 skeleton, split edition — the
    // five-block shape (PRD wholesale embedding) is retired FOR SPLIT ONLY;
    // dev/review keep it verbatim. 0009 D2: the requirement baseline doc is
    // the split session's ONLY requirement source (see analysisInputBlock /
    // splitSnapshotBlock).
    const blocks = [
      `# 拆分任务书 · ${ctx.requirement.title}`,
      splitGoalBlock(ctx),
      splitSnapshotBlock(ctx),
      analysisInputBlock(ctx, `## 输入${INPUT_INSTRUCTION}`),
      knowledgeBlock(ctx, ANALYSIS_KNOWLEDGE_HEADER),
      splitConstraintsBlock(ctx),
      SPLIT_WORKFLOW,
      splitOutputBlock(ctx),
    ]
    return blocks.join('\n\n')
  }
  if (ctx.purpose === 'consolidate') {
    // 0008: the same nine-block skeleton, consolidation edition.
    const blocks = [
      `# 需求整理任务书 · ${ctx.requirement.title}`,
      consolidateGoalBlock(ctx),
      consolidateSnapshotBlock(ctx),
      analysisInputBlock(ctx, `## 输入${INPUT_INSTRUCTION}`),
      knowledgeBlock(ctx, ANALYSIS_KNOWLEDGE_HEADER),
      consolidateConstraintsBlock(ctx),
      CONSOLIDATE_WORKFLOW,
      consolidateOutputBlock(ctx),
    ]
    return blocks.join('\n\n')
  }
  if (ctx.purpose === 'plan') {
    // 0012 两步化: the 2a exploration SOW — split's twin, document-delivery
    // output (no declare block, the consolidate no-return precedent).
    const blocks = [
      `# 规划任务书 · ${ctx.requirement.title}`,
      planGoalBlock(ctx),
      planSnapshotBlock(ctx),
      analysisInputBlock(ctx, `## 输入${INPUT_INSTRUCTION}`),
      knowledgeBlock(ctx, ANALYSIS_KNOWLEDGE_HEADER),
      planConstraintsBlock(ctx),
      PLAN_WORKFLOW,
      planOutputBlock(ctx),
    ]
    return blocks.join('\n\n')
  }
  if (ctx.purpose === 'wp-plan') {
    // 0018 工作包规划两步化: the WP-granularity member of the nine-block
    // family — read-only planning + single-file delivery. The discriminative
    // head carries the WP id (the dev SOW head precedent); no declare block
    // (collection rides the file hash), no revision stamp (0010 D4).
    const blocks = [
      ctx.workPackage !== undefined
        ? `# 工作包规划任务书 ${ctx.workPackage.id} · ${ctx.requirement.title}`
        : `# 工作包规划任务书 · ${ctx.requirement.title}`,
      wpPlanGoalBlock(ctx),
      wpPlanSnapshotBlock(ctx),
      analysisInputBlock(ctx, `## 输入${INPUT_INSTRUCTION}`),
      knowledgeBlock(ctx, ANALYSIS_KNOWLEDGE_HEADER),
      wpPlanConstraintsBlock(ctx),
      WP_PLAN_WORKFLOW,
      wpPlanOutputBlock(ctx),
    ]
    return blocks.join('\n\n')
  }
  if (ctx.purpose === 'review') {
    // 0023 评审方法论轮 (decisions 0023 D1-A): review joins the nine-block
    // family — two-goal wording, commits-anchored snapshot, 六维 sweep,
    // criteriaChecks+detail output contract. No revision stamp (the family
    // discipline — the honesty anchor is the snapshot header's 生成时快照);
    // no [工作包] block (review audits the WHOLE acceptance face, the WP
    // scope anchor rides the snapshot lines).
    const blocks = [
      `# 评审任务书 · ${ctx.requirement.title}`,
      reviewGoalBlock(ctx),
      reviewSnapshotBlock(ctx),
      analysisInputBlock(ctx, `## 输入${INPUT_INSTRUCTION}`),
      knowledgeBlock(ctx, ANALYSIS_KNOWLEDGE_HEADER),
      reviewConstraintsBlock(ctx),
      REVIEW_WORKFLOW,
      reviewOutputBlock(ctx),
    ]
    return blocks.join('\n\n')
  }
  // 0015: the five-block path (dev since 0023 — review moved to the
  // nine-block family) carries the SAME input rows the nine-block purposes
  // do — [PRD 节选] retired, the baseline-doc 必读 line + clone-repo rows
  // ride an [输入] block; the ledger snapshot (requirement / WP / criteria /
  // approved plan) stays embedded (P1).
  // 0016 刀一验收修正: the five-block purposes gain the family's discriminative
  // head line (`# …任务书`, the analysis/split/plan precedent — 0021 渲染轮去
  // skyaxis 品牌). For dev
  // it carries the WP id — DSH's send flow materializes the conversation under
  // a FRESH id (the created session is a config-only shell that stays blank
  // forever), so the head becomes the REAL session's fallback title and the
  // auto-bind pass content-addresses it per WP. The [需求] head cannot serve:
  // it is byte-identical across a requirement's WPs (decisions/0016 修订 #8).
  const blocks = [
    devSowTitleLine(ctx.workPackage?.id, ctx.requirement.title),
    requirementBlock(ctx),
    analysisInputBlock(ctx, `[输入]${INPUT_INSTRUCTION}`),
    ctx.purpose === 'dev' && ctx.workPackage !== undefined ? workPackageBlock(ctx) : '',
    knowledgeBlock(ctx, '[知识注入]'),
    outputBlock(ctx),
  ].filter((block) => block.length > 0)
  return [...blocks, revisionStamp(ctx)].join('\n\n')
}

/** 0016: the dev SOW head's fixed prefix (one truth for builder + matcher).
 * 0021 渲染轮: 品牌 skyaxis 退役——builder 产新形；matcher 双臂兼容旧形。 */
export const DEV_SOW_TITLE_PREFIX = '# 工作包任务书'

/** 0016: the dev SOW's discriminative head — `<prefix> WP<n> · <requirement>`. */
/**
 * 0019 D3-B: the rework-note text sent to the WP's tail dev binding after a
 * failed acceptance — composed off the LEDGER (the tail fail note the user
 * just wrote in the reject modal), user-editable in the modal before sending
 * (the 0009 preview discipline). The re-declare instruction is the watcher
 * re-seed hook (milestones 0016 验收脚本 #4: no fresh declare block → the
 * pending slot never resets → the rework loop breaks on the session side).
 */
export function buildReworkMessage(
  workPackage: Pick<WorkbenchWorkPackage, 'id' | 'title' | 'acceptances'>,
  requirementTitle: string,
): string {
  const tailFail = [...workPackage.acceptances].reverse().find((acceptance) => acceptance.result === 'fail')
  const round = workPackage.acceptances.length
  return [
    `# 返工话 ${workPackage.id} · ${requirementTitle}`,
    '',
    `工作包 ${workPackage.id} ${workPackage.title} 验收未通过（第 ${round} 轮验收）。`,
    '返工理由：',
    tailFail?.note ?? '',
    '',
    `要求：按返工理由修复本工作包范围内的问题；完成后在回复末尾重新输出声明块（形制同任务书「输出约定」，workPackage: ${workPackage.id}），工作台会重新收取。`,
  ].join('\n')
}

export function devSowTitleLine(workPackageId: string | undefined, requirementTitle: string): string {
  return workPackageId !== undefined
    ? `${DEV_SOW_TITLE_PREFIX} ${workPackageId} · ${requirementTitle}`
    : `${DEV_SOW_TITLE_PREFIX} · ${requirementTitle}`
}

/**
 * 0016: the WP-token matcher over a live session's display title. `(?!\d)`
 * keeps WP1 from bleeding into WP10; the match's capture IS the workPackageId
 * (the auto-bind pass's address). 0021 渲染轮: 标题去品牌后 builder 产
 * `# 工作包任务书 WPn`；可选 `skyaxis ` 前缀臂保住在途旧标题会话（0018
 * 存量修复先例）。
 */
export const DEV_SOW_TITLE_WP_RE = /^# (?:skyaxis )?工作包任务书 (WP[1-9]\d*)(?!\d)/
