/**
 * 上线单纯函数（0006 P3a）：releaseGoNoGo 三条件判定（rolled-back 不入
 * 计数）+ buildReleaseSheet 五分组矩阵（空组不出现 / 中文标签 + raw 值双写 /
 * 漂移行内披露 / 备注 env 来源执行日期 meta 行 / revision 戳收尾）。
 * 断言风格照 sow.test.ts：toContain 多行字面量 + 负向断言同权重，无快照。
 */
import { describe, expect, it } from 'vitest'
import type { ReleaseItem, WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import { buildReleaseSheet, releaseGoNoGo } from '../../src/client/workbench/release-sheet.js'

const RID = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-09-29T08:00:00.000Z'

const requirement: RequirementRecord = {
  id: RID,
  title: '导出功能改造',
  description: '支持大数据量异步导出',
  workspacePath: '',
  linkedRepos: [],
  createdAt: NOW,
  updatedAt: NOW,
}

function item(overrides: Partial<ReleaseItem> = {}): ReleaseItem {
  return {
    id: 'R0001',
    type: 'sql',
    title: 't_order 加索引',
    content: 'ALTER TABLE t_order ADD INDEX idx_created_at (created_at)',
    contentHash: 'a'.repeat(64),
    envs: ['prod'],
    status: 'confirmed',
    ...overrides,
  }
}

function record(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: RID,
    stage: 'deliver',
    stageHistory: [{ stage: 'deliver', at: NOW }],
    criteria: [],
    findings: [],
    workPackages: [],
    releaseItems: [],
    reviewReports: [],
    knowledgeCandidates: [],
    ...overrides,
  }
}

const baseCtx = {
  requirement,
  record: record(),
  revision: 7,
  generatedAt: '2026-09-29T12:34:56.789Z',
  releaseDrifted: [] as readonly string[],
} as const

describe('releaseGoNoGo', () => {
  it('三条件：全 confirmed 以上 + 无漂移 + 回滚预案已确认 → GO', () => {
    const ctx = { ...baseCtx, record: record({ releaseItems: [item(), item({ id: 'R0002', status: 'verified' })], rollbackPlanConfirmedAt: NOW }) }
    const verdict = releaseGoNoGo(ctx)
    expect(verdict.go).toBe(true)
    expect(verdict.pending).toBe(0)
    expect(verdict.confirmed).toBe(2)
    expect(verdict.drift).toBe(0)
    expect(verdict.rollbackPlanConfirmed).toBe(true)
  })

  it('任一条件不满足 → no-go：pending 在场 / 漂移在场 / 预案未确认', () => {
    const pendingCase = { ...baseCtx, record: record({ releaseItems: [item({ status: 'pending' })], rollbackPlanConfirmedAt: NOW }) }
    expect(releaseGoNoGo(pendingCase).go).toBe(false)
    const driftCase = { ...baseCtx, record: record({ releaseItems: [item()], rollbackPlanConfirmedAt: NOW }), releaseDrifted: ['R0001'] }
    expect(releaseGoNoGo(driftCase).go).toBe(false)
    const noPlanCase = { ...baseCtx, record: record({ releaseItems: [item()] }) }
    expect(releaseGoNoGo(noPlanCase).go).toBe(false)
  })

  it('rolled-back 不入任何计数（终态已解决，不算待确认也不算已确认）', () => {
    const ctx = { ...baseCtx, record: record({ releaseItems: [item(), item({ id: 'R0002', status: 'rolled-back' })], rollbackPlanConfirmedAt: NOW }) }
    const verdict = releaseGoNoGo(ctx)
    expect(verdict.go).toBe(true)
    expect(verdict.pending).toBe(0)
    expect(verdict.confirmed).toBe(1)
  })
})

