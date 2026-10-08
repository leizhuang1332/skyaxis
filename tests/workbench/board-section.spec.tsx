// @vitest-environment jsdom
/**
 * S3 执行看板（0006 第二刀 client 组件测试）：硬门①未过的 lockedHint、
 * 五列派生（6 状态折叠、dropped 不入板、列头计数）、待计划列的未起草/
 * 草拟中 Tag、计划已批准 Tag 与盘上缺失披露、进度行（m 剔除 dropped，全
 * 空不渲染）、待验收列内嵌验收动作（通过直落 / 不通过必填原因 Modal）、
 * 卡结构守卫（按钮永不嵌套按钮）、已验收卡无动作。
 *
 * 全部断言走真词典 workbenchZh；详情 Modal 与拒绝 Modal 均 portal 到
 * body，RTL 在 vitest 下无自动 cleanup，afterEach 显式清理。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PlanEntry, WorkbenchRecord, WorkbenchWorkPackage } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import type { WorkbenchController } from '../../src/client/workbench/controller.js'
import type { RequirementWorkbenchState } from '../../src/client/workbench/store.js'
import { BoardSection } from '../../src/client/workbench/board-section.js'

const RID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-09-29T08:00:00.000Z'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

function planEntry(version: number, overrides: Partial<PlanEntry> = {}): PlanEntry {
  return { version, ...overrides }
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
    stage: 'implement',
    stageHistory: [{ stage: 'implement', at: AT }],
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

/** planned×2 / plan-approved / in-dev / built / accepted 各 1 + dropped×1。 */
function boardWorkPackages(): WorkbenchWorkPackage[] {
  return [
    wp('WP1', { order: 1, status: 'planned' }),
    wp('WP2', { order: 2, status: 'plan-draft', plans: [planEntry(1)] }),
    wp('WP3', { order: 3, status: 'plan-approved', plans: [planEntry(2, { approvedAt: AT }), planEntry(1, { approvedAt: AT })] }),
    wp('WP4', { order: 4, status: 'in-dev' }),
    wp('WP5', { order: 5, status: 'built' }),
    wp('WP6', { order: 6, status: 'accepted', acceptances: [{ at: AT, result: 'pass' }] }),
    wp('WP7', { order: 7, status: 'dropped' }),
  ]
}

function subject(s: RequirementWorkbenchState = slot({ record: record({ splitApprovedAt: AT, workPackages: boardWorkPackages() }) }), controller: WorkbenchController = fakeController()) {
  return {
    ...render(<BoardSection t={bindZh()} slot={s} controller={controller} requirementId={RID} />),
    controller,
  }
}

