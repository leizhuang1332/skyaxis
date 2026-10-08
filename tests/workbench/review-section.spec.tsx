// @vitest-environment jsdom
/**
 * S4 评审节（P4 client 组件测试）：三节渲染（报告卡计数 Tag / 裁决行状态
 * Tag 三态 / 覆盖矩阵 chip 状态后缀与空洞）、导入 Modal payload、裁决
 * Modal 建/编 payload 与 rejected-note 前端拦截、删除确认流、完成口径
 * 翻转、详情 Modal 懒取与 tampered 态。
 *
 * 全部断言走真词典 workbenchZh；Modal portal，afterEach cleanup。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReviewReportEntry, WorkbenchCriterion, WorkbenchRecord, WorkbenchWorkPackage } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import type { WorkbenchController } from '../../src/client/workbench/controller.js'
import type { RequirementWorkbenchState } from '../../src/client/workbench/store.js'
import { ReviewSection } from '../../src/client/workbench/review-section.js'

const RID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-09-27T08:00:00.000Z'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

function wp(id: string, overrides: Partial<WorkbenchWorkPackage> = {}): WorkbenchWorkPackage {
  return { id, title: `工作包-${id}`, boundary: '', order: 1, dependsOn: [], covers: [], status: 'in-dev', plans: [], sessions: [], commits: [], acceptances: [], ...overrides }
}

function report(id: string, overrides: Partial<ReviewReportEntry> = {}): ReviewReportEntry {
  return { id, at: AT, verdicts: [], ...overrides }
}

function record(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: RID,
    stage: 'review',
    stageHistory: [{ stage: 'review', at: AT }],
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
    record: record(),
    planFileExists: [],
    reviewFileExists: [],
    releaseDrifted: [],
    busy: false,
    ...overrides,
  }
}

function fakeController(overrides: Record<string, unknown> = {}): WorkbenchController {
  return {
    importReview: vi.fn(async () => true),
    reviewContent: vi.fn(async () => ({ kind: 'ok' as const, content: '# 评审正文', contentTampered: false })),
    saveReviewVerdict: vi.fn(async () => true),
    removeReviewVerdict: vi.fn(async () => true),
    removeReviewReport: vi.fn(async () => true),
    dismissBanner: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  } as never
}

function subject(s: RequirementWorkbenchState, controller: WorkbenchController = fakeController()) {
  return {
    ...render(<ReviewSection t={bindZh()} slot={s} controller={controller} requirementId={RID} />),
    controller,
  }
}

afterEach(() => {
  cleanup()
})

describe('S4 评审节：三节渲染', () => {
  it('空态：无报告给引导 + 导入按钮；有 criteria 时矩阵渲染且完成口径未完成（空集守卫）', () => {
    const criteria: WorkbenchCriterion[] = [{ id: 'C1', text: '异步导出', coveredBy: ['WP1'] }]
    subject(slot({ record: record({ criteria, workPackages: [wp('WP1')] }) }))
    expect(screen.getByText(workbenchZh['review.empty'])).toBeTruthy()
    expect(screen.getByRole('button', { name: workbenchZh['review.importButton'] })).toBeTruthy()
    expect(screen.getByText(workbenchZh['review.matrixTitle'])).toBeTruthy()
    expect(screen.getByText('已处置 0/0 · 空洞 0')).toBeTruthy()
    expect(screen.getByText(workbenchZh['review.matrixUndone'])).toBeTruthy() // 零裁决行 = 未完成（非空真）
  })

  it('报告卡：计数 Tag 空=info；有未处置 confirmed=warning；全处置=success', () => {
    subject(slot({ record: record({
      reviewReports: [
        report('rev-empty'),
        report('rev-open', { verdicts: [{ id: 'v1', title: 'a', severity: 'high', verdict: 'confirmed' }] }),
        report('rev-done', { verdicts: [
          { id: 'v2', title: 'b', severity: 'low', verdict: 'confirmed', disposition: 'fixed' },
          { id: 'v3', title: 'c', severity: 'low', verdict: 'rejected', note: '路径不可达' },
        ] }),
      ],
    }) }))
    expect(screen.getByText('发现 0 · confirmed 0 / rejected 0')).toBeTruthy()
    expect(screen.getByText('发现 1 · confirmed 1 / rejected 0')).toBeTruthy()
    expect(screen.getByText('发现 2 · confirmed 1 / rejected 1')).toBeTruthy()
  })

  it('裁决行状态 Tag 三态（mockup 原样）：confirmed·已修复 / confirmed·待修复 / rejected：理由', () => {
    subject(slot({ record: record({
      reviewReports: [report('rev-a1', { title: '全量评审', verdicts: [
        { id: 'v1', title: '事务缺失', severity: 'high', verdict: 'confirmed', disposition: 'fixed' },
        { id: 'v2', title: '空指针', severity: 'medium', verdict: 'confirmed', disposition: 'to-fix' },
        { id: 'v3', title: '重复查询', severity: 'low', verdict: 'rejected', note: '已有幂等缓存，路径不可达' },
      ] })],
    }) }))
    expect(screen.getByText('confirmed · 已修复')).toBeTruthy()
    expect(screen.getByText('confirmed · 待修复')).toBeTruthy()
    expect(screen.getByText('rejected：已有幂等缓存，路径不可达')).toBeTruthy()
    expect(screen.getAllByText('全量评审').length).toBeGreaterThanOrEqual(2) // 卡标题 + 裁决 meta 行
  })

  it('覆盖矩阵：chip 带非 accepted 状态后缀、accepted 裸 id、空洞 hollow；完成口径翻转', () => {
    const base = record({
      criteria: [
        { id: 'C1', text: '异步导出', coveredBy: ['WP1', 'WP2'] },
        { id: 'C2', text: '权限全覆盖', coveredBy: [] },
      ],
      workPackages: [wp('WP1', { status: 'accepted' }), wp('WP2', { status: 'built' })],
      reviewReports: [report('rev-a1', { verdicts: [
        { id: 'v1', title: 'a', severity: 'low', verdict: 'rejected', note: 'r' },
      ] })],
    })
    subject(slot({ record: base }))
    expect(screen.getByText('← WP1')).toBeTruthy() // accepted：裸 id
    expect(screen.getByText(`← WP2 · ${workbenchZh['detail.statusBuilt']}`)).toBeTruthy() // 非 accepted：状态后缀
    expect(screen.getByText(workbenchZh['review.holeChip'])).toBeTruthy()
    expect(screen.getByText('已处置 1/1 · 空洞 1')).toBeTruthy()
    expect(screen.getByText(workbenchZh['review.matrixUndone'])).toBeTruthy() // 有空洞

    const covered = record({ ...base, criteria: [{ id: 'C1', text: '异步导出', coveredBy: ['WP1'] }] })
    subject(slot({ record: covered }))
    expect(screen.getByText('已处置 1/1 · 空洞 0')).toBeTruthy()
    expect(screen.getByText(workbenchZh['review.matrixDone'])).toBeTruthy()
  })
})

describe('S4 评审节：导入与详情', () => {
  it('导入 Modal：标题 + 正文 payload；空正文禁提交', async () => {
    const controller = fakeController()
    const rendered = subject(slot(), controller)
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['review.importButton'] }))
    const dialog = await screen.findByRole('dialog')
    const save = within(dialog).getAllByRole('button', { name: workbenchZh['action.save'] }).at(-1)! as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['review.reportTitleLabel']), { target: { value: '全量评审' } })
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['review.bodyLabel']), { target: { value: '# 报告\n发现一处。' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(controller.importReview).toHaveBeenCalledWith(RID, '全量评审', '# 报告\n发现一处。'))
  })

  it('报告卡点击 → 详情 Modal 懒取正文（reviewContent 被调 + tampered 警示；MarkdownText 是 stub，断言止于对话框层）', async () => {
    const controller = fakeController({
      reviewContent: vi.fn(async () => ({ kind: 'ok' as const, content: '# 全量评审\n\n- 发现一', contentTampered: true })),
    })
    const rendered = subject(slot({ record: record({ reviewReports: [report('rev-a1', { title: '全量评审' })] }) }), controller)
    fireEvent.click(rendered.getByText('全量评审'))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(controller.reviewContent).toHaveBeenCalledWith(RID, 'rev-a1'))
    await waitFor(() => expect(within(dialog).getByText(workbenchZh['detail.tampered'])).toBeTruthy())
  })

  it('删除报告走确认 Modal（先关后调）', async () => {
    const controller = fakeController()
    const rendered = subject(slot({ record: record({ reviewReports: [report('rev-a1')] }) }), controller)
    fireEvent.click(rendered.getByRole('button', { name: 'rev-a1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: workbenchZh['menu.remove'] }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(workbenchZh['review.removeReportDescription'])).toBeTruthy()
    const confirm = within(dialog).getAllByRole('button', { name: workbenchZh['action.confirm'] })
    fireEvent.click(confirm[confirm.length - 1]!)
    await waitFor(() => expect(controller.removeReviewReport).toHaveBeenCalledWith(RID, 'rev-a1'))
  })
})

describe('S4 评审节：裁决 Modal', () => {
  it('添加：rejected 无理由前端拦截；带理由通过；confirmed + disposition 通过', async () => {
    const controller = fakeController()
    const rendered = subject(slot({ record: record({ reviewReports: [report('rev-a1')] }) }), controller)
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['review.addVerdict'] }))
    let dialog = await screen.findByRole('dialog')

    fireEvent.change(within(dialog).getByLabelText(workbenchZh['review.verdictTitleLabel']), { target: { value: '空指针' } })
    fireEvent.click(within(dialog).getByLabelText(workbenchZh['review.verdictRejected']))
    const save = () => within(dialog).getAllByRole('button', { name: workbenchZh['action.save'] }).at(-1)!
    fireEvent.click(save())
    await waitFor(() => expect(within(dialog).getByText(workbenchZh['review.noteRequired'])).toBeTruthy())
    expect(controller.saveReviewVerdict).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText(workbenchZh['review.noteLabel']), { target: { value: '路径不可达' } })
    fireEvent.click(save())
    await waitFor(() => expect(controller.saveReviewVerdict).toHaveBeenCalledWith(RID, 'rev-a1', { title: '空指针', severity: 'medium', verdict: 'rejected', note: '路径不可达' }))

    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['review.addVerdict'] }))
    dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['review.verdictTitleLabel']), { target: { value: '事务缺失' } })
    fireEvent.click(within(dialog).getByLabelText(/高/))
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['review.dispositionLabel']), { target: { value: 'to-fix' } })
    fireEvent.click(within(dialog).getAllByRole('button', { name: workbenchZh['action.save'] }).at(-1)!)
    await waitFor(() => expect(controller.saveReviewVerdict).toHaveBeenLastCalledWith(RID, 'rev-a1', { title: '事务缺失', severity: 'high', verdict: 'confirmed', disposition: 'to-fix' }))
  })

  it('编辑播种：点击裁决行带 id 提交全量替换', async () => {
    const controller = fakeController()
    const seeded = report('rev-a1', { verdicts: [{ id: 'v-9', title: '空指针', severity: 'medium', verdict: 'confirmed' }] })
    const rendered = subject(slot({ record: record({ reviewReports: [seeded] }) }), controller)
    fireEvent.click(rendered.getByText('空指针'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['review.dispositionLabel']), { target: { value: 'fixed' } })
    fireEvent.click(within(dialog).getAllByRole('button', { name: workbenchZh['action.save'] }).at(-1)!)
    await waitFor(() => expect(controller.saveReviewVerdict).toHaveBeenCalledWith(RID, 'rev-a1', { id: 'v-9', title: '空指针', severity: 'medium', verdict: 'confirmed', disposition: 'fixed' }))
  })

  it('删除裁决行走确认 Modal', async () => {
    const controller = fakeController()
    const seeded = report('rev-a1', { verdicts: [{ id: 'v-9', title: '空指针', severity: 'medium', verdict: 'confirmed' }] })
    const rendered = subject(slot({ record: record({ reviewReports: [seeded] }) }), controller)
    fireEvent.click(rendered.getByRole('button', { name: 'v-9' }))
    fireEvent.click(screen.getByRole('menuitem', { name: workbenchZh['menu.remove'] }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getAllByRole('button', { name: workbenchZh['action.confirm'] })
    fireEvent.click(confirm[confirm.length - 1]!)
    await waitFor(() => expect(controller.removeReviewVerdict).toHaveBeenCalledWith(RID, 'rev-a1', 'v-9'))
  })
})
