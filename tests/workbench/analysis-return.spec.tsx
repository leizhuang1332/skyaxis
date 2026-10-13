// @vitest-environment jsdom
/**
 * 回传轮 client matrix：S1 分析提议的自动收取与裁决面——
 *  - watcher 五态：running→idle 翻转触发 seedAnalysisQuiet（一次性）；
 *    blank 会话不触发（投递即空读防线）；sessions face 缺席 ⇒ 挂载兜底
 *    一次性；observed running=true 复位一次性旗（同会话续跑第二次机会）；
 *    锚已盖（seed.sessionId === 绑定会话）⇒ 不触发。
 *  - 投递接线：分析任务书投递成功 → onDelivered → bindAnalysisSession。
 *  - S1 两 section 提议子区：行渲染（类别·级别/来源前缀）、采纳/不采
 *    动作、标准提议锁定态（采纳禁用 + 专属提示，驳回照常）、waiting 态
 *    提示（无 seed 且无行）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import type { WorkbenchController } from '../../src/client/workbench/controller.js'
import type { RequirementWorkbenchState } from '../../src/client/workbench/store.js'
import type { WorkbenchSessionsFace } from '../../src/client/workbench/view.js'
import { WorkbenchTabBody } from '../../src/client/workbench/view.js'
import { CriteriaSection } from '../../src/client/workbench/criteria-section.js'
import { FindingsSection } from '../../src/client/workbench/findings-section.js'

const RID = '11111111-1111-4111-1111-111111111111'
const AT = '2026-09-29T08:00:00.000Z'
const SEED_HASH = 'c'.repeat(64)

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

const requirement: RequirementRecord = {
  id: RID,
  title: '导出功能改造',
  description: '支持大数据量异步导出',
  workspacePath: '/ws',
  linkedRepos: [],
  createdAt: AT,
  updatedAt: AT,
}

function analysisContainer(overrides: Partial<NonNullable<WorkbenchRecord['analysis']>> = {}): NonNullable<WorkbenchRecord['analysis']> {
  return {
    session: { sessionId: 'sess-a', boundAt: AT },
    findings: [
      { id: '77777777-7777-4777-8777-777777777777', category: 'conflict', severity: 'high', title: '与现有同步导出争用连接池', detail: '证据：PRD#3.2' },
    ],
    criteria: [
      { id: '88888888-8888-4888-8888-888888888888', text: '十万行导出 30 秒内完成', sourceSection: 'PRD#3.2' },
    ],
    ...overrides,
  }
}

function workbenchRecord(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: RID,
    stage: 'understand',
    stageHistory: [{ stage: 'understand', at: AT }],
    criteria: [],
    findings: [],
    workPackages: [],
    releaseItems: [],
    reviewReports: [],
    knowledgeCandidates: [],
    ...overrides,
  }
}

function slot(overrides: Partial<RequirementWorkbenchState> = {}): RequirementWorkbenchState {
  return {
    phase: 'ready',
    revision: 3,
    record: null,
    planFileExists: [],
    reviewFileExists: [],
    releaseDrifted: [],
    busy: false,
    ...overrides,
  }
}

/** Mutable fake sessions face — set() mutates the closure snapshot and notifies. */
function fakeFace(initial: { running: boolean; blank: boolean } | 'absent') {
  const listeners = new Set<() => void>()
  let summary = initial === 'absent' ? undefined : { id: 'sess-a', displayTitle: '分析会话', ...initial }
  let byId: Record<string, { id: string; displayTitle: string; running: boolean; blank: boolean }> = summary === undefined ? {} : { 'sess-a': summary }
  const face: WorkbenchSessionsFace = {
    get ids() { return Object.keys(byId) },
    get summariesById() { return byId },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    navigate: () => { /* noop */ },
  }
  return {
    face,
    set(next: { running: boolean; blank: boolean } | 'gone'): void {
      summary = next === 'gone' ? undefined : { id: 'sess-a', displayTitle: '分析会话', ...next }
      byId = summary === undefined ? {} : { 'sess-a': summary }
      for (const listener of [...listeners]) listener()
    },
    /** 四次诊断 fixtures: install a titled "real" session alongside the shell. */
    addTitled(id: string, displayTitle: string): void {
      byId = { ...byId, [id]: { id, displayTitle, running: false, blank: false } }
      for (const listener of [...listeners]) listener()
    },
  }
}

