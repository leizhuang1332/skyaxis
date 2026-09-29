// @vitest-environment jsdom
/**
 * S2 工作包拆分节（0006 第二刀 client 组件测试）：未批准态的行渲染（标题/
 * 边界/meta 行/P 并行 Tag）与行 ⋯ Menu 四项、硬门①批准流（统计文案进
 * dialog、ack 未勾确认键禁用、勾选后 controller.approveSplit 落盘）、批准
 * 后行只读 + gonogo 横幅、撤销流（ack → revokeSplitApproval）、上移/下移/
 * 删除的 controller 断言、空清单禁用批准、＋工作包新建入口。
 *
 * 全部断言走真词典 workbenchZh；Modal 内容 portal 到 body，RTL 在 vitest
 * 下无自动 cleanup，不显式清理会让后一个用例看见前一个用例残留的 dialog。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { WorkbenchCriterion, WorkbenchRecord, WorkbenchWorkPackage } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import type { WorkbenchController } from '../../src/client/workbench/controller.js'
import type { RequirementWorkbenchState } from '../../src/client/workbench/store.js'
import { SplitSection } from '../../src/client/workbench/split-section.js'

const RID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-09-29T08:00:00.000Z'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

function criterion(id: string, overrides: Partial<WorkbenchCriterion> = {}): WorkbenchCriterion {
  return { id, text: `标准-${id}`, coveredBy: [], ...overrides }
}

function wp(id: string, overrides: Partial<WorkbenchWorkPackage> = {}): WorkbenchWorkPackage {
  return {
    id,
    title: `工作包-${id}`,
    boundary: `边界-${id}`,
    order: 1,
    dependsOn: [],
    covers: [],
    status: 'planned',
    plans: [],
    sessions: [],
    commits: [],
    acceptances: [],
    ...overrides,
  }
}

function record(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: RID,
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

function slot(overrides: Partial<RequirementWorkbenchState> = {}): RequirementWorkbenchState {
  return {
    phase: 'ready',
    revision: 3,
    record: null,
    planFileExists: [],
    reviewFileExists: [],
    busy: false,
    ...overrides,
  }
}

function fakeController(overrides: Record<string, unknown> = {}): WorkbenchController {
  return {
    open: vi.fn(async () => undefined),
    advanceStage: vi.fn(async () => true),
    saveFinding: vi.fn(async () => true),
    removeFinding: vi.fn(async () => true),
    saveWorkPackage: vi.fn(async () => true),
    removeWorkPackage: vi.fn(async () => true),
    moveWorkPackage: vi.fn(async () => true),
    approveSplit: vi.fn(async () => true),
    revokeSplitApproval: vi.fn(async () => true),
    approvePlan: vi.fn(async () => true),
    startWorkPackage: vi.fn(async () => true),
    markWorkPackageBuilt: vi.fn(async () => true),
    acceptWorkPackage: vi.fn(async () => true),
    reopenWorkPackage: vi.fn(async () => true),
    dropWorkPackage: vi.fn(async () => true),
    restoreWorkPackage: vi.fn(async () => true),
    saveCriterion: vi.fn(async () => true),
    removeCriterion: vi.fn(async () => true),
    writePlan: vi.fn(async () => true),
    planContent: vi.fn(async () => ({ kind: 'ok' as const, content: '# 计划正文', contentTampered: false })),
    dismissBanner: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  } as never
}

// vitest 未开 globals，RTL 的自动 cleanup 不生效；Modal portal 进 body，
// 不显式清理会让后一个用例看见前一个用例残留的 dialog（0003 P2 同款坑）。
afterEach(() => {
  cleanup()
})

const splitCriteria = (): WorkbenchCriterion[] => [
  criterion('C1', { coveredBy: ['WP1'] }),
  criterion('C2'),
]

const splitRecord = (overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord =>
  record({
    criteria: splitCriteria(),
    workPackages: [
      wp('WP1', { order: 1, covers: ['C1'], parallel: true }),
      wp('WP2', { order: 2, dependsOn: ['WP1'] }),
    ],
    ...overrides,
  })

function subject(s: RequirementWorkbenchState, controller: WorkbenchController = fakeController()) {
  return {
    ...render(<SplitSection t={bindZh()} slot={s} controller={controller} requirementId={RID} />),
    controller,
  }
}

describe('SplitSection（S2 拆分清单 + 硬门①）', () => {
  it('未批准态：行渲染（标题/边界/meta 行/P 并行 Tag）+ 批准按钮 + 行 Menu 四项可点开', () => {
    subject(slot({ record: splitRecord() }))

    // 注：getByText 的 DOM 侧归一化会把全角空格折叠成单 ASCII 空格，而
    // 查询串不做归一化——此处与后续行文本断言统一用半角空格书写。
    expect(screen.getByText('WP1 工作包-WP1')).toBeTruthy()
    expect(screen.getByText('P 并行')).toBeTruthy()
    expect(screen.getByText('边界-WP1')).toBeTruthy()
    expect(screen.getByText('依赖的工作包：— · 覆盖的验收标准：C1')).toBeTruthy()
    expect(screen.getByText('依赖的工作包：WP1 · 覆盖的验收标准：—')).toBeTruthy()
    expect(screen.getByRole('button', { name: workbenchZh['split.approve'] })).toBeTruthy()

    // 行 ⋯ Menu（锚 aria-label = 工作包 id）展开四项。
    fireEvent.click(screen.getByRole('button', { name: 'WP1' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      workbenchZh['menu.edit'], workbenchZh['menu.moveUp'], workbenchZh['menu.moveDown'], workbenchZh['menu.remove'],
    ])
  })

  it('批准流：统计文案进 dialog → ack 未勾确认键禁用 → 勾选后确认落盘 controller.approveSplit', async () => {
    const { controller } = subject(slot({ record: splitRecord() }))

    fireEvent.click(screen.getByRole('button', { name: workbenchZh['split.approve'] }))
    const dialog = screen.getByRole('dialog', { name: '批准拆分（硬门①）' })
    expect(dialog.textContent).toContain('2 个工作包')
    expect(dialog.textContent).toContain('1/2 条标准已覆盖')
    expect(dialog.textContent).toContain('1 条标准无覆盖')

    // RiskConfirmation 式三段：确认键在 ack 勾选前不可用。
    const confirm = within(dialog).getByRole('button', { name: workbenchZh['split.approveConfirm'] }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('checkbox'))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(controller.approveSplit).toHaveBeenCalledWith(RID))
  })

  it('批准后：行只读（无行 Menu 锚/无＋工作包/无批准按钮）+ gonogo 横幅（已批准 Tag + 统计 + 撤销）', () => {
    subject(slot({ record: splitRecord({ splitApprovedAt: AT }) }))

    expect(screen.queryByRole('button', { name: 'WP1' })).toBeNull()
    expect(screen.queryByText(workbenchZh['split.add'])).toBeNull()
    expect(screen.queryByRole('button', { name: workbenchZh['split.approve'] })).toBeNull()

    expect(screen.getByText(workbenchZh['split.approvedTag'])).toBeTruthy()
    expect(screen.getByText(new RegExp(`^${workbenchZh['split.approvedAtPrefix']} ${AT} · 2 个工作包`))).toBeTruthy()
    expect(screen.getByRole('button', { name: workbenchZh['split.revoke'] })).toBeTruthy()
  })

  it('撤销流：确认键 ack 未勾禁用，勾选后 controller.revokeSplitApproval 落盘', async () => {
    const { controller } = subject(slot({ record: splitRecord({ splitApprovedAt: AT }) }))

    fireEvent.click(screen.getByRole('button', { name: workbenchZh['split.revoke'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['split.revokeTitle'] })
    const confirm = within(dialog).getByRole('button', { name: workbenchZh['split.revokeConfirm'] }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('checkbox'))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(controller.revokeSplitApproval).toHaveBeenCalledWith(RID))
  })

  it('行 Menu 上移 → controller.moveWorkPackage(rid, id, up)；下移 → down', async () => {
    const { controller } = subject(slot({ record: splitRecord() }))

    fireEvent.click(screen.getByRole('button', { name: 'WP1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: workbenchZh['menu.moveUp'] }))
    await waitFor(() => expect(controller.moveWorkPackage).toHaveBeenCalledWith(RID, 'WP1', 'up'))

    // 选择后菜单关闭，重开再点下移。
    fireEvent.click(screen.getByRole('button', { name: 'WP1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: workbenchZh['menu.moveDown'] }))
    await waitFor(() => expect(controller.moveWorkPackage).toHaveBeenCalledWith(RID, 'WP1', 'down'))
  })

  it('编辑入口 → 表单 Modal 播种旧标题；删除入口 → 确认 Modal → controller.removeWorkPackage', async () => {
    const { controller } = subject(slot({ record: splitRecord() }))

    fireEvent.click(screen.getByRole('button', { name: 'WP1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: workbenchZh['menu.edit'] }))
    const editDialog = screen.getByRole('dialog', { name: `${workbenchZh['wp.editTitle']} · WP1` })
    expect((within(editDialog).getByLabelText(workbenchZh['wp.titleLabel']) as HTMLInputElement).value).toBe('工作包-WP1')

    fireEvent.click(screen.getByRole('button', { name: 'WP2' }))
    fireEvent.click(screen.getByRole('menuitem', { name: workbenchZh['menu.remove'] }))
    const removeDialog = screen.getByRole('dialog', { name: workbenchZh['wp.removeTitle'] })
    expect(removeDialog.textContent).toContain('WP2 工作包-WP2')
    fireEvent.click(within(removeDialog).getByRole('button', { name: workbenchZh['action.confirm'] }))
    await waitFor(() => expect(controller.removeWorkPackage).toHaveBeenCalledWith(RID, 'WP2'))
  })

  it('空清单：批准按钮 disabled', () => {
    subject(slot({ record: record() }))
    expect((screen.getByRole('button', { name: workbenchZh['split.approve'] }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('新建入口：＋工作包 → 表单 Modal；标题为空提交被内联校验拦截（不落盘）', () => {
    const { controller } = subject(slot({ record: splitRecord() }))

    fireEvent.click(screen.getByRole('button', { name: workbenchZh['split.add'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['wp.addTitle'] })
    const save = within(dialog).getByRole('button', { name: workbenchZh['action.save'] }) as HTMLButtonElement

    // 「标题」文本先只有表单标签一处；提交校验失败后追加内联 fieldError 一处。
    expect(within(dialog).getAllByText(workbenchZh['wp.titleLabel'])).toHaveLength(1)
    fireEvent.click(save)
    expect(within(dialog).getAllByText(workbenchZh['wp.titleLabel'])).toHaveLength(2)
    expect(controller.saveWorkPackage).not.toHaveBeenCalled()
  })
})


describe('S2 已放弃区（回收站化——验收轮三）', () => {
  const droppedRecord = () => record({
    workPackages: [wp('WP1'), wp('WP2', { status: 'dropped' })],
  })

  it('dropped 只出现在底部已放弃区（活动区与 S3 看板集合恒等），带已放弃 Tag', () => {
    const controller = fakeController()
    const rendered = subject(slot({ record: droppedRecord() }), controller)
    expect(rendered.getByText(workbenchZh['split.droppedSectionTitle'])).toBeTruthy()
    expect(rendered.getByText(workbenchZh['split.droppedTag'])).toBeTruthy()
    // WP2 全文只在已放弃区出现一次（行标题 DIV 的 textContent 以 id 开头，
    // 后随已放弃 Tag 文本）；WP1 在活动区（RTL 将 U+3000 归一为半角空格）
    const wp2Nodes = rendered.getAllByText((_, element) =>
      element instanceof HTMLElement && element.className.includes('wpRowTitle') && (element.textContent ?? '').startsWith('WP2'))
    expect(wp2Nodes).toHaveLength(1)
    expect(rendered.getByText('WP1 工作包-WP1')).toBeTruthy()
  })

  it('未批准：已放弃区 Menu〔恢复/删除〕——恢复 → controller.restoreWorkPackage', async () => {
    const controller = fakeController()
    const rendered = subject(slot({ record: droppedRecord() }), controller)
    const menuButtons = rendered.getAllByRole('button', { name: 'WP2' })
    fireEvent.click(menuButtons[menuButtons.length - 1]!)
    const item = await rendered.findByRole('menuitem', { name: workbenchZh['split.restore'] })
    fireEvent.click(item)
    await waitFor(() => expect(controller.restoreWorkPackage).toHaveBeenCalledWith(RID, 'WP2'))
  })

  it('已批准：已放弃区只读（无 Menu）', async () => {
    const controller = fakeController()
    const approvedRecord = record({
      splitApprovedAt: '2026-09-29T09:30:00.000Z',
      workPackages: [wp('WP1'), wp('WP2', { status: 'dropped' })],
    })
    const rendered = subject(slot({ record: approvedRecord }), controller)
    await rendered.findByText(workbenchZh['split.droppedSectionTitle'])
    expect(rendered.queryAllByRole('menuitem')).toHaveLength(0)
  })
})