describe('buildReleaseSheet', () => {
  it('标题 + 结论行（GO / 前置条件未满足 两态）+ 戳收尾', () => {
    const go = buildReleaseSheet({ ...baseCtx, record: record({ releaseItems: [item()], rollbackPlanConfirmedAt: '2026-09-26T01:00:00.000Z' }) })
    expect(go).toContain('上线单：导出功能改造')
    expect(go).toContain('[结论] GO —— 待确认 0 · 已确认 1 · 漂移 0 · 回滚预案 已确认（2026-09-26）')
    expect(go.endsWith('生成于 revision 7 · 2026-09-29 · 此后账本变更不自动同步')).toBe(true)

    const noGo = buildReleaseSheet(baseCtx)
    expect(noGo).toContain('[结论] 前置条件未满足 —— 待确认 0 · 已确认 0 · 漂移 0 · 回滚预案 未确认')
  })

  it('五分组固定序 + 空组不出现（诚实口径：零值同缺失不占位）', () => {
    const sheet = buildReleaseSheet({ ...baseCtx, record: record({ releaseItems: [
      item({ type: 'mq', title: '队列扩容', content: 'concurrency=8' }),
      item({ type: 'sql' }),
    ] }) })
    const sqlAt = sheet.indexOf('## SQL（1）')
    const mqAt = sheet.indexOf('## MQ（1）')
    expect(sqlAt).toBeGreaterThanOrEqual(0)
    expect(mqAt).toBeGreaterThanOrEqual(0)
    expect(sqlAt).toBeLessThan(mqAt) // 固定组序：SQL 在 MQ 前
    expect(sheet).not.toContain('配置（')
    expect(sheet).not.toContain('开关（')
    expect(sheet).not.toContain('其他（')
  })

  it('行形态：id + 全角空格 + 标题 + 中文状态（raw 值）；meta 行 env/来源/执行/备注', () => {
    const sheet = buildReleaseSheet({ ...baseCtx, record: record({ releaseItems: [
      item({ status: 'applied', appliedAt: '2026-09-27T10:00:00.000Z', workPackageId: 'WP2', note: '随 v1.2 上线' }),
    ] }) })
    expect(sheet).toContain('- R0001　t_order 加索引 —— 已执行（applied）')
    expect(sheet).toContain('env prod · 来源 WP2 · 执行 2026-09-27 · 备注：随 v1.2 上线')
  })

  it('内容进 fenced 块（多行 SQL 逐行缩进）；空内容不出块、空 env 无 meta 行', () => {
    const sheet = buildReleaseSheet({ ...baseCtx, record: record({ releaseItems: [
      item({ content: 'ALTER TABLE a\nADD COLUMN b INT;\n-- tail comment' }),
      item({ id: 'R0002', type: 'flag', title: '开关', content: '', envs: [] }),
    ] }) })
    expect(sheet).toContain('  ```\n  ALTER TABLE a\n  ADD COLUMN b INT;\n  -- tail comment\n  ```')
    expect(sheet).toContain('- R0002　开关 —— 已确认（confirmed）\n\n生成于')
    expect(sheet).not.toContain('- R0002　开关 —— 已确认（confirmed）\n  ')
  })

  it('漂移行内披露（⚠ + 哈希漂移字样），不阻断导出', () => {
    const sheet = buildReleaseSheet({ ...baseCtx, record: record({ releaseItems: [item()] }), releaseDrifted: ['R0001'] })
    expect(sheet).toContain('⚠ 内容与登记时不一致（哈希漂移）')
    expect(sheet).toContain('[结论] 前置条件未满足 —— 待确认 0 · 已确认 1 · 漂移 1')
  })

  it('rolled-back 条目照常上单（状态披露），但不影响已确认计数', () => {
    const sheet = buildReleaseSheet({ ...baseCtx, record: record({ releaseItems: [
      item(),
      item({ id: 'R0002', type: 'sql', title: '废弃方案', status: 'rolled-back' }),
    ], rollbackPlanConfirmedAt: NOW }) })
    expect(sheet).toContain('- R0002　废弃方案 —— 已回滚（rolled-back）')
    expect(sheet).toContain('[结论] GO —— 待确认 0 · 已确认 1')
  })
})