function fakeController(): WorkbenchController & {
  seedAnalysisQuiet: ReturnType<typeof vi.fn>
  bindAnalysisSession: ReturnType<typeof vi.fn>
  adoptFindingProposal: ReturnType<typeof vi.fn>
  dismissFindingProposal: ReturnType<typeof vi.fn>
  adoptCriterionProposal: ReturnType<typeof vi.fn>
  dismissCriterionProposal: ReturnType<typeof vi.fn>
} {
  return {
    open: vi.fn(async () => undefined),
    openKnowledge: vi.fn(async () => undefined),
    advanceStage: vi.fn(async () => true),
    saveFinding: vi.fn(async () => true),
    removeFinding: vi.fn(async () => true),
    saveCriterion: vi.fn(async () => true),
    dismissBanner: vi.fn(),
    seedAnalysisQuiet: vi.fn(async () => undefined),
    bindAnalysisSession: vi.fn(async () => true),
    adoptFindingProposal: vi.fn(async () => true),
    dismissFindingProposal: vi.fn(async () => true),
    adoptCriterionProposal: vi.fn(async () => true),
    dismissCriterionProposal: vi.fn(async () => true),
    dispose: vi.fn(),
  } as never
}

afterEach(() => {
  cleanup()
})

const renderBody = (props: { slot: RequirementWorkbenchState; controller: WorkbenchController; sessions?: WorkbenchSessionsFace; deliver?: unknown }) =>
  render(
    <WorkbenchTabBody
      t={bindZh()}
      requirement={requirement}
      slot={props.slot}
      controller={props.controller}
      knowledge={{ phase: 'ready', revision: 1, records: [] }}
      {...(props.sessions !== undefined ? { sessions: props.sessions } : {})}
      {...(props.deliver !== undefined ? { deliver: props.deliver as never } : {})}
    />,
  )

