/**
 * Release sheet (上线单) assembly — pure functions, no React, no fetch
 * (0006 P3a; research 0006 §7.3). The SOW conventions carry over verbatim:
 *
 *  - the artifact itself is a self-contained CHINESE working file with fixed
 *    zh literals (the dictionary only serves UI chrome, never the artifact);
 *  - every status carries its raw enum in parentheses (中文标签 + raw 值
 *    双写——人读中文，机器读原值);
 *  - the document ends with the revision stamp (the ledger may move on after
 *    generation and nothing auto-syncs).
 *
 * Honesty rules specific to the sheet: empty groups are omitted entirely
 * (a「其他（0）」header claims a category that has nothing in it); drifted
 * items disclose their drift inline — the sheet is the release record and
 * must not launder externally-edited content as clean.
 */
import type { ReleaseItem, WorkbenchRecord } from '../../workbench-shared/protocol.js'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'

/** 中文状态标签（穷举 Record——枚举加成员即 typecheck 红）。 */
const RELEASE_STATUS_LABEL: Record<ReleaseItem['status'], string> = {
  pending: '待确认',
  confirmed: '已确认',
  applied: '已执行',
  verified: '已验证',
  'rolled-back': '已回滚',
}

/** 分组标签 + 导出顺序（穷举 Record；顺序即 sheet 的组序）。 */
const RELEASE_TYPE_LABEL: Record<ReleaseItem['type'], string> = {
  sql: 'SQL',
  config: '配置',
  flag: '开关',
  mq: 'MQ',
  other: '其他',
}

export interface ReleaseSheetContext {
  requirement: RequirementRecord
  record: WorkbenchRecord
  revision: number
  /** ISO timestamp of generation; its date part lands in the stamp. */
  generatedAt: string
  /** Drifted item ids from the detail response projection (empty = none). */
  releaseDrifted: readonly string[]
}

/** go/no-go 判定（research §7.3 三条件，rolled-back 不入计数——终态已解决）。 */
export function releaseGoNoGo(ctx: ReleaseSheetContext): {
  go: boolean
  pending: number
  confirmed: number
  drift: number
  rollbackPlanConfirmed: boolean
} {
  const live = ctx.record.releaseItems.filter((item) => item.status !== 'rolled-back')
  return {
    go: live.every((item) => item.status !== 'pending')
      && ctx.releaseDrifted.length === 0
      && ctx.record.rollbackPlanConfirmedAt !== undefined,
    pending: live.filter((item) => item.status === 'pending').length,
    confirmed: live.filter((item) => item.status !== 'pending').length,
    drift: ctx.releaseDrifted.length,
    rollbackPlanConfirmed: ctx.record.rollbackPlanConfirmedAt !== undefined,
  }
}

function titleBlock(ctx: ReleaseSheetContext): string {
  const verdict = releaseGoNoGo(ctx)
  const rollback = verdict.rollbackPlanConfirmed
    ? `已确认（${(ctx.record.rollbackPlanConfirmedAt ?? '').slice(0, 10)}）`
    : '未确认'
  return [
    `上线单：${ctx.requirement.title}`,
    '',
    `[结论] ${verdict.go ? 'GO' : '前置条件未满足'} —— 待确认 ${verdict.pending} · 已确认 ${verdict.confirmed} · 漂移 ${verdict.drift} · 回滚预案 ${rollback}`,
  ].join('\n')
}

function itemBlock(item: ReleaseItem, drifted: boolean): string {
  const meta = [
    item.envs.length > 0 ? `env ${item.envs.join(',')}` : null,
    item.workPackageId !== undefined ? `来源 ${item.workPackageId}` : null,
    item.appliedAt !== undefined ? `执行 ${item.appliedAt.slice(0, 10)}` : null,
    item.note !== undefined && item.note.length > 0 ? `备注：${item.note}` : null,
    drifted ? '⚠ 内容与登记时不一致（哈希漂移）' : null,
  ].filter((part) => part !== null).join(' · ')
  const lines = [
    `- ${item.id}　${item.title} —— ${RELEASE_STATUS_LABEL[item.status]}（${item.status}）`,
  ]
  if (meta.length > 0) lines.push(`  ${meta}`)
  if (item.content.length > 0) {
    lines.push('', '  ```', ...item.content.split('\n').map((line) => `  ${line}`), '  ```')
  }
  return lines.join('\n')
}

function groupBlock(ctx: ReleaseSheetContext, type: ReleaseItem['type']): string {
  const items = ctx.record.releaseItems.filter((item) => item.type === type)
  if (items.length === 0) return '' // 空组不出现（诚实口径：零值同缺失不占位）
  const drifted = new Set(ctx.releaseDrifted)
  return [
    `## ${RELEASE_TYPE_LABEL[type]}（${items.length}）`,
    ...items.map((item) => itemBlock(item, drifted.has(item.id))),
  ].join('\n')
}

/**
 * Assemble the release-sheet markdown: title + go/no-go conclusion → five
 * fixed-order groups (empty ones omitted) → the revision stamp.
 */
export function buildReleaseSheet(ctx: ReleaseSheetContext): string {
  const blocks = [
    titleBlock(ctx),
    ...(Object.keys(RELEASE_TYPE_LABEL) as readonly ReleaseItem['type'][])
      .map((type) => groupBlock(ctx, type)),
  ].filter((block) => block.length > 0)
  const date = ctx.generatedAt.slice(0, 10)
  const stamp = `生成于 revision ${ctx.revision} · ${date} · 此后账本变更不自动同步`
  return [...blocks, stamp].join('\n\n')
}