describe('BoardSection（S3 执行看板）', () => {
  it('未批准（硬门①未过）：lockedHint 引导替代看板，五列与卡不出现', () => {
    subject(slot({ record: record({ workPackages: boardWorkPackages() }) }))

    expect(screen.getByText(workbenchZh['board.lockedHint'])).toBeTruthy()
    expect(screen.queryByText(workbenchZh['board.colPlanned'], { exact: true })).toBeNull()
    expect(screen.queryByText(/WP1/)).toBeNull()
  })

  it('五列派生：6 个活动 WP 各入正确列、dropped 不入板、列头计数正确', () => {
    subject()

    const expected: Array<[string, string[], string]> = [
      [workbenchZh['board.colPlanned'], ['WP1', 'WP2'], '2'],
      [workbenchZh['board.colPlanApproved'], ['WP3'], '1'],
      [workbenchZh['board.colInDev'], ['WP4'], '1'],
      [workbenchZh['board.colBuilt'], ['WP5'], '1'],
      [workbenchZh['board.colAccepted'], ['WP6'], '1'],
    ]
    for (const [title, ids, count] of expected) {
      const head = screen.getByText(title, { exact: true })
      const column = head.parentElement as HTMLElement
      expect((head.querySelector('span') as HTMLElement).textContent).toBe(count)
      for (const id of ids) expect(column.textContent).toContain(`${id}　工作包-${id}`)
      for (const other of ['WP1', 'WP2', 'WP3', 'WP4', 'WP5', 'WP6'].filter((id) => !ids.includes(id))) {
        expect(column.textContent).not.toContain(`${other}　工作包`)
      }
    }
    // dropped 留在看板外（历史在详情 dialog）。
    expect(screen.queryByText(/WP7/)).toBeNull()
  })

  it('待计划列 Tag 区分：无 plans「未起草」、有未批准 plans「草拟中」', () => {
    subject()

    // plan Tag 与 status 无关（链尾决定），其他列同样有未起草卡—— scoped
    // 到待计划列断言该列内部的区分。
    const head = screen.getByText(workbenchZh['board.colPlanned'], { exact: true })
    const column = head.parentElement as HTMLElement
    expect(within(column).getByText(workbenchZh['board.notDrafted'])).toBeTruthy()
    expect(within(column).getByText(workbenchZh['board.drafting'])).toBeTruthy()
  })

  it('计划已批准卡：Tag「计划 v2」；盘上缺失行（exists=false）追加「计划文件缺失」', () => {
    const approvedWp = wp('WP1', { status: 'plan-approved', plans: [planEntry(2, { approvedAt: AT }), planEntry(1, { approvedAt: AT })] })

    const rendered = subject(slot({
      record: record({ splitApprovedAt: AT, workPackages: [approvedWp] }),
      planFileExists: [{ workPackageId: 'WP1', version: 2, exists: true }],
    }))
    expect(rendered.getByText('计划 v2')).toBeTruthy()
    expect(rendered.queryByText(workbenchZh['board.planMissing'])).toBeNull()
    rendered.unmount()

    const rendered2 = subject(slot({
      record: record({ splitApprovedAt: AT, workPackages: [approvedWp] }),
      planFileExists: [{ workPackageId: 'WP1', version: 2, exists: false }],
    }))
    expect(rendered2.getByText(`计划 v2 · ${workbenchZh['board.planMissing']}`)).toBeTruthy()
  })

  it('进度行：n/m 已验收（m 剔除 dropped）+ 待验收/开发中计数；全空（0 WP）进度行不渲染', () => {
    const rendered = subject()

    expect(rendered.getByText('1/6 已验收')).toBeTruthy()
    expect(rendered.getByText('1 待验收')).toBeTruthy()
    expect(rendered.getByText('1 开发中')).toBeTruthy()
    expect(rendered.getByText('1 计划已批准')).toBeTruthy()
    expect(rendered.getByText('2 待计划')).toBeTruthy()
    rendered.unmount()

    const rendered2 = subject(slot({ record: record({ splitApprovedAt: AT, workPackages: [] }) }))
    expect(rendered2.queryByText('0/0 已验收')).toBeNull()
    expect(rendered2.queryByText('0 待验收')).toBeNull()
  })

  it('待验收列内嵌动作：通过直落 controller；不通过 Modal 必填原因（空原因拦截+报错文案）', async () => {
    const { controller } = subject()

    fireEvent.click(screen.getByRole('button', { name: workbenchZh['board.accept'] }))
    await waitFor(() => expect(controller.acceptWorkPackage).toHaveBeenCalledWith(RID, 'WP5', 'pass'))

    fireEvent.click(screen.getByRole('button', { name: workbenchZh['board.reject'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['board.rejectTitle'] })
    // 空原因：提交被拦截、内联报错、不落盘。
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['board.rejectSubmit'] }))
    expect(within(dialog).getByText(workbenchZh['board.rejectReasonRequired'])).toBeTruthy()
    expect(controller.acceptWorkPackage).toHaveBeenCalledTimes(1)

    fireEvent.change(within(dialog).getByLabelText(workbenchZh['board.rejectReasonLabel']), { target: { value: '  越界改动需返工  ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['board.rejectSubmit'] }))
    await waitFor(() => expect(controller.acceptWorkPackage).toHaveBeenCalledWith(RID, 'WP5', 'fail', '越界改动需返工'))
  })

  it('卡结构守卫：标题 button 开详情；关闭后 boardCardMain 仍为 button 且动作按钮为兄弟（不嵌套）', async () => {
    const { controller } = subject()

    const titleButton = screen.getByRole('button', { name: /WP5/ })
    fireEvent.click(titleButton)
    expect(await screen.findByRole('dialog', { name: 'WP5　工作包-WP5' })).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog', { name: 'WP5　工作包-WP5' })).getByRole('button', { name: workbenchZh['detail.returnForEdit'] }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // 关闭后卡结构复原：卡 div 内 button = 标题 1 + built 列动作 2，标题内无嵌套按钮。
    const card = titleButton.parentElement as HTMLElement
    expect(card.querySelectorAll('button')).toHaveLength(3)
    expect(titleButton.querySelectorAll('button')).toHaveLength(0)
  })

  it('已验收卡（含 fail 历史）无验收动作按钮', () => {
    subject(slot({
      record: record({
        splitApprovedAt: AT,
        workPackages: [wp('WP1', { status: 'accepted', acceptances: [{ at: AT, result: 'fail', note: '首轮不通过' }] })],
      }),
    }))

    expect(screen.getByRole('button', { name: /WP1/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: workbenchZh['board.accept'] })).toBeNull()
    expect(screen.queryByRole('button', { name: workbenchZh['board.reject'] })).toBeNull()
  })
})