describe('回传轮 watcher（sessions face 五态）', () => {
  it('running→idle 翻转触发一次性 seedAnalysisQuiet；锚未变不再触发', async () => {
    const sessions = fakeFace({ running: true, blank: false })
    const controller = fakeController()
    renderBody({ slot: slot({ record: workbenchRecord({ analysis: analysisContainer() }) }), controller, sessions: sessions.face })

    expect(controller.seedAnalysisQuiet).not.toHaveBeenCalled()
    act(() => { sessions.set({ running: false, blank: false }) })
    await waitFor(() => expect(controller.seedAnalysisQuiet).toHaveBeenCalledTimes(1))
    expect(controller.seedAnalysisQuiet).toHaveBeenCalledWith(RID, 'sess-a')
    // The attempted flag: no second call on further unrelated flips (fixture
    // record is unchanged — the fake controller never patches the slot).
    act(() => { sessions.set({ running: false, blank: false }) })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(controller.seedAnalysisQuiet).toHaveBeenCalledTimes(1)
  })

  it('blank 会话不触发（投递即空读防线）；发送后 running=true，收尾 idle 时再触发', async () => {
    const sessions = fakeFace({ running: false, blank: true })
    const controller = fakeController()
    renderBody({ slot: slot({ record: workbenchRecord({ analysis: analysisContainer() }) }), controller, sessions: sessions.face })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(controller.seedAnalysisQuiet).not.toHaveBeenCalled()

    act(() => { sessions.set({ running: true, blank: false }) })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(controller.seedAnalysisQuiet).not.toHaveBeenCalled()
    act(() => { sessions.set({ running: false, blank: false }) })
    await waitFor(() => expect(controller.seedAnalysisQuiet).toHaveBeenCalledTimes(1))
  })

  it('sessions face 缺席 ⇒ 挂载兜底一次性收取（jsdom / 无会话列表的组合）', async () => {
    const controller = fakeController()
    renderBody({ slot: slot({ record: workbenchRecord({ analysis: analysisContainer() }) }), controller })
    await waitFor(() => expect(controller.seedAnalysisQuiet).toHaveBeenCalledTimes(1))
  })

  it('waiting 态「重新收取」复位一次性旗：一次失败后可手动再触发（诊断②的死端出口）', async () => {
    const controller = fakeController()
    renderBody({ slot: slot({ record: workbenchRecord({ analysis: analysisContainer({ findings: [], criteria: [] }) }) }), controller })
    await waitFor(() => expect(controller.seedAnalysisQuiet).toHaveBeenCalledTimes(1)) // mount catch-up consumed the flag
    const retry = screen.getAllByRole('button', { name: workbenchZh['proposal.retry'] })
    expect(retry.length).toBeGreaterThan(0)
    fireEvent.click(retry[0]!)
    await waitFor(() => expect(controller.seedAnalysisQuiet).toHaveBeenCalledTimes(2))
  })

  it('四次诊断存量兜底：无锚绑定的壳 miss → 按任务书标题前缀改绑真会话（一次跳变，不循环）', async () => {
    const sessions = fakeFace({ running: false, blank: false })
    sessions.addTitled('session-real', '# skyaxis 分析任务书 · 导出功能改')
    const controller = fakeController()
    // Anchor-LESS container (a pre-repair delivery) whose seed misses with shell=true.
    controller.seedAnalysisQuiet.mockImplementation(async () => ({ miss: 'no-declare-block' as const, scan: 'events=4 [permission/preset:1]', shell: true }))
    renderBody({ slot: slot({ record: workbenchRecord({ analysis: analysisContainer({ findings: [], criteria: [] }) }) }), controller, sessions: sessions.face })
    await waitFor(() => expect(controller.bindAnalysisSession).toHaveBeenCalledWith(RID, 'session-real'))
    // The pointer swap lands in the (fake) record on the next render cycle —
    // no further binds fire for the same candidate (one-hop termination).
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(controller.bindAnalysisSession).toHaveBeenCalledTimes(1)
  })

  it('锚已盖（seed 指向绑定会话）⇒ 挂载与翻转都不触发', async () => {
    const sessions = fakeFace({ running: false, blank: false })
    const controller = fakeController()
    renderBody({
      slot: slot({ record: workbenchRecord({ analysis: analysisContainer({ seed: { sessionId: 'sess-a', contentHash: SEED_HASH, seededAt: AT, findings: 1, criteria: 1 } }) }) }),
      controller,
      sessions: sessions.face,
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(controller.seedAnalysisQuiet).not.toHaveBeenCalled()
    act(() => { sessions.set({ running: true, blank: false }) })
    act(() => { sessions.set({ running: false, blank: false }) })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(controller.seedAnalysisQuiet).not.toHaveBeenCalled()
  })

  it('一次性失败后 running=true 复位旗：同会话续跑收尾获得第二次机会', async () => {
    const sessions = fakeFace({ running: false, blank: false })
    const controller = fakeController()
    renderBody({ slot: slot({ record: workbenchRecord({ analysis: analysisContainer() }) }), controller, sessions: sessions.face })

    await waitFor(() => expect(controller.seedAnalysisQuiet).toHaveBeenCalledTimes(1)) // mount catch-up fired (record unchanged by the fake)
    act(() => { sessions.set({ running: true, blank: false }) })
    act(() => { sessions.set({ running: false, blank: false }) })
    await waitFor(() => expect(controller.seedAnalysisQuiet).toHaveBeenCalledTimes(2))
  })
})

describe('回传轮投递接线', () => {
  it('分析任务书投递成功 → onDelivered → bindAnalysisSession(RID, sessionId)，窗关闭', async () => {
    const sessions = fakeFace({ running: true, blank: false })
    const controller = fakeController()
    const deliver = vi.fn(async () => ({ ok: true as const, sessionId: 'sess-new' }))
    renderBody({ slot: slot({ record: workbenchRecord({ analysis: analysisContainer() }) }), controller, sessions: sessions.face, deliver })

    fireEvent.click(screen.getByRole('button', { name: workbenchZh['sow.analysisButton'] }))
    const dialog = await screen.findByRole('dialog', { name: workbenchZh['sow.title'] })
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['sow.deliver'] }))
    await waitFor(() => expect(controller.bindAnalysisSession).toHaveBeenCalledTimes(1))
    const bindArgs = controller.bindAnalysisSession.mock.calls[0]!
    // 四次诊断: the bind carries the task-book ANCHOR (SOW head ≤200 chars) —
    // the content address for the shell repair.
    expect(bindArgs[0]).toBe(RID)
    expect(bindArgs[1]).toBe('sess-new')
    expect(typeof bindArgs[2]).toBe('string')
    expect((bindArgs[2] as string).length).toBeGreaterThan(0)
    expect((bindArgs[2] as string).length).toBeLessThanOrEqual(200)
    expect(bindArgs[2]).toContain('skyaxis 分析任务书')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: workbenchZh['sow.title'] })).toBeNull())
  })
})

