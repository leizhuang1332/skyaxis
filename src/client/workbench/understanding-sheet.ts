/**
 * Understanding sheet (需求理解摘要) assembly — pure functions, no React, no
 * fetch (0007 定稿软门; the mockup's long-promised 「评审会问题单」). The
 * release-sheet.ts conventions carry over verbatim:
 *
 *  - the artifact itself is a self-contained CHINESE working file with fixed
 *    zh literals (the dictionary only serves UI chrome, never the artifact);
 *  - every status carries its raw enum in parentheses where it can round-trip;
 *  - the trailing revision stamp + 真源/分发 declaration retired with the
 *    2026-10-23 user ruling (the dev SOW stamp removal went family-wide).
 *
 * Honesty rules: empty groups are omitted entirely; UNANSWERED clarifications
 * are LISTED (not hidden) — they are precisely the questions the review
 * meeting must put to the requirement owner, the sheet's reason to exist.
 * Content always derives from the LIVE ledger (never the understandBaseline
 * credential — the snapshot is an anchor, not a second truth source).
 */
import type { WorkbenchFinding, WorkbenchRecord } from '../../workbench-shared/protocol.js'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'

/** 中文类别标签（穷举 Record——枚举加成员即 typecheck 红；sow.ts 同款值，自持副本对齐 release-sheet 自包含惯例）。 */
const FINDING_CATEGORY_LABEL: Record<WorkbenchFinding['category'], string> = {
  feasibility: '可行性',
  conflict: '冲突',
  compatibility: '兼容性',
  risk: '风险',
  capacity: '容量',
  other: '其他',
}

const FINDING_SEVERITY_LABEL: Record<WorkbenchFinding['severity'], string> = {
  high: '高',
  medium: '中',
  low: '低',
}

export interface UnderstandingSheetContext {
  requirement: RequirementRecord
  record: WorkbenchRecord
}

function titleBlock(ctx: UnderstandingSheetContext): string {
  const finalized = ctx.record.understandApprovedAt !== undefined
    ? `已定稿（${ctx.record.understandApprovedAt.slice(0, 10)}）`
    : '未定稿'
  return [
    `需求理解摘要：${ctx.requirement.title}`,
    '',
    `[定稿状态] ${finalized}`,
  ].join('\n')
}

function criteriaBlock(ctx: UnderstandingSheetContext): string {
  if (ctx.record.criteria.length === 0) return ''
  const rows = ctx.record.criteria.map((criterion) => {
    const source = criterion.sourceSection !== undefined && criterion.sourceSection.length > 0 ? ` —— 出处 ${criterion.sourceSection}` : ''
    return `- ${criterion.id}　${criterion.text}${source}`
  })
  return [`## 验收标准（${ctx.record.criteria.length}）`, ...rows].join('\n')
}

function findingLine(finding: WorkbenchFinding): string {
  return `- [${FINDING_CATEGORY_LABEL[finding.category]}·${FINDING_SEVERITY_LABEL[finding.severity]}]　${finding.title}`
}

function findingsBlock(ctx: UnderstandingSheetContext): string {
  const open = ctx.record.findings.filter((finding) => finding.status === 'open')
  const resolved = ctx.record.findings.filter((finding) => finding.status === 'resolved')
  const wontFix = ctx.record.findings.filter((finding) => finding.status === 'wont-fix')
  if (open.length + resolved.length + wontFix.length === 0) return ''
  const groups = [
    open.length > 0 ? [`### 未处置（${open.length}）`, ...open.map(findingLine)] : [],
    resolved.length > 0
      ? [`### 已解决（${resolved.length}）`, ...resolved.map((finding) => {
          const plan = finding.resolution !== undefined && finding.resolution.length > 0 ? ` —— 方案：${finding.resolution}` : ''
          return `${findingLine(finding)}${plan}`
        })]
      : [],
    wontFix.length > 0 ? [`### 不处理（${wontFix.length}）`, ...wontFix.map(findingLine)] : [],
  ].filter((group) => group.length > 0)
  return [`## 分析发现（${open.length + resolved.length + wontFix.length}）`, ...groups.flat()].join('\n')
}

function clarificationsBlock(ctx: UnderstandingSheetContext): string {
  const rows = ctx.record.analysis?.clarifications ?? []
  const answered = rows.filter((row) => row.answer !== undefined)
  const unanswered = rows.filter((row) => row.answer === undefined)
  if (answered.length + unanswered.length === 0) return ''
  const blocks = [
    answered.length > 0
      ? [`### 已答（${answered.length}）——视为已定事实`, ...answered.map((row) => `- 问：${row.question}\n  答：${row.answer}`)]
      : [],
    unanswered.length > 0
      ? [`### 未答（${unanswered.length}）——评审会待问`, ...unanswered.map((row) => {
          const recommendation = row.recommendation !== undefined && row.recommendation.length > 0 ? `（推荐答案：${row.recommendation}）` : ''
          const blocksNote = row.blocks !== undefined && row.blocks.length > 0 ? `〔阻塞 ${row.blocks}〕` : ''
          return `- 问：${row.question}${recommendation}${blocksNote}`
        })]
      : [],
  ].filter((block) => block.length > 0)
  return [`## 待澄清（${answered.length + unanswered.length}）`, ...blocks.flat()].join('\n')
}

/**
 * Assemble the understanding-sheet markdown: title + finalize status →
 * criteria → findings grouped by disposition (empty groups omitted) →
 * clarifications answered/unanswered. No trailing stamp (retired 2026-10-23).
 */
export function buildUnderstandingSheet(ctx: UnderstandingSheetContext): string {
  const blocks = [
    titleBlock(ctx),
    criteriaBlock(ctx),
    findingsBlock(ctx),
    clarificationsBlock(ctx),
  ].filter((block) => block.length > 0)
  return blocks.join('\n\n')
}
