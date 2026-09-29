// @vitest-environment jsdom
/**
 * S1 验收标准节（0006 第二刀 client 组件测试）：行渲染 + 覆盖 chips
 * （← WP1，coveredBy 是 host 侧投影）+ 无覆盖行的 warn 高亮与「尚无工作
 * 包覆盖」chip、添加/编辑（keyed remount 播种）/删除的 controller 断言、
 * 硬门①批准后整节只读、sourceSection 可选键的精确 body 形状。
 *
 * 全部断言走真词典 workbenchZh；Modal 内容 portal 到 body，RTL 在 vitest
 * 下无自动 cleanup，afterEach 显式清理。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { WorkbenchCriterion, WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import type { WorkbenchController } from '../../src/client/workbench/controller.js'
import type { RequirementWorkbenchState } from '../../src/client/workbench/store.js'
import { CriteriaSection } from '../../src/client/workbench/criteria-section.js'

const RID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-09-29T08:00:00.000Z'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

function criterion(id: string, overrides: Partial<WorkbenchCriterion> = {}): WorkbenchCriterion {
  return { id, text: `标准-${id}`, coveredBy: [], ...overrides }
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

function subject(s: RequirementWorkbenchState, controller: WorkbenchController = fakeController()) {
  return {
    ...render(<CriteriaSection t={bindZh()} slot={s} controller={controller} requirementId={RID} />),
    controller,
  }
}

describe('CriteriaSection（S1 验收标准）', () => {
  it('行渲染：C1 文本 + 覆盖 chip（← WP1）；无覆盖行高亮类 + 「尚无工作包覆盖」chip', () => {
    subject(slot({ record: record({ criteria: [criterion('C1', { coveredBy: ['WP1'] }), criterion('C2')] }) }))

    // 注：getByText 的 DOM 侧归一化会把全角空格折叠成单 ASCII 空格，而
    // 查询串不做归一化——行标题断言统一用半角空格书写。
    expect(screen.getByText('C1 标准-C1')).toBeTruthy()
    expect(screen.getByText('← WP1')).toBeTruthy()
    expect(screen.getByText(workbenchZh['criteria.uncovered'])).toBeTruthy()

    // 无覆盖行挂 warn 高亮类（criterionRowHole），有覆盖行只有基类。
    const coveredRow = (screen.getByText('C1 标准-C1').parentElement as HTMLElement).parentElement as HTMLElement
    const holeRow = (screen.getByText('C2 标准-C2').parentElement as HTMLElement).parentElement as HTMLElement
    expect(holeRow.className.split(' ')).toHaveLength(2)
    expect(coveredRow.className.split(' ')).toHaveLength(1)
    expect(holeRow.className).not.toBe(coveredRow.className)
  })

  it('添加：＋ → Modal 填 text → controller.saveCriterion(rid, { text })（可选键缺席的精确形状）', async () => {
    const { controller } = subject(slot({ record: record() }))

    fireEvent.click(screen.getByRole('button', { name: workbenchZh['criteria.add'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['criteria.addTitle'] })
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['criteria.textLabel']), { target: { value: '  导入文件需校验表头  ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['action.save'] }))

    await waitFor(() => expect(controller.saveCriterion).toHaveBeenCalledWith(RID, { text: '导入文件需校验表头' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('编辑：Menu 编辑 → Modal 播种旧 text（keyed remount）→ 保存调用带 id', async () => {
    const { controller } = subject(slot({ record: record({ criteria: [criterion('C1', { coveredBy: ['WP1'] })] }) }))

    fireEvent.click(screen.getByRole('button', { name: 'C1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: workbenchZh['menu.edit'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['criteria.editTitle'] })
    const textarea = within(dialog).getByLabelText(workbenchZh['criteria.textLabel']) as HTMLTextAreaElement
    expect(textarea.value).toBe('标准-C1')

    fireEvent.change(textarea, { target: { value: '修改后的标准' } })
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['action.save'] }))
    await waitFor(() => expect(controller.saveCriterion).toHaveBeenCalledWith(RID, { id: 'C1', text: '修改后的标准' }))
  })

  it('删除：Menu 删除 → 确认 Modal → controller.removeCriterion', async () => {
    const { controller } = subject(slot({ record: record({ criteria: [criterion('C1')] }) }))

    fireEvent.click(screen.getByRole('button', { name: 'C1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: workbenchZh['menu.remove'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['criteria.removeTitle'] })
    expect(dialog.textContent).toContain('C1 标准-C1')
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['action.confirm'] }))
    await waitFor(() => expect(controller.removeCriterion).toHaveBeenCalledWith(RID, 'C1'))
  })

  it('splitApprovedAt 已设：无＋按钮、无行 Menu（整节只读）+ 锁定成因提示（不无声消失）', () => {
    subject(slot({ record: record({ splitApprovedAt: AT, criteria: [criterion('C1'), criterion('C2')] }) }))

    expect(screen.queryByRole('button', { name: workbenchZh['criteria.add'] })).toBeNull()
    expect(screen.queryByRole('button', { name: 'C1' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'C2' })).toBeNull()
    // 行本身仍可读；按钮的位置换成锁定成因提示（诚实 UI：锁的成因在 S2，此处必须自解释）。
    expect(screen.getByText('C1 标准-C1')).toBeTruthy()
    expect(screen.getByText(workbenchZh['criteria.lockedHint'])).toBeTruthy()
  })

  it('sourceSection 填写时进入 body（与用例 2 的缺席形状共同钉死可选键双向）', async () => {
    const { controller } = subject(slot({ record: record() }))

    fireEvent.click(screen.getByRole('button', { name: workbenchZh['criteria.add'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['criteria.addTitle'] })
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['criteria.textLabel']), { target: { value: '标准正文' } })
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['criteria.sourceLabel']), { target: { value: ' §2.1 ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['action.save'] }))

    await waitFor(() => expect(controller.saveCriterion).toHaveBeenCalledWith(RID, { text: '标准正文', sourceSection: '§2.1' }))
  })
})
