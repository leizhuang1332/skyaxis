// @vitest-environment jsdom
/**
 * S3 工作包详情 Modal（0006 第二刀 client 组件测试）：版本链行（当前/
 * 草稿/归档/已批准 Tag）+ 正文按版本懒拉与组件内缓存 + tampered 警示条 +
 * 404 缺失态（尾草稿重试写入 / 已批准版本只披露）+ 草稿保存后清缓存重拉
 * + 硬门②批准计划 + footer 生命周期按 status（开始开发/标记完成待验收/
 * 重开/放弃含确认 Modal/dropped 无按钮）+ 验收节（通过/不通过、手动完成
 * 披露、fail 历史行）。
 *
 * MarkdownText 在 vitest 下是代理 stub（micromark 族被 vitest.config 打
 * 桩），正文 DOM 不可预测——正文断言一律不做到 Markdown 层，只钉版本
 * chip、状态与动作。Modal portal 到 body，afterEach 显式清理。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PlanEntry, WorkbenchWorkPackage } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import type { WorkbenchController } from '../../src/client/workbench/controller.js'
import type { RequirementWorkbenchState } from '../../src/client/workbench/store.js'
import { WorkPackageDialog } from '../../src/client/workbench/work-package-dialog.js'

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
    // 0018 缺陷修复：AI 尾草稿 missing 面板的「重新收取」面。
    reseedWpPlan: vi.fn(async () => true),
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

/** v2 尾草稿 + v1 已批准：链尾决定草稿/批准语义。 */
const draftWp = (): WorkbenchWorkPackage =>
  wp('WP1', { status: 'plan-draft', plans: [planEntry(2), planEntry(1, { approvedAt: AT })] })

function subject(workPackage: WorkbenchWorkPackage, controller: WorkbenchController = fakeController(), s: RequirementWorkbenchState = slot()) {
  return render(
    <WorkPackageDialog
      t={bindZh()}
      workPackage={workPackage}
      slot={s}
      controller={controller}
      requirementId={RID}
      onClose={() => { /* noop */ }}
    />,
  )
}

const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