describe('回传轮 S1 提议子区', () => {
  it('FindingsSection：待裁决行（类别·级别 + 来源前缀 + detail 次行）、采纳/不采动作、waiting 态提示', async () => {
    const controller = fakeController()
    render(
      <FindingsSection t={bindZh()} slot={slot({ record: workbenchRecord({
        findings: [{ id: 'f-0', category: 'risk', severity: 'low', title: '正式发现', detail: '', status: 'open', createdAt: AT }],
        analysis: analysisContainer({ seed: { sessionId: 'sess-a', contentHash: SEED_HASH, seededAt: AT, findings: 1, criteria: 1 } }),
      }) }) } controller={controller} requirementId={RID} />,
    )

    const title = await screen.findByText(/与现有同步导出争用连接池/)
    const row = title.closest('div[class^="_proposalRow_"]')!
    expect(within(row as HTMLElement).getByText('[冲突·高] 与现有同步导出争用连接池')).toBeTruthy()
    expect(within(row as HTMLElement).getByText('证据：PRD#3.2')).toBeTruthy()
    expect(within(row as HTMLElement).getByText('来源会话 sess-a…')).toBeTruthy()
    expect(screen.getByText('待裁决发现提议（分析会话）')).toBeTruthy()
    expect(screen.queryByText('proposal.waitingHint 的兜底行不该出现')).toBeNull()

    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: workbenchZh['proposal.adopt'] }))
    expect(controller.adoptFindingProposal).toHaveBeenCalledWith(RID, '77777777-7777-4777-8777-777777777777')
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: workbenchZh['proposal.dismiss'] }))
    expect(controller.dismissFindingProposal).toHaveBeenCalledWith(RID, '77777777-7777-4777-8777-777777777777')

    // Waiting face: bound but never seeded, no rows yet.
    cleanup()
    render(<FindingsSection t={bindZh()} slot={slot({ record: workbenchRecord({ analysis: analysisContainer({ findings: [], criteria: [] }) }) }) } controller={fakeController()} requirementId={RID} />)
    expect(screen.getByText(workbenchZh['proposal.waitingHint'])).toBeTruthy()

    // 回传轮 observability: the last zero-write reason discloses under the hint.
    cleanup()
    render(<FindingsSection t={bindZh()} slot={slot({ record: workbenchRecord({ analysis: analysisContainer({ findings: [], criteria: [] }) }) }) } controller={fakeController()} requirementId={RID} seedMiss="no-declare-block" />)
    expect(screen.getByText(workbenchZh['declare.fetchNoBlock'])).toBeTruthy()
  })

  it('CriteriaSection：提议行与采纳/不采；锁定态采纳禁用 + 专属提示，驳回照常；正式行不受影响', async () => {
    const controller = fakeController()
    render(
      <CriteriaSection t={bindZh()} slot={slot({ record: workbenchRecord({
        splitApprovedAt: AT,
        criteria: [{ id: 'C1', text: '既有标准', coveredBy: [] }],
        analysis: analysisContainer({ seed: { sessionId: 'sess-a', contentHash: SEED_HASH, seededAt: AT, findings: 1, criteria: 1 } }),
      }) }) } controller={controller} requirementId={RID} />,
    )

    const row = (await screen.findByText(/十万行导出 30 秒内完成/)).closest('div[class^="_proposalRow_"]') as HTMLElement
    expect(screen.getByText('待裁决标准提议（分析会话）')).toBeTruthy()
    expect(screen.getByText(workbenchZh['proposal.lockedHint'])).toBeTruthy()
    const adopt = within(row).getByRole('button', { name: workbenchZh['proposal.adopt'] }) as HTMLButtonElement
    expect(adopt.disabled).toBe(true)
    fireEvent.click(within(row).getByRole('button', { name: workbenchZh['proposal.dismiss'] }))
    expect(controller.dismissCriterionProposal).toHaveBeenCalledWith(RID, '88888888-8888-4888-8888-888888888888')
    expect(controller.adoptCriterionProposal).not.toHaveBeenCalled()

    // Unlocked: adopt enabled and wired.
    cleanup()
    render(
      <CriteriaSection t={bindZh()} slot={slot({ record: workbenchRecord({
        analysis: analysisContainer({ seed: { sessionId: 'sess-a', contentHash: SEED_HASH, seededAt: AT, findings: 1, criteria: 1 } }),
      }) }) } controller={controller} requirementId={RID} />,
    )
    const row2 = (await screen.findByText(/十万行导出 30 秒内完成/)).closest('div[class^="_proposalRow_"]') as HTMLElement
    const adopt2 = within(row2).getByRole('button', { name: workbenchZh['proposal.adopt'] }) as HTMLButtonElement
    expect(adopt2.disabled).toBe(false)
    fireEvent.click(adopt2)
    expect(controller.adoptCriterionProposal).toHaveBeenCalledWith(RID, '88888888-8888-4888-8888-888888888888')
  })
})
