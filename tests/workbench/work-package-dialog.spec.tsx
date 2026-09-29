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

  it('footer 生命周期按 status：plan-approved→开始开发；in-dev→标记完成待验收；accepted→重开', async () => {
    const cases: Array<{
      status: WorkbenchWorkPackage['status']
      button: string
      call: 'startWorkPackage' | 'markWorkPackageBuilt' | 'reopenWorkPackage'
    }> = [
      { status: 'plan-approved', button: workbenchZh['detail.startWork'], call: 'startWorkPackage' },
      { status: 'in-dev', button: workbenchZh['detail.markBuilt'], call: 'markWorkPackageBuilt' },
      { status: 'accepted', button: workbenchZh['detail.reopen'], call: 'reopenWorkPackage' },
    ]
    for (const testCase of cases) {
      const controller = fakeController()
      const rendered = subject(wp('WP1', { status: testCase.status, plans: [] }), controller)
      fireEvent.click(rendered.getByRole('button', { name: testCase.button }))
      await waitFor(() => expect(controller[testCase.call]).toHaveBeenCalledWith(RID, 'WP1'))
      rendered.unmount()
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
})
