/**
 * splitStaleReasons (P5b + 0007 两新臂) — pure-function matrix. The two P5b
 * arms (prd / findings) were previously untested directly (the component spec
 * never imported the helper); 0007 adds 'understand' (the finalize stamp
 * moved since approval — re-finalized or revoked) and 'clarifications' (the
 * answered count moved). Pre-0007 baselines carry neither field: absent
 * reads as absent/0 and NEVER false-alarms.
 */
import { describe, expect, it } from 'vitest'
import type { PrdDocSummary } from '../../src/requirements-shared/protocol.js'
import type { WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import { splitStaleReasons } from '../../src/client/workbench/split-stale.js'

const AT = '2026-10-14T08:00:00.000Z'
const PRD: readonly PrdDocSummary[] = [{ name: 'prd.md', size: 128, modifiedAt: 1700000000000 }]

function record(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: '11111111-1111-4111-8111-111111111111',
    stage: 'plan',
    stageHistory: [{ stage: 'plan', at: AT }],
    criteria: [],
    findings: [],
    workPackages: [],
    releaseItems: [],
    reviewReports: [],
    knowledgeCandidates: [],
    ...overrides,
  }
}

const approved = (baselineOverrides: Record<string, unknown> = {}, recordOverrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord =>
  record({
    splitApprovedAt: AT,
    splitBaseline: { at: AT, prd: [{ name: 'prd.md', size: 128, modifiedAt: 1700000000000 }], disposedFindings: 0, ...baselineOverrides },
    ...recordOverrides,
  })

describe('splitStaleReasons — P5b 既有两臂', () => {
  it('无基线 → []（诚实缺席）；一切未变 → []；PRD 变化（null = 加载中不比对）', () => {
    expect(splitStaleReasons(record(), PRD)).toEqual([])
    expect(splitStaleReasons(approved(), PRD)).toEqual([])
    expect(splitStaleReasons(approved(), [{ name: 'prd.md', size: 999, modifiedAt: 1700000000000 }])).toEqual(['prd'])
    // PRD 列表加载中（null）——PRD 臂静默，绝不无据报警。
    expect(splitStaleReasons(approved(), null)).toEqual([])
  })

  it('处置发现增长 → findings 臂', () => {
    const base = approved({ disposedFindings: 0 }, {
      findings: [
        { id: 'f1', category: 'risk', severity: 'low', title: 't', detail: 'd', status: 'resolved', createdAt: AT },
      ],
    })
    expect(splitStaleReasons(base, PRD)).toEqual(['findings'])
  })
})

describe('splitStaleReasons — 0007 两新臂', () => {
  it('understand 臂：批准后重新定稿触发；撤销定稿（record 侧 undefined ≠ 基线字符串）触发；两侧同 undefined 不触发', () => {
    const reFinalized = approved({ understandApprovedAt: '2026-10-10T00:00:00.000Z' }, { understandApprovedAt: '2026-10-13T00:00:00.000Z' })
    expect(splitStaleReasons(reFinalized, PRD)).toEqual(['understand'])
    const revoked = approved({ understandApprovedAt: '2026-10-10T00:00:00.000Z' })
    expect(splitStaleReasons(revoked, PRD)).toEqual(['understand'])
    // 批准时与现在都未定稿（undefined === undefined）——安静。
    expect(splitStaleReasons(approved(), PRD)).toEqual([])
    // 批准时已定稿且未动——安静。
    const stable = approved({ understandApprovedAt: '2026-10-10T00:00:00.000Z' }, { understandApprovedAt: '2026-10-10T00:00:00.000Z' })
    expect(splitStaleReasons(stable, PRD)).toEqual([])
  })

  it('understand 臂边界：批准后首次定稿也触发（拆分契约所基于的理解态变了）', () => {
    const finalizedAfter = approved({}, { understandApprovedAt: '2026-10-13T00:00:00.000Z' })
    expect(splitStaleReasons(finalizedAfter, PRD)).toEqual(['understand'])
  })

  it('clarifications 臂：已答计数增长/回落触发；旧基线无字段（pre-0007）按 0 比对不误报；dismiss 不改计数', () => {
    const answered = (n: number): NonNullable<WorkbenchRecord['analysis']> => ({
      session: { sessionId: 'sess-a', boundAt: AT },
      findings: [],
      criteria: [],
      clarifications: Array.from({ length: n }, (_, i) => ({ id: `q${i}`, question: `Q${i}`, answer: `A${i}`, answeredAt: AT })),
    })
    // 增长触发。
    expect(splitStaleReasons(approved({ answeredClarifications: 0 }, { analysis: answered(1) }), PRD)).toEqual(['clarifications'])
    // 回落触发（答案被 dismiss 掉一行 ⇒ 计数降——仍是契约面变化）。
    expect(splitStaleReasons(approved({ answeredClarifications: 2 }, { analysis: answered(1) }), PRD)).toEqual(['clarifications'])
    // 持平安静。
    expect(splitStaleReasons(approved({ answeredClarifications: 1 }, { analysis: answered(1) }), PRD)).toEqual([])
    // pre-0007 基线（无字段）且当前零已答——按 0 === 0 安静。
    expect(splitStaleReasons(approved(), PRD)).toEqual([])
    // pre-0007 基线 + 批准后答了问题——absent ⇒ 0 ≠ 1 触发（真实变化，非误报）。
    expect(splitStaleReasons(approved({}, { analysis: answered(1) }), PRD)).toEqual(['clarifications'])
    // 未答行不计入计数（answer undefined）。
    const withUnanswered: NonNullable<WorkbenchRecord['analysis']> = {
      session: { sessionId: 'sess-a', boundAt: AT },
      findings: [],
      criteria: [],
      clarifications: [{ id: 'q9', question: '未答' }],
    }
    expect(splitStaleReasons(approved({}, { analysis: withUnanswered }), PRD)).toEqual([])
  })

  it('多臂并存按序合并', () => {
    const multi = approved({ understandApprovedAt: '2026-10-10T00:00:00.000Z', disposedFindings: 0 }, {
      understandApprovedAt: '2026-10-13T00:00:00.000Z',
      findings: [{ id: 'f1', category: 'risk', severity: 'low', title: 't', detail: 'd', status: 'wont-fix', createdAt: AT }],
    })
    expect(splitStaleReasons(multi, PRD)).toEqual(['findings', 'understand'])
  })
})