describe('WorkPackageDialog（S3 详情 Modal + 硬门②）', () => {
  it('0017 修订：会话行=会话入口——在场绑定行可点（onNavigateSession(sessionId)），消亡绑定只读行', () => {
    const onNavigateSession = vi.fn()
    const workPackage = wp('WP1', {
      status: 'in-dev',
      sessions: [
        { sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000', purpose: 'dev' as const, boundAt: AT },
        { sessionId: 'deadbeef-1234-4abc-9def-aabbccddeeff', purpose: 'dev' as const, boundAt: AT },
      ],
    })
    render(
      <WorkPackageDialog
        t={bindZh()}
        workPackage={workPackage}
        slot={slot()}
        controller={fakeController()}
        requirementId={RID}
        sessions={{ ids: ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000'], summariesById: { 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000': { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000', displayTitle: '会话甲', running: false, blank: false } } }}
        onNavigateSession={onNavigateSession}
        onClose={() => { /* noop */ }}
      />,
    )
    const live = screen.getByRole('button', { name: /aaaaaaaa · 会话甲|aaaaaaaa 会话甲/ })
    fireEvent.click(live)
    expect(onNavigateSession).toHaveBeenCalledTimes(1)
    expect(onNavigateSession).toHaveBeenCalledWith('aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000')
    // 消亡绑定（deadbeef 已离开列表）：只读行——不做假可点。
    expect(screen.queryByRole('button', { name: /deadbeef/ })).toBeNull()
    expect(screen.getByText(/deadbeef/).textContent).toContain(workbenchZh['session.stateGone'])
  })

  it('打开即拉当前版本正文一次；切换版本 chip 再拉对应版本；缓存命中不重复拉', async () => {
    const controller = fakeController()
    const rendered = subject(draftWp(), controller)

    expect(rendered.getByRole('dialog', { name: 'WP1　工作包-WP1' })).toBeTruthy()
    await waitFor(() => expect(controller.planContent).toHaveBeenCalledTimes(1))
    expect(controller.planContent).toHaveBeenCalledWith(RID, 'WP1', 2)

    fireEvent.click(rendered.getByRole('button', { name: `v1 · ${workbenchZh['detail.versionApproved']}` }))
    await waitFor(() => expect(controller.planContent).toHaveBeenCalledWith(RID, 'WP1', 1))
    expect(controller.planContent).toHaveBeenCalledTimes(2)

    // 切回 v2：组件内缓存命中，不再发请求。
    fireEvent.click(rendered.getByRole('button', { name: `v2 · ${workbenchZh['detail.versionCurrent']} · ${workbenchZh['detail.versionDraft']}` }))
    await tick()
    expect(controller.planContent).toHaveBeenCalledTimes(2)
  })

  it('tampered: true → 真词典 detail.tampered 警示条出现', async () => {
    const controller = fakeController({
      planContent: vi.fn(async () => ({ kind: 'ok' as const, content: '# 被外部改过的正文', contentTampered: true })),
    })
    subject(draftWp(), controller)

    expect(await screen.findByText(workbenchZh['detail.tampered'])).toBeTruthy()
  })

  it('404 缺失：尾草稿缺失给出缺失态 + 重试写入（writePlan 落盘）；已批准版本缺失只披露无重试', async () => {
    const controller = fakeController({
      planContent: vi.fn(async () => ({ kind: 'http-error' as const, status: 404 })),
    })
    const rendered = subject(draftWp(), controller)

    expect(await rendered.findByText(workbenchZh['detail.planMissing'])).toBeTruthy()
    fireEvent.click(await rendered.findByRole('button', { name: workbenchZh['detail.planRewrite'] }))
    await waitFor(() => expect(controller.writePlan).toHaveBeenCalledWith(RID, 'WP1', ''))
    rendered.unmount()

    const controller2 = fakeController({
      planContent: vi.fn(async () => ({ kind: 'http-error' as const, status: 404 })),
    })
    const rendered2 = subject(wp('WP1', { plans: [planEntry(1, { approvedAt: AT })] }), controller2)
    expect(await rendered2.findByText(workbenchZh['detail.planMissing'])).toBeTruthy()
    expect(rendered2.queryByRole('button', { name: workbenchZh['detail.planRewrite'] })).toBeNull()
  })

  it('草稿保存：writePlan 落盘并清缓存重拉（忠实服务端模拟：planContent 回最后一次写入内容）', async () => {
    // Faithful server emulation: the reseed after save-refetch must land the
    // SAME text the user saved (production returns identical bytes; a static
    // canned mock would fake a revert that cannot happen).
    let stored = '# 计划正文'
    const controller = fakeController({
      writePlan: vi.fn(async (_rid: string, _wpId: string, text: string) => {
        stored = text
        return true
      }),
      planContent: vi.fn(async () => ({ kind: 'ok' as const, content: stored, contentTampered: false })),
    })
    const rendered = subject(draftWp(), controller)

    const textarea = (await rendered.findByPlaceholderText(workbenchZh['detail.draftPlaceholder'])) as HTMLTextAreaElement
    await waitFor(() => expect(textarea.value).toBe('# 计划正文'))

    fireEvent.change(textarea, { target: { value: '# 新草稿' } })
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['detail.draftSave'] }))
    await waitFor(() => expect(controller.writePlan).toHaveBeenCalledWith(RID, 'WP1', '# 新草稿'))
    expect(textarea.value).toBe('# 新草稿')

    // 保存成功 → 缓存全清 + refetchNonce 触发重拉（修复后的契约：正文区
    // 不落常驻 loading，编辑器随重拉重播种）。
    await waitFor(() => expect(controller.planContent).toHaveBeenCalledTimes(2))
  })

  it('硬门②：有尾草稿 → footer 批准计划 → controller.approvePlan；全批准/无 plans 不出现', async () => {
    const controller = fakeController()
    const rendered = subject(draftWp(), controller)

    fireEvent.click(await rendered.findByRole('button', { name: workbenchZh['detail.approvePlan'] }))
    await waitFor(() => expect(controller.approvePlan).toHaveBeenCalledWith(RID, 'WP1'))
    rendered.unmount()

    const rendered2 = subject(wp('WP1', { plans: [planEntry(1, { approvedAt: AT })] }))
    expect(rendered2.queryByRole('button', { name: workbenchZh['detail.approvePlan'] })).toBeNull()
    rendered2.unmount()

    const rendered3 = subject(wp('WP1', { plans: [] }))
    expect(rendered3.getByText(workbenchZh['detail.noPlans'])).toBeTruthy()
    expect(rendered3.queryByRole('button', { name: workbenchZh['detail.approvePlan'] })).toBeNull()
    expect(rendered3.queryByPlaceholderText(workbenchZh['detail.draftPlaceholder'])).toBeNull()
  })

  it('footer 生命周期按 status：plan-approved→「开始开发」开 dev 任务书 Modal（零账本写，后翻状态）；planned→无开始开发（规划入口在计划节/看板）；in-dev→标记完成待验收；accepted→重开', async () => {
    // 0018 合并轮（合并对象=dev 任务书与开始开发）：点击只开 Modal，翻状态
    // 在投递成功的 onDelivered 处。
    const controller = fakeController()
    const onOpenSow = vi.fn()
    const rendered = render(
      <WorkPackageDialog
        t={bindZh()}
        workPackage={wp('WP1', { status: 'plan-approved', plans: [planEntry(1, { approvedAt: AT })] })}
        slot={slot()}
        controller={controller}
        requirementId={RID}
        onOpenSow={onOpenSow}
        onClose={() => { /* noop */ }}
      />,
    )
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['detail.startWork'] }))
    expect(onOpenSow).toHaveBeenCalledWith(expect.objectContaining({ id: 'WP1' }), 'dev')
    expect(controller.startWorkPackage).not.toHaveBeenCalled() // 后翻状态：点击零账本写
    rendered.unmount()

    // planned 态 footer 无「开始开发」（不在合并范围）。
    const planned = subject(wp('WP1', { status: 'planned', plans: [] }))
    expect(planned.queryByRole('button', { name: workbenchZh['detail.startWork'] })).toBeNull()
    planned.unmount()

    const cases: Array<{
      status: WorkbenchWorkPackage['status']
      button: string
      call: 'markWorkPackageBuilt' | 'reopenWorkPackage'
    }> = [
      { status: 'in-dev', button: workbenchZh['detail.markBuilt'], call: 'markWorkPackageBuilt' },
      { status: 'accepted', button: workbenchZh['detail.reopen'], call: 'reopenWorkPackage' },
    ]
    for (const testCase of cases) {
      const controller2 = fakeController()
      const rendered2 = subject(wp('WP1', { status: testCase.status, plans: [] }), controller2)
      fireEvent.click(rendered2.getByRole('button', { name: testCase.button }))
      await waitFor(() => expect(controller2[testCase.call]).toHaveBeenCalledWith(RID, 'WP1'))
      rendered2.unmount()
    }
  })

  it('planned → 放弃走确认 Modal → dropWorkPackage；dropped → 无生命周期按钮', async () => {
    const controller = fakeController()
    const rendered = subject(wp('WP1', { status: 'planned', plans: [] }), controller)

    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['detail.drop'] }))
    const dropDialog = rendered.getByRole('dialog', { name: workbenchZh['detail.dropTitle'] })
    fireEvent.click(within(dropDialog).getByRole('button', { name: workbenchZh['detail.drop'] }))
    await waitFor(() => expect(controller.dropWorkPackage).toHaveBeenCalledWith(RID, 'WP1'))
    rendered.unmount()

    const rendered2 = subject(wp('WP1', { status: 'dropped', plans: [] }))
    for (const name of [workbenchZh['detail.startWork'], workbenchZh['detail.markBuilt'], workbenchZh['detail.reopen'], workbenchZh['detail.drop']]) {
      expect(rendered2.queryByRole('button', { name })).toBeNull()
    }
    // 退回修改常在（关窗路径）。
    expect(rendered2.getByRole('button', { name: workbenchZh['detail.returnForEdit'] })).toBeTruthy()
  })

  it('验收节：built 态出现通过/不通过 + builtSourceManual 披露；acceptances 历史行（fail 带原因）', async () => {
    const controller = fakeController()
    const rendered = subject(
      wp('WP1', {
        status: 'built',
        plans: [planEntry(1, { approvedAt: AT })],
        acceptances: [
          { at: AT, result: 'pass' },
          { at: '2026-09-29T09:00:00.000Z', result: 'fail', note: '越界改动需返工' },
        ],
      }),
      controller,
    )

    expect(await rendered.findByText(workbenchZh['detail.builtSourceManual'])).toBeTruthy()
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['board.accept'] }))
    await waitFor(() => expect(controller.acceptWorkPackage).toHaveBeenCalledWith(RID, 'WP1', 'pass'))

    expect(rendered.getByText('越界改动需返工')).toBeTruthy()
    expect(rendered.getByText(workbenchZh['detail.acceptancePass'], { exact: true })).toBeTruthy()
    // reject 按钮 + fail 历史 Tag 各一处。
    expect(rendered.getAllByText(workbenchZh['detail.acceptanceFail'])).toHaveLength(2)
  })

  it('0019 D2-C：验收节常驻「送返工话」——in-dev∧尾 fail∧尾 dev 绑定存活才出现，点击 onSendRework(wpId)；尾 pass/built 态/绑定消亡均退役', () => {
    const onSendRework = vi.fn()
    const devSession = { sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000', purpose: 'dev' as const, boundAt: AT }
    const liveSessions = { ids: ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000'], summariesById: { 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000': { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000', displayTitle: '会话甲', running: false, blank: false } } }
    const dialog = (workPackage: WorkbenchWorkPackage, sessions?: { ids: readonly string[]; summariesById: Readonly<Record<string, { id: string; displayTitle: string; running: boolean; blank: boolean } | undefined>> }) => render(
      <WorkPackageDialog
        t={bindZh()}
        workPackage={workPackage}
        slot={slot()}
        controller={fakeController()}
        requirementId={RID}
        sessions={sessions}
        onSendRework={onSendRework}
        onClose={() => { /* noop */ }}
      />,
    )

    const ready = dialog(wp('WP1', { status: 'in-dev', sessions: [devSession], acceptances: [{ at: AT, result: 'fail', note: '超时' }] }), liveSessions)
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['rework.send'] }))
    expect(onSendRework).toHaveBeenCalledWith('WP1')
    ready.unmount()

    const passTail = dialog(wp('WP1', { status: 'in-dev', sessions: [devSession], acceptances: [{ at: AT, result: 'pass' }] }), liveSessions)
    expect(passTail.queryByRole('button', { name: workbenchZh['rework.send'] })).toBeNull()
    passTail.unmount()

    // built 态（尾 fail 在场）⇒ 退役——验收中不是返工面。
    const built = dialog(wp('WP1', { status: 'built', sessions: [devSession], acceptances: [{ at: AT, result: 'fail', note: '超时' }] }), liveSessions)
    expect(built.queryByRole('button', { name: workbenchZh['rework.send'] })).toBeNull()
    built.unmount()

    // 绑定消亡（sessions 面在场但 summary 解析不到）⇒ 退役——正路是收件箱存疑行的补投。
    const gone = dialog(wp('WP1', { status: 'in-dev', sessions: [devSession], acceptances: [{ at: AT, result: 'fail', note: '超时' }] }), { ids: [], summariesById: {} })
    expect(gone.queryByRole('button', { name: workbenchZh['rework.send'] })).toBeNull()
  })

  it('0019 D2-C：详情拒绝提交 await-ok 跟进——记录成功且有 dev 绑定才 onSendRework；失败零跟进', async () => {
    const devSession = { sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000', purpose: 'dev' as const, boundAt: AT }
    const rejectFlow = (controller: WorkbenchController, onSendRework: (id: string) => void) => render(
      <WorkPackageDialog
        t={bindZh()}
        workPackage={wp('WP1', { status: 'built', sessions: [devSession] })}
        slot={slot()}
        controller={controller}
        requirementId={RID}
        onSendRework={onSendRework}
        onClose={() => { /* noop */ }}
      />,
    )

    const ok = vi.fn()
    const rendered = rejectFlow(fakeController(), ok)
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['board.reject'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['board.rejectTitle'] })
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['board.rejectReasonLabel']), { target: { value: '越界改动需返工' } })
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['board.rejectSubmit'] }))
    await waitFor(() => expect(ok).toHaveBeenCalledWith('WP1'))
    rendered.unmount()

    const failed = vi.fn()
    const failingController = fakeController({ acceptWorkPackage: vi.fn(async () => false) })
    const rendered2 = rejectFlow(failingController, failed)
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['board.reject'] }))
    const dialog2 = screen.getByRole('dialog', { name: workbenchZh['board.rejectTitle'] })
    fireEvent.change(within(dialog2).getByLabelText(workbenchZh['board.rejectReasonLabel']), { target: { value: '越界改动需返工' } })
    fireEvent.click(within(dialog2).getByRole('button', { name: workbenchZh['board.rejectSubmit'] }))
    await waitFor(() => expect(failingController.acceptWorkPackage).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(failed).not.toHaveBeenCalled()
  })

  it('版本链行：当前/草稿/归档/已批准 Tag 正确（链尾 v3 草稿、v2 归档、v1 已批准）', () => {
    const rendered = subject(
      wp('WP1', {
        status: 'plan-draft',
        plans: [planEntry(3), planEntry(2), planEntry(1, { approvedAt: AT })],
      }),
    )

    expect(rendered.getByRole('button', { name: `v3 · ${workbenchZh['detail.versionCurrent']} · ${workbenchZh['detail.versionDraft']}` })).toBeTruthy()
    expect(rendered.getByRole('button', { name: `v2 · ${workbenchZh['detail.versionArchived']}` })).toBeTruthy()
    expect(rendered.getByRole('button', { name: `v1 · ${workbenchZh['detail.versionApproved']}` })).toBeTruthy()
  })

  it('0018 刀二（恢复）：无已批准计划（planned）——wp-plan 入口直通；dev 入口走 ack 确认（取消不投递/确认直投 dev）；规划按钮先行', () => {
    const onOpenSow = vi.fn()
    render(
      <WorkPackageDialog
        t={bindZh()}
        workPackage={wp('WP1', { status: 'planned' })}
        slot={slot()}
        controller={fakeController()}
        requirementId={RID}
        onOpenSow={onOpenSow}
        onClose={() => { /* noop */ }}
      />,
    )

    // 按钮顺序：规划先行（hasApprovedPlan=false 的分层）。
    const buttons = screen.getAllByRole('button')
    expect(buttons.findIndex((button) => button.textContent === workbenchZh['sow.wpPlanButton']))
      .toBeLessThan(buttons.findIndex((button) => button.textContent === workbenchZh['sow.workPackageButton']))

    // wp-plan 直通（无 ack）。
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['sow.wpPlanButton'] }))
    expect(onOpenSow).toHaveBeenCalledTimes(1)
    expect(onOpenSow).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'WP1' }), 'wp-plan')

    // dev → ack Modal 出现；取消不投递（footer 取消与右上角关闭同文案，任一即可关——取后者避歧义）。
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['sow.workPackageButton'] }))
    const ack = screen.getByRole('dialog', { name: workbenchZh['detail.devNoPlanAckTitle'] })
    expect(within(ack).getByText(workbenchZh['detail.devNoPlanAckBody'])).toBeTruthy()
    fireEvent.click(within(ack).getAllByRole('button', { name: workbenchZh['action.cancel'] }).at(-1)!)
    expect(onOpenSow).toHaveBeenCalledTimes(1)

    // 再走 ack → 确认直投 dev。
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['sow.workPackageButton'] }))
    const ack2 = screen.getByRole('dialog', { name: workbenchZh['detail.devNoPlanAckTitle'] })
    fireEvent.click(within(ack2).getByRole('button', { name: workbenchZh['detail.devNoPlanAckConfirm'] }))
    expect(onOpenSow).toHaveBeenCalledTimes(2)
    expect(onOpenSow).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'WP1' }), 'dev')
  })

  it('0018 合并轮：plan-approved 计划节 dev 按钮退役（正路=footer「开始开发」）、规划按钮保留（重规划入口）；in-dev 补投直通无 ack；来源会话行在场（前 8 位）', () => {
    // plan-approved：计划节无 dev 按钮（与 footer「开始开发」合一），wp-plan 保留。
    const onOpenSowApproved = vi.fn()
    const approved = render(
      <WorkPackageDialog
        t={bindZh()}
        workPackage={wp('WP1', { status: 'plan-approved', plans: [planEntry(1, { approvedAt: AT })] })}
        slot={slot()}
        controller={fakeController()}
        requirementId={RID}
        onOpenSow={onOpenSowApproved}
        onClose={() => { /* noop */ }}
      />,
    )
    expect(approved.queryByRole('button', { name: workbenchZh['sow.workPackageButton'] })).toBeNull()
    expect(approved.getByRole('button', { name: workbenchZh['sow.wpPlanButton'] })).toBeTruthy()
    // footer「开始开发」是 dev 入口（直通无 ack）。
    fireEvent.click(approved.getByRole('button', { name: workbenchZh['detail.startWork'] }))
    expect(onOpenSowApproved).toHaveBeenCalledWith(expect.objectContaining({ id: 'WP1' }), 'dev')
    expect(approved.queryByRole('dialog', { name: workbenchZh['detail.devNoPlanAckTitle'] })).toBeNull()
    approved.unmount()

    // in-dev 补投：计划节 dev 按钮直通（无 ack）；来源会话行在场。
    const onOpenSowDev = vi.fn()
    render(
      <WorkPackageDialog
        t={bindZh()}
        workPackage={wp('WP1', {
          status: 'in-dev',
          plans: [planEntry(1, { approvedAt: AT })],
          planSeed: { session: { sessionId: 'sess-plan-delivery', boundAt: AT }, contentHash: 'a'.repeat(64), seededAt: AT },
        })}
        slot={slot()}
        controller={fakeController()}
        requirementId={RID}
        onOpenSow={onOpenSowDev}
        onClose={() => { /* noop */ }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['sow.workPackageButton'] }))
    expect(onOpenSowDev).toHaveBeenCalledTimes(1)
    expect(onOpenSowDev).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'WP1' }), 'dev')
    expect(screen.queryByRole('dialog', { name: workbenchZh['detail.devNoPlanAckTitle'] })).toBeNull()
    expect(screen.getByText(workbenchZh['detail.planSeedSource'].replaceAll('{id}', 'sess-pla'))).toBeTruthy()
  })

  it('0018 缺陷修复：AI 尾草稿（planSeed 哈希指名尾版本）missing 面板=「重新收取」（reseedWpPlan，不从 textarea 重写）；人工尾草稿保持「重试写入」', async () => {
    // AI 尾草稿：planSeed.contentHash === 尾草稿 contentHash；正文 404 + exists=false ⇒ missing 面。
    const aiWp = wp('WP1', {
      status: 'plan-draft',
      plans: [planEntry(1, { contentHash: 'a'.repeat(64) })],
      planSeed: { session: { sessionId: 'sess-plan', boundAt: AT }, contentHash: 'a'.repeat(64), seededAt: AT },
    })
    const controller = fakeController({
      planContent: vi.fn(async () => ({ kind: 'http-error' as const, status: 404 })),
    })
    const { unmount } = subject(aiWp, controller, slot({ planFileExists: [{ workPackageId: 'WP1', version: 1, exists: false }] }))
    await tick()
    expect(screen.getByText(workbenchZh['detail.planMissing'])).toBeTruthy()
    expect(screen.getByRole('button', { name: workbenchZh['detail.planReseed'] })).toBeTruthy()
    expect(screen.queryByRole('button', { name: workbenchZh['detail.planRewrite'] })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['detail.planReseed'] }))
    await waitFor(() => expect(controller.reseedWpPlan).toHaveBeenCalledWith(RID, 'WP1'))
    expect(controller.writePlan).not.toHaveBeenCalled()
    unmount()

    // 人工尾草稿（无 planSeed）：missing 面板保持「重试写入」（textarea 语义），无「重新收取」。
    const manualWp = wp('WP1', { status: 'plan-draft', plans: [planEntry(1)] })
    const controller2 = fakeController({
      planContent: vi.fn(async () => ({ kind: 'http-error' as const, status: 404 })),
    })
    subject(manualWp, controller2, slot({ planFileExists: [{ workPackageId: 'WP1', version: 1, exists: false }] }))
    await tick()
    expect(screen.getByRole('button', { name: workbenchZh['detail.planRewrite'] })).toBeTruthy()
    expect(screen.queryByRole('button', { name: workbenchZh['detail.planReseed'] })).toBeNull()
  })
})
