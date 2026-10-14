/**
 * Understanding-sheet (需求理解摘要) assembly — the release-sheet.test.ts
 * matrix shape: toContain positives + negative absence assertions, no
 * snapshots. Pins the 0007 rulings: disposition-grouped findings (empty
 * groups omitted), ANSWERED clarifications as settled facts, UNANSWERED
 * clarifications listed (they ARE the review-meeting material — the mockup's
 * 评审会问题单 finally landing), finalize status in the header, the
 * revision + 真源/分发 stamp.
 */
import { describe, expect, it } from 'vitest'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import { buildUnderstandingSheet } from '../../src/client/workbench/understanding-sheet.js'

const RID = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-10-14T09:30:00.000Z'

const requirement: RequirementRecord = {
  id: RID,
  title: '报价管理：导入导出与数据校验',
  description: '…',
  workspacePath: '/ws',
  linkedRepos: [],
  createdAt: NOW,
  updatedAt: NOW,
}

function record(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: RID,
    stage: 'understand',
    stageHistory: [{ stage: 'understand', at: NOW }],
    criteria: [],
    findings: [],
    workPackages: [],
    releaseItems: [],
    reviewReports: [],
    knowledgeCandidates: [],
    ...overrides,
  }
}

const ctx = (rec: WorkbenchRecord) => ({ requirement, record: rec, revision: 7, generatedAt: '2026-10-14T12:00:00.000Z' })

describe('buildUnderstandingSheet', () => {
  it('header + finalize status line + stamp（未定稿形态）', () => {
    const sheet = buildUnderstandingSheet(ctx(record()))
    expect(sheet).toContain('需求理解摘要：报价管理：导入导出与数据校验')
    expect(sheet).toContain('[定稿状态] 未定稿')
    expect(sheet.endsWith('生成于 revision 7 · 2026-10-14 · 此后账本变更不自动同步 · 账本为真源，导出为分发')).toBe(true)
  })

  it('已定稿形态：状态行带日期；快照不作内容源（摘要取活账本）', () => {
    const sheet = buildUnderstandingSheet(ctx(record({
      understandApprovedAt: '2026-10-13T08:00:00.000Z',
      understandBaseline: { at: '2026-10-13T08:00:00.000Z', criteria: [{ id: 'C1', text: '快照里的旧文本' }], findings: [], clarifications: [] },
      criteria: [{ id: 'C1', text: '定稿后改过的标准文本', coveredBy: [] }],
    })))
    expect(sheet).toContain('[定稿状态] 已定稿（2026-10-13）')
    expect(sheet).toContain('定稿后改过的标准文本')
    expect(sheet).not.toContain('快照里的旧文本')
  })

  it('发现按处置态三组：未处置/已解决带方案/不处理；空组不渲染；组内带类别·级别', () => {
    const sheet = buildUnderstandingSheet(ctx(record({
      findings: [
        { id: 'f1', category: 'conflict', severity: 'high', title: '源码冲突', detail: '…', status: 'open', createdAt: NOW },
        { id: 'f2', category: 'risk', severity: 'low', title: '慢查询', detail: '…', status: 'resolved', resolution: '走异步导出', createdAt: NOW },
      ],
    })))
    expect(sheet).toContain('## 分析发现（2）')
    expect(sheet).toContain('### 未处置（1）')
    expect(sheet).toContain('- [冲突·高]　源码冲突')
    expect(sheet).toContain('### 已解决（1）')
    expect(sheet).toContain('- [风险·低]　慢查询 —— 方案：走异步导出')
    expect(sheet).not.toContain('不处理') // 空组不出现
  })

  it('待澄清：已答=已定事实（Q→A）；未答=评审会待问（带推荐答案与阻塞标注）', () => {
    const sheet = buildUnderstandingSheet(ctx(record({
      analysis: {
        session: { sessionId: 'sess-a', boundAt: NOW },
        findings: [],
        criteria: [],
        clarifications: [
          { id: 'q1', question: '批量上限？', answer: '百万行', answeredAt: NOW },
          { id: 'q2', question: '是否审计？', recommendation: '审计', blocks: 'F2' },
        ],
      },
    })))
    expect(sheet).toContain('### 已答（1）——视为已定事实')
    expect(sheet).toContain('- 问：批量上限？\n  答：百万行')
    expect(sheet).toContain('### 未答（1）——评审会待问')
    expect(sheet).toContain('- 问：是否审计？（推荐答案：审计）〔阻塞 F2〕')
  })

  it('全零记录：仅头与戳，无空节占位', () => {
    const sheet = buildUnderstandingSheet(ctx(record()))
    expect(sheet).not.toContain('## 验收标准')
    expect(sheet).not.toContain('## 分析发现')
    expect(sheet).not.toContain('## 待澄清')
  })
})
