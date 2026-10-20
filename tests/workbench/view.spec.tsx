// @vitest-environment jsdom
/**
 * AI 工作台 seat（0006 P1b，自 requirements/ai-workbench-tab.spec 迁入并随
 * 真实数据源改写）：六阶段导轨顺序与双态默认起点（无记录 ① / 有记录跟随
 * record.stage）、点击切换观看，以及诚实口径守卫的**双向**钉子——
 * 无记录 ⇒ 无徽章无推进、空态引导；有记录 ⇒ 徽章计数来自真实数据（零值
 * 仍不渲染）、推进按钮随非 closed 记录出现且点击真正落盘（fake controller
 * 断言调用）。P1a 单向「什么都不渲染」的守卫已随数据面落地完成其历史使命。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { WorkbenchFinding, WorkbenchRecord, WorkbenchWorkPackage } from '../../src/workbench-shared/protocol.js'
import { WORKBENCH_STAGES } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import type { WorkbenchController } from '../../src/client/workbench/controller.js'
import type { RequirementWorkbenchState, WorkbenchStore } from '../../src/client/workbench/store.js'
import { createWorkbenchStore } from '../../src/client/workbench/store.js'
import { createWorkbenchTabSeat, WorkbenchTabBody } from '../../src/client/workbench/view.js'

const RID = '11111111-1111-4111-8111-111111111111'

function knowledgeState(): { phase: 'ready'; revision: number; records: never[] } {
  return { phase: 'ready', revision: 1, records: [] }
}

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

const requirement: RequirementRecord = {
  id: RID,
  title: '报价管理：导入导出与数据校验',
  description: '既有说明',
  workspacePath: '/ws',
  linkedRepos: [],
  createdAt: '2026-09-25T09:30:00.000Z',
  updatedAt: '2026-09-25T09:30:00.000Z',
}

const AT = '2026-09-29T08:00:00.000Z'

function finding(id: string, status: WorkbenchFinding['status']): WorkbenchFinding {
  return { id, category: 'risk', severity: 'medium', title: `发现-${id}`, detail: '…', status, createdAt: AT }
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
    reviewFileExists: [], releaseDrifted: [],
    busy: false,
    ...overrides,
  }
}

function fakeController(): WorkbenchController & { advanceStage: ReturnType<typeof vi.fn>; saveFinding: ReturnType<typeof vi.fn>; approveUnderstand: ReturnType<typeof vi.fn>; revokeUnderstand: ReturnType<typeof vi.fn> } {
  return {
    open: vi.fn(async () => undefined),
    openKnowledge: vi.fn(async () => undefined),
    advanceStage: vi.fn(async () => true),
    saveFinding: vi.fn(async () => true),
    removeFinding: vi.fn(async () => true),
    // 0007 定稿软门: the S1 finalize/revoke actions (asserted on click).
    approveUnderstand: vi.fn(async () => true),
    revokeUnderstand: vi.fn(async () => true),
    // 回传轮 watcher face: records WITH an analysis container make the seed
    // watcher fire on mount — these must exist (undefined outcome = quiet miss).
    seedAnalysisQuiet: vi.fn(async () => undefined),
    bindAnalysisSession: vi.fn(async () => true),
    // 文件交付轮: the S1 report panel fetches on mount — undefined = network
    // failure face, the panel's honest error hint (these tests assert the rail).
    analysisReportContent: vi.fn(async () => undefined),
    // 0008: the S1 baseline-doc panel mounts the same way; the ack modal
    // probes it on open (undefined = no-doc disclosure).
    requirementDocContent: vi.fn(async () => undefined),
    // 0012: the S2 planning doc card mounts the same way (advance into 'plan'
    // mounts the view-level plan zone + docs pair — 布局轮 dissolved
    // PlanningSection); the split watcher needs its quiet seed face
    // (undefined = quiet miss — records without a splitProposals container
    // never fire it anyway).
    planningDocContent: vi.fn(async () => undefined),
    splitResultContent: vi.fn(async () => undefined),
    seedSplitQuiet: vi.fn(async () => undefined),
    bindSplitSession: vi.fn(async () => true),
    // 0016 P1a: the dev-delivery bind + the per-WP mount catch-up quiet seed.
    bindDevSession: vi.fn(async () => true),
    seedDevDeclareQuiet: vi.fn(async () => undefined),
    // 0018: the wp-plan watcher's quiet seed + the delivery pointer face
    // (undefined outcome = quiet miss — records without an armed planSeed
    // never fire it anyway).
    seedWpPlanQuiet: vi.fn(async () => undefined),
    recordWpPlanSession: vi.fn(async () => true),
    dismissBanner: vi.fn(),
    dispose: vi.fn(),
  } as never
}

// vitest 未开 globals，RTL 的自动 cleanup 不生效；不显式清理会让后一个用例
// 看见前一个用例的 DOM（0003 P2 记录过的同类坑）。
afterEach(() => {
  cleanup()
})

describe('WorkbenchTabBody（六阶段导轨 · 真实数据源）', () => {
  it('renders the six stages in pipeline order; no record starts viewing at ①', () => {
    render(<WorkbenchTabBody t={bindZh()} requirement={requirement} slot={slot()} controller={fakeController()} knowledge={knowledgeState()} />)

    const rail = screen.getByRole('tablist', { name: '工作流阶段' })
    expect(rail).toBeTruthy()
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(WORKBENCH_STAGES.length)
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '① 需求理解', '② 探索规划', '③ 执行实施', '④ 评审', '⑤ 交付', '⑥ 沉淀',
    ])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs.slice(1).every((tab) => tab.getAttribute('aria-selected') === 'false')).toBe(true)
  })

  it('a record moves the viewing start to its live stage', () => {
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ stage: 'implement' }) })}
        controller={fakeController()}
      knowledge={knowledgeState()}
      />,
    )
    expect(screen.getByRole('tab', { name: '③ 执行实施' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: '① 需求理解' }).getAttribute('aria-selected')).toBe('false')
  })

  it('clicking a chip switches the viewing stage and swaps the content pane', () => {
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord() })}
        controller={fakeController()}
      knowledge={knowledgeState()}
      />,
    )

    const panel = () => screen.getByRole('tabpanel')
    fireEvent.click(screen.getByRole('tab', { name: '④ 评审' }))
    expect(screen.getByRole('tab', { name: '④ 评审' }).getAttribute('aria-selected')).toBe('true')
    // review（④）自 P4 起是评审视图真内容（报告节标题 + 导入按钮），
    // 不再是 stageHint 占位；guide 占位至此全部退役（P2 retro / P3a
    // deliver / P4 review）。
    expect(panel().textContent).toContain(workbenchZh['review.sectionTitle'])
    expect(panel().textContent).not.toContain(workbenchZh['workbench.stageHint.review'])
    // 观看是自由的（§4.1）：可回退、可跳到任意阶段。retro（⑥）自 P2 起是
    // 知识库真内容（候选节标题），不再是 stageHint 占位。
    fireEvent.click(screen.getByRole('tab', { name: '⑥ 沉淀' }))
    expect(panel().textContent).toContain(workbenchZh['knowledge.candidatesTitle'])
    expect(panel().textContent).not.toContain(workbenchZh['workbench.stageHint.retro'])
    // deliver（⑤）自 P3a 起是上线清单真内容（登记入口 + 空态引导），
    // 不再是 stageHint 占位；review（④）仍占位（P4）。
    fireEvent.click(screen.getByRole('tab', { name: '⑤ 交付' }))
    expect(panel().textContent).toContain(workbenchZh['release.sectionTitle'])
    expect(panel().textContent).toContain(workbenchZh['release.empty'])
    expect(panel().textContent).not.toContain(workbenchZh['workbench.stageHint.deliver'])
  })

  // 诚实口径守卫（双向）：无记录 ⇒ 徽章与推进不出现、空态引导在场——但
  // 「手动添加发现」动作卡必须在场：它是隐式建账的入口，藏掉它就把每个新
  // 需求锁死在工作台之外（对抗评审确认的 critical 修复钉）。
  it('record null renders no badges, no advance control — but the record-minting add card', () => {
    render(<WorkbenchTabBody t={bindZh()} requirement={requirement} slot={slot()} controller={fakeController()} knowledge={knowledgeState()} />)

    const rail = screen.getByRole('tablist', { name: '工作流阶段' })
    expect(rail.querySelectorAll('button')).toHaveLength(WORKBENCH_STAGES.length)
    expect(rail.querySelectorAll('[aria-hidden="true"]')).toHaveLength(WORKBENCH_STAGES.length - 1)
    expect(screen.queryByText(/待处置|工作包|已验收|待裁决|上线项|待审阅/)).toBeNull()
    expect(screen.queryByText(/完成本阶段|关闭需求/)).toBeNull()
    // 空态引导在场（① 视角的 firstUseHint）。
    expect(screen.getByText(workbenchZh['empty.firstUseHint'])).toBeTruthy()
    // 建账入口在场：添加发现卡可点击（点击展开表单）。
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['finding.add'] }))
    expect(screen.getByText(workbenchZh['finding.addTitle'])).toBeTruthy()
  })

  // 诚实口径守卫（双向）：有记录 ⇒ 徽章来自真实数据，零值不渲染。
  it('badge counts come from the data; zero still renders nothing', async () => {
    const { unmount } = render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ findings: [finding('a', 'open'), finding('b', 'open'), finding('c', 'resolved')] }) })}
        controller={fakeController()}
      knowledge={knowledgeState()}
      />,
    )
    expect(screen.getByText('2 待处置')).toBeTruthy()
    expect(screen.queryByText(/1 工作包|0 工作包/)).toBeNull() // workPackages 空 ⇒ 无徽章
    unmount()

    // 全部 resolved ⇒ 零值不渲染（不占位）。
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ findings: [finding('a', 'resolved'), finding('b', 'wont-fix')] }) })}
        controller={fakeController()}
      knowledge={knowledgeState()}
      />,
    )
    expect(screen.queryByText(/待处置/)).toBeNull()
  })

  it('the advance control appears with a live record and writes through the controller', async () => {
    const controller = fakeController()
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ stage: 'understand' }) })}
        controller={controller}
      knowledge={knowledgeState()}
      />,
    )
    const button = screen.getByRole('button', { name: '完成本阶段 → ② 探索规划' })
    fireEvent.click(button)
    await waitFor(() => expect(controller.advanceStage).toHaveBeenCalledWith(RID, 'plan'))
    // 推进成功后观看随行。
    await waitFor(() => expect(screen.getByRole('tab', { name: '② 探索规划' }).getAttribute('aria-selected')).toBe('true'))
  })

  it('retro closes the requirement; closed renders no control and shows the notice', async () => {
    const controller = fakeController()
    const { unmount } = render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ stage: 'retro' }) })}
        controller={controller}
      knowledge={knowledgeState()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '关闭需求 →' }))
    await waitFor(() => expect(controller.advanceStage).toHaveBeenCalledWith(RID, 'closed'))
    unmount()

    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ stage: 'closed' }) })}
        controller={controller}
      knowledge={knowledgeState()}
      />,
    )
    expect(screen.queryByText(/完成本阶段|关闭需求/)).toBeNull()
    expect(screen.getByText(workbenchZh['advance.closed'])).toBeTruthy()
  })

  it('findings form: cancel closes it; a failed save keeps it open for retry (banner path)', async () => {
    const controller = { ...fakeController(), saveFinding: vi.fn(async () => false) } as ReturnType<typeof fakeController>
    render(<WorkbenchTabBody t={bindZh()} requirement={requirement} slot={slot({ record: workbenchRecord() })} controller={controller} knowledge={knowledgeState()} />)
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['finding.add'] }))
    expect(screen.getByText(workbenchZh['finding.addTitle'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['finding.cancel'] }))
    expect(screen.queryByText(workbenchZh['finding.addTitle'])).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: workbenchZh['finding.add'] }))
    fireEvent.change(screen.getByLabelText(workbenchZh['finding.titleLabel']), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['finding.submit'] }))
    await waitFor(() => expect(controller.saveFinding).toHaveBeenCalledTimes(1))
    expect(screen.getByText(workbenchZh['finding.addTitle'])).toBeTruthy() // failed save keeps the form
  })

  it('the seat factory subscribes the store (re-renders on slot updates) and pulls the controller on mount', async () => {
    const store: WorkbenchStore = createWorkbenchStore()
    const controller = fakeController()
    const Seat = createWorkbenchTabSeat({ t: bindZh(), store, controller })
    render(<Seat requirement={requirement} />)
    expect(controller.open).toHaveBeenCalledWith(RID)
    expect(screen.getAllByRole('tab')).toHaveLength(WORKBENCH_STAGES.length)
    // Subscription pin: a store write after mount must reach the DOM — a
    // seat reading one static snapshot would keep rendering the loading state.
    act(() => {
      store.set({
        knowledgeByRequirement: {},
        byRequirement: {
          [RID]: { phase: 'ready', revision: 1, record: workbenchRecord({ findings: [finding('a', 'open')] }), planFileExists: [], reviewFileExists: [], releaseDrifted: [], busy: false },
        },
      })
    })
    expect(await screen.findByText('1 待处置')).toBeTruthy()
  })
})

describe('0007 定稿软门：S1 就绪披露 + 定稿/撤销 + 摘要导出', () => {
  const analysisContainer = (overrides: Partial<NonNullable<WorkbenchRecord['analysis']>> = {}): NonNullable<WorkbenchRecord['analysis']> => ({
    session: { sessionId: 'sess-a', boundAt: AT },
    findings: [
      { id: '77777777-7777-4777-8777-777777777777', category: 'risk', severity: 'low', title: '提议发现' },
    ],
    criteria: [{ id: '88888888-8888-4888-8888-888888888888', text: '提议标准' }],
    clarifications: [{ id: '99999999-9999-4999-8999-999999999999', question: '未答问题' }],
    ...overrides,
  })

  it('就绪区（布局重塑轮）：旧 gonogo 计数行解散，p/q 计数改乘三栏栏头角标；stageReady 咨询行与导出按钮并存', () => {
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({
          findings: [finding('a', 'open')],
          analysis: analysisContainer({ seed: { sessionId: 'sess-a', contentHash: 'h', seededAt: AT, findings: 1, criteria: 1, clarifications: 1, stageReady: true } }),
        }) })}
        controller={fakeController()}
        knowledge={knowledgeState()}
      />,
    )
    // 旧单行计数 Tag 已删（键 understand.readyPending 退役）。
    expect(screen.queryByText(/待裁决提议/)).toBeNull()
    // 角标 rides 各栏栏头：发现 1 / 标准 1 / 未答澄清 1。
    const headText = (title: string): string => (screen.getByText(title).closest('div') as HTMLElement).textContent ?? ''
    expect(headText(workbenchZh['proposal.findingsTitle'])).toContain('1')
    expect(headText(workbenchZh['proposal.criteriaTitle'])).toContain('1')
    expect(headText(workbenchZh['proposal.clarificationsTitle'])).toContain('1')
    expect(screen.getByText(workbenchZh['understand.stageReadyTag'])).toBeTruthy()
    expect(screen.getByText(workbenchZh['declare.stageReadyProposal'])).toBeTruthy()
    expect(screen.getByRole('button', { name: workbenchZh['understand.exportButton'] })).toBeTruthy()
  })

  it('按钮分层（布局重塑轮）：下一步实心、其余描边——无 analysis ⇒ 生成任务书实心/定稿描边；已定稿 ⇒ 完成本阶段实心/定稿按钮退场', () => {
    const { unmount } = render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ criteria: [{ id: 'C1', text: '标准一', coveredBy: [] }] }) })}
        controller={fakeController()}
        knowledge={knowledgeState()}
      />,
    )
    const sow = screen.getByRole('button', { name: workbenchZh['sow.analysisButton'] }) as HTMLButtonElement
    expect(sow.className).toContain('primaryButton')
    const approve = screen.getByRole('button', { name: workbenchZh['understand.approveButton'] }) as HTMLButtonElement
    expect(approve.className).toContain('ghostButton')
    const advance = screen.getByRole('button', { name: /完成本阶段/ }) as HTMLButtonElement
    expect(advance.className).toContain('advanceButton')
    unmount()

    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({
          understandApprovedAt: '2026-10-13T08:00:00.000Z',
          understandBaseline: { at: '2026-10-13T08:00:00.000Z', criteria: [{ id: 'C1', text: '标准一' }], findings: [], clarifications: [] },
          criteria: [{ id: 'C1', text: '标准一', coveredBy: [] }],
        }) })}
        controller={fakeController()}
        knowledge={knowledgeState()}
      />,
    )
    expect(screen.queryByRole('button', { name: workbenchZh['understand.approveButton'] })).toBeNull()
    const advance2 = screen.getByRole('button', { name: /完成本阶段/ }) as HTMLButtonElement
    expect(advance2.className).toContain('primaryButton')
  })

  it('诚实缺席：零记录无定稿/导出动作；有记录零未决 ⇒ 无计数行、导出禁用', () => {
    const { unmount } = render(<WorkbenchTabBody t={bindZh()} requirement={requirement} slot={slot()} controller={fakeController()} knowledge={knowledgeState()} />)
    expect(screen.queryByRole('button', { name: workbenchZh['understand.approveButton'] })).toBeNull()
    expect(screen.queryByRole('button', { name: workbenchZh['understand.exportButton'] })).toBeNull()
    unmount()

    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ criteria: [{ id: 'C1', text: '一条标准', coveredBy: [] }] }) })}
        controller={fakeController()}
        knowledge={knowledgeState()}
      />,
    )
    expect(screen.queryByText(/待裁决提议/)).toBeNull()
    expect(screen.getByRole('button', { name: workbenchZh['understand.approveButton'] })).toBeTruthy()
    expect((screen.getByRole('button', { name: workbenchZh['understand.exportButton'] }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('定稿流：ack Modal 统计行 + 勾选门控确认 → approveUnderstand(RID)；警示不阻断（无需清零）', async () => {
    const controller = fakeController()
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({
          criteria: [{ id: 'C1', text: '标准一', coveredBy: [] }],
          findings: [finding('a', 'open')],
          analysis: analysisContainer(),
        }) })}
        controller={controller}
        knowledge={knowledgeState()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['understand.approveButton'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['understand.approveTitle'] })
    // 统计行四段（split approve modal 的 description 先例）。
    expect(dialog.textContent).toContain('验收标准 1 条')
    expect(dialog.textContent).toContain('发现：已处置 0 · 未处置 1')
    expect(dialog.textContent).toContain('澄清：已答 0 · 未答 1')
    expect(dialog.textContent).toContain('待裁决提议 2')
    const confirm = screen.getByRole('button', { name: workbenchZh['understand.approveConfirm'] }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true) // 勾选门控
    fireEvent.click(screen.getByRole('checkbox'))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => { expect(controller.approveUnderstand).toHaveBeenCalledWith(RID) })
  })

  it('已定稿：横幅带日期；计数漂移 ⇒ 「定稿后上游已变化」提示；撤销确认流 → revokeUnderstand(RID)', async () => {
    const controller = fakeController()
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({
          understandApprovedAt: '2026-10-13T08:00:00.000Z',
          // 基线 1 条标准 vs 活账本 2 条 ⇒ 计数级漂移提示。
          understandBaseline: { at: '2026-10-13T08:00:00.000Z', criteria: [{ id: 'C1', text: '标准一' }], findings: [], clarifications: [] },
          criteria: [{ id: 'C1', text: '标准一', coveredBy: [] }, { id: 'C2', text: '标准二', coveredBy: [] }],
        }) })}
        controller={controller}
        knowledge={knowledgeState()}
      />,
    )
    expect(screen.getByText(/需求理解已定稿 · 2026-10-13/).textContent).toContain(workbenchZh['understand.bannerChanged'])
    expect(screen.queryByRole('button', { name: workbenchZh['understand.approveButton'] })).toBeNull() // 已定稿 ⇒ 无定稿按钮
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['understand.revoke'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['understand.revokeTitle'] })
    expect(dialog.textContent).toContain(workbenchZh['understand.revokeDescription'])
    const confirm = screen.getByRole('button', { name: workbenchZh['understand.revokeConfirm'] }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(confirm)
    await waitFor(() => { expect(controller.revokeUnderstand).toHaveBeenCalledWith(RID) })
  })

  it('导出 Modal：标题与预览来自 buildUnderstandingSheet（所见即所复制）', () => {
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({
          criteria: [{ id: 'C1', text: '导出走异步', sourceSection: 'PRD#3.1', coveredBy: [] }],
        }) })}
        controller={fakeController()}
        knowledge={knowledgeState()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['understand.exportButton'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['understand.exportTitle'] })
    expect(dialog.textContent).toContain('需求理解摘要：报价管理：导入导出与数据校验')
    expect(dialog.textContent).toContain('[定稿状态] 未定稿')
    expect(dialog.textContent).toContain('C1　导出走异步')
    expect(dialog.textContent).toContain('账本为真源，导出为分发')
  })

  it('0008 整理入口：[生成整理任务书] 开 SowModal（consolidate purpose，编辑器含任务书头与基线文件路径段）', async () => {
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ criteria: [{ id: 'C1', text: '导出走异步', coveredBy: [] }] }) })}
        controller={fakeController()}
        knowledge={knowledgeState()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['understand.consolidateButton'] }))
    const dialog = await screen.findByRole('dialog', { name: workbenchZh['sow.title'] })
    // 0009：预览是可编辑 textarea——断言读 value（textContent 不含受控值）。
    const editor = dialog.querySelector('textarea[data-testid="sow-preview"]') as HTMLTextAreaElement
    expect(editor).toBeTruthy()
    await waitFor(() => { expect(editor.value).toContain('# skyaxis 需求整理任务书 · 报价管理：导入导出与数据校验') })
    // consolidate 语境的输入段在场（view.spec 不注入 PRD fake ⇒ jsdom 列表
    // 不可得的诚实行；左侧提示组已退役）。
    expect(editor.value).toContain('（PRD 文档列表未可得——可列举 prds/ 目录确认）')
  })

  it('0008 ack 文档态探测：无文档 ⇒ 「尚无基线文档」披露行（软门不阻断，确认键照常可用）', async () => {
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ criteria: [{ id: 'C1', text: '导出走异步', coveredBy: [] }] }) })}
        controller={fakeController()} // requirementDocContent ⇒ undefined = no-doc
        knowledge={knowledgeState()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['understand.approveButton'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['understand.approveTitle'] })
    await waitFor(() => { expect(dialog.textContent).toContain(workbenchZh['understand.ackNoDoc']) })
    expect(dialog.textContent).not.toContain(workbenchZh['understand.ackDocWillAnchor'])
    const confirm = screen.getByRole('button', { name: workbenchZh['understand.approveConfirm'] }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true) // 勾选门控照旧——软门披露不是阻断
    fireEvent.click(screen.getByRole('checkbox'))
    expect(confirm.disabled).toBe(false)
  })

  it('0008 ack 文档态探测：文档在场 ⇒ 「将锚定」披露行', async () => {
    const controller = fakeController()
    controller.requirementDocContent = vi.fn(async () => ({ kind: 'ok' as const, content: '# 需求基线', contentTampered: false }))
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ criteria: [{ id: 'C1', text: '导出走异步', coveredBy: [] }] }) })}
        controller={controller}
        knowledge={knowledgeState()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['understand.approveButton'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['understand.approveTitle'] })
    await waitFor(() => { expect(dialog.textContent).toContain(workbenchZh['understand.ackDocWillAnchor']) })
  })

  it('0012 S2 规划入口：stage=plan 时 [生成规划任务书] 开 SowModal（plan purpose，编辑器含规划任务书头；无 declare 块）', async () => {
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ stage: 'plan', criteria: [{ id: 'C1', text: '导出走异步', coveredBy: [] }] }) })}
        controller={fakeController()}
        knowledge={knowledgeState()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['sow.planButton'] }))
    const dialog = await screen.findByRole('dialog', { name: workbenchZh['sow.title'] })
    const editor = dialog.querySelector('textarea[data-testid="sow-preview"]') as HTMLTextAreaElement
    expect(editor).toBeTruthy()
    await waitFor(() => { expect(editor.value).toContain('# skyaxis 规划任务书 · 报价管理：导入导出与数据校验') })
    expect(editor.value).not.toContain('skyaxis-declare')
  })

  it('0012 S2 拆分结果文档卡（验收驱动补面）：拆分会话写入后 ready 卡片 + 点击预览弹窗自跑独立 fetch', async () => {
    const controller = fakeController()
    controller.splitResultContent = vi.fn(async () => ({ kind: 'ok' as const, content: '# 拆分方案\n\n## 工作包清单\n…', contentTampered: false }))
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ stage: 'plan', criteria: [{ id: 'C1', text: '导出走异步', coveredBy: [] }] }) })}
        controller={controller}
        knowledge={knowledgeState()}
      />,
    )
    // 卡片 ready：显示名 + 全路径披露行。
    const card = await screen.findByRole('button', { name: new RegExp(workbenchZh['splitResult.preview']) })
    expect(within(card).getByText(`split/${RID.slice(0, 8)}.md`)).toBeTruthy()
    expect(within(card).getByText(`${workbenchZh['splitResult.pathPrefix']}/ws/.skyaxis/split/${RID}.md`)).toBeTruthy()
    // 点击开预览：弹窗自跑一次独立 fetch（与行探测合计两次）。
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(card)
    const dialog = await screen.findByRole('dialog', { name: workbenchZh['splitResult.title'] })
    expect(dialog).toBeTruthy()
    await waitFor(() => expect(controller.splitResultContent).toHaveBeenCalledTimes(2))
  })

  it('布局轮 S2 分层（planNextAction）：已批准拆分 ⇒ 顶栏已批准 Tag + 完成本阶段实心、双任务书描边', () => {
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({
          stage: 'plan',
          planAdoptedAt: AT,
          splitApprovedAt: AT,
          criteria: [{ id: 'C1', text: '导出走异步', coveredBy: ['WP1'] }],
          workPackages: [({
            id: 'WP1', title: '数据导出', boundary: '导出', order: 1, dependsOn: [], covers: ['C1'], status: 'planned' as const, plans: [], sessions: [], commits: [], acceptances: [],
          })],
        }) })}
        controller={fakeController()}
        knowledge={knowledgeState()}
      />,
    )
    expect(screen.getByText(workbenchZh['split.approvedTag'])).toBeTruthy()
    expect((screen.getByRole('button', { name: /完成本阶段/ }) as HTMLButtonElement).className).toContain('primaryButton')
    expect((screen.getByRole('button', { name: workbenchZh['sow.planButton'] }) as HTMLButtonElement).className).toContain('ghostButton')
    expect((screen.getByRole('button', { name: workbenchZh['sow.splitButton'] }) as HTMLButtonElement).className).toContain('ghostButton')
  })

  it('0012 split 投递绑定：投递成功 ⇒ bindSplitSession(RID, sessionId, 任务书头 200 字锚)', async () => {
    const controller = fakeController()
    const deliver = vi.fn(async () => ({ ok: true as const, sessionId: 'sess-split-real' }))
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ stage: 'plan', criteria: [{ id: 'C1', text: '导出走异步', coveredBy: [] }] }) })}
        controller={controller}
        knowledge={knowledgeState()}
        deliver={deliver}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['sow.splitButton'] }))
    const dialog = await screen.findByRole('dialog', { name: workbenchZh['sow.title'] })
    await waitFor(() => { expect((dialog.querySelector('textarea[data-testid="sow-preview"]') as HTMLTextAreaElement).value).toContain('# skyaxis 拆分任务书') })
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['sow.deliver'] }))
    await waitFor(() => expect(deliver).toHaveBeenCalled())
    await waitFor(() => expect(controller.bindSplitSession).toHaveBeenCalledWith(RID, 'sess-split-real', expect.any(String)))
  })

  it('0017 刀二：dev v3 投递（sent）⇒ 投递即绑 bindDevSession(RID, WP1, sessionId)——prompted id 即真实会话', async () => {
    const controller = fakeController()
    const deliver = vi.fn(async () => ({ ok: true as const, sessionId: 'sess-v3-real', sent: true as const }))
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ stage: 'implement', splitApprovedAt: AT, workPackages: [({
          id: 'WP1', title: '数据导出', boundary: '导出', order: 1, dependsOn: [], covers: [], status: 'in-dev' as const, plans: [], sessions: [], commits: [], acceptances: [],
        })] }) })}
        controller={controller}
        knowledge={knowledgeState()}
        deliver={deliver}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: /③ 执行实施/ }))
    const card = await screen.findByRole('button', { name: /WP1/ })
    fireEvent.click(card)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['sow.workPackageButton'] }))
    const sowDialog = await screen.findByRole('dialog', { name: workbenchZh['sow.title'] })
    await waitFor(() => { expect((sowDialog.querySelector('textarea[data-testid="sow-preview"]') as HTMLTextAreaElement).value).toContain('# skyaxis 工作包任务书 WP1') })
    fireEvent.click(within(sowDialog).getByRole('button', { name: workbenchZh['sow.deliver'] }))
    await waitFor(() => expect(deliver).toHaveBeenCalled())
    await waitFor(() => expect(controller.bindDevSession).toHaveBeenCalledWith(RID, 'WP1', 'sess-v3-real'))
    expect((controller.bindDevSession as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it('0017 刀二：dev 降级投递（sent=false/缺省）不绑定——v2 shell 病理仍在；标题寻址 pass 绑定真实会话（0016 刀一验收修正口径延续）', async () => {
    const controller = fakeController()
    const deliver = vi.fn(async () => ({ ok: true as const, sessionId: 'sess-shell' }))
    // 可控会话面：发送后真实会话以任务书头行为标题物化
    let listeners: Array<() => void> = []
    let sessions: Array<{ id: string; displayTitle: string; running: boolean; blank: boolean }> = [
      { id: 'sess-shell', displayTitle: 'sess-shell', running: false, blank: true },
    ]
    const face = {
      get ids() { return sessions.map((row) => row.id) },
      get summariesById() {
        const byId: Record<string, { id: string; displayTitle: string; running: boolean; blank: boolean }> = {}
        for (const row of sessions) byId[row.id] = { ...row }
        return byId
      },
      subscribe: (listener: () => void) => {
        listeners.push(listener)
        return () => { listeners = listeners.filter((candidate) => candidate !== listener) }
      },
      navigate: () => {},
    }
    const wpRow = (status: WorkbenchWorkPackage['status'], sessions2: Array<{ sessionId: string; purpose: 'dev'; boundAt: string }> = []) =>
      ({ id: 'WP1', title: '数据导出', boundary: '导出', order: 1, dependsOn: [], covers: [], status, plans: [], sessions: sessions2, commits: [], acceptances: [] })
    const view = render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({ stage: 'implement', splitApprovedAt: AT, workPackages: [wpRow('in-dev')] }) })}
        controller={controller}
        knowledge={knowledgeState()}
        deliver={deliver}
        sessions={face}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: /③ 执行实施/ }))
    const card = await screen.findByRole('button', { name: /WP1/ })
    fireEvent.click(card)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['sow.workPackageButton'] }))
    const sowDialog = await screen.findByRole('dialog', { name: workbenchZh['sow.title'] })
    await waitFor(() => { expect((sowDialog.querySelector('textarea[data-testid="sow-preview"]') as HTMLTextAreaElement).value).toContain('# skyaxis 工作包任务书 WP1') })
    fireEvent.click(within(sowDialog).getByRole('button', { name: workbenchZh['sow.deliver'] }))
    await waitFor(() => expect(deliver).toHaveBeenCalled())
    // 投递即 shell——不绑定
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(controller.bindDevSession).not.toHaveBeenCalled()
    // 用户发送：真实会话物化，fallback 标题=任务书头行 → 翻转后 pass 绑定
    sessions = [...sessions, { id: 'sess-real', displayTitle: '# skyaxis 工作包任务书 WP1 · 报价管理：导入导出与数据校验', running: true, blank: false }]
    for (const listener of [...listeners]) listener()
    await waitFor(() => expect(controller.bindDevSession).toHaveBeenCalledWith(RID, 'WP1', 'sess-real'))
    // WP10 不被 WP1 的标题误绑（词边界）；已绑定真实会话后不再重复绑
    expect((controller.bindDevSession as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
    view.unmount()
  })

  it('0016 P1a 挂载 catch-up：in-dev WP 带 dev 绑定且无槽 ⇒ seedDevDeclareQuiet(RID, WP1) 一次性触发', async () => {
    const controller = fakeController()
    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot({ record: workbenchRecord({
          stage: 'implement',
          splitApprovedAt: AT,
          workPackages: [{ id: 'WP1', title: '数据导出', boundary: '导出', order: 1, dependsOn: [], covers: [], status: 'in-dev', plans: [], sessions: [{ sessionId: 'sess-dev-x', purpose: 'dev' as const, boundAt: AT }], commits: [], acceptances: [] }],
        }) })}
        controller={controller}
        knowledge={knowledgeState()}
      />,
    )
    await waitFor(() => expect(controller.seedDevDeclareQuiet).toHaveBeenCalledWith(RID, 'WP1'))
    // one-shot: a re-render of the same snapshot does not re-fire
    const calls = (controller.seedDevDeclareQuiet as ReturnType<typeof vi.fn>).mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect((controller.seedDevDeclareQuiet as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls)
  })
})
