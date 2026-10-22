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
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { WorkbenchSessionsFace } from '../../src/client/workbench/view.js'
import { ReviewSection } from '../../src/client/workbench/review-section.js'

const RID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-09-27T08:00:00.000Z'

const requirement: RequirementRecord = {
  id: RID,
  title: '报价管理：导入导出与数据校验',
  description: '既有说明',
  workspacePath: '/ws',
  linkedRepos: [],
  createdAt: '2026-09-25T09:30:00.000Z',
  updatedAt: '2026-09-25T09:30:00.000Z',
}

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

function wp(id: string, overrides: Partial<WorkbenchWorkPackage> = {}): WorkbenchWorkPackage {
  return { id, title: `工作包-${id}`, boundary: '', order: 1, dependsOn: [], covers: [], status: 'in-dev', plans: [], sessions: [], commits: [], acceptances: [], ...overrides }
}

const sessionsFace = (): WorkbenchSessionsFace => ({
  ids: ['sess-review'],
  summariesById: { 'sess-review': { id: 'sess-review', displayTitle: '评审·09-27', running: false, blank: false } },
  subscribe: () => () => {},
  navigate: () => {},
})

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
    // importReview returns a ReviewImportOutcome (P5b), not a boolean — the
    // modal reads .ok / .seeded / .blockError for the done-phase disclosure.
    importReview: vi.fn(async () => ({ ok: true as const, reviewId: 'rev-new', seeded: 0 })),
    reviewFetch: vi.fn(async () => ({ kind: 'ok' as const, response: { ok: true as const, text: '# 抓取的报告' } })),
    reviewContent: vi.fn(async () => ({ kind: 'ok' as const, content: '# 评审正文', contentTampered: false })),
    saveReviewVerdict: vi.fn(async () => true),
    removeReviewVerdict: vi.fn(async () => true),
    removeReviewReport: vi.fn(async () => true),
    dismissBanner: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  } as never
}

function subject(s: RequirementWorkbenchState, controller: WorkbenchController = fakeController(), sessions?: WorkbenchSessionsFace) {
  return {
    ...render(<ReviewSection t={bindZh()} requirement={requirement} slot={s} controller={controller} requirementId={RID} sessions={sessions} />),
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
    expect(screen.getByText('发现 0 · 待裁决 0 · confirmed 0 / rejected 0')).toBeTruthy()
    expect(screen.getByText('发现 1 · 待裁决 0 · confirmed 1 / rejected 0')).toBeTruthy()
    expect(screen.getByText('发现 2 · 待裁决 0 · confirmed 1 / rejected 1')).toBeTruthy()
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

describe('S4 评审节：P5b 会话抓取 + 种子披露', () => {
  const boundRecord = (overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord =>
    record({
      workPackages: [wp('WP1', { sessions: [{ sessionId: 'sess-review', purpose: 'review', boundAt: AT }] })],
      ...overrides,
    })

  it('sessions face 缺席 ⇒ 抓取行整块不渲染（诚实降级，粘贴通道常在）', async () => {
    const rendered = subject(slot({ record: boundRecord() }), fakeController())
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['review.importButton'] }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText(workbenchZh['review.sessionLabel'])).toBeNull()
    expect(within(dialog).getByLabelText(workbenchZh['review.bodyLabel'])).toBeTruthy()
  })

  it('有绑定会话 ⇒ 抓取行渲染（0024 滚动列表形）；选中会话抓取填入正文', async () => {
    const controller = fakeController()
    const rendered = subject(slot({ record: boundRecord() }), controller, sessionsFace())
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['review.importButton'] }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(workbenchZh['review.sessionLabel'])).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('radio', { name: /评审·09-27/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['review.fetchButton'] }))
    await waitFor(() => expect(controller.reviewFetch).toHaveBeenCalledWith('sess-review'))
    await waitFor(() => expect((within(dialog).getByLabelText(workbenchZh['review.bodyLabel']) as HTMLTextAreaElement).value).toBe('# 抓取的报告'))
  })

  it('抓取 missing 各态披露对应文案（no-review-block 仍非致命，正文可手填）', async () => {
    for (const [missing, key] of [
      ['no-service', 'review.fetchNoService'],
      ['not-found', 'review.fetchNotFound'],
      ['no-review-block', 'review.fetchNoBlock'],
    ] as const) {
      const controller = fakeController({
        reviewFetch: vi.fn(async () => ({ kind: 'ok' as const, response: { ok: true as const, missing } })),
      })
      const rendered = subject(slot({ record: boundRecord() }), controller, sessionsFace())
      fireEvent.click(rendered.getByRole('button', { name: workbenchZh['review.importButton'] }))
      const dialog = await screen.findByRole('dialog')
      fireEvent.click(within(dialog).getByRole('radio', { name: /评审·09-27/ }))
      fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['review.fetchButton'] }))
      expect(await within(dialog).findByText(workbenchZh[key])).toBeTruthy()
      cleanup()
    }
  })

  it('导入后 done 披露种子数（有约定块）', async () => {
    const controller = fakeController({
      importReview: vi.fn(async () => ({ ok: true as const, reviewId: 'rev-new', seeded: 3 })),
    })
    const rendered = subject(slot({ record: boundRecord() }), controller)
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['review.importButton'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['review.bodyLabel']), { target: { value: '# 报告' } })
    fireEvent.click(within(dialog).getAllByRole('button', { name: workbenchZh['action.save'] }).at(-1)!)
    await waitFor(() => expect(within(dialog).getByText(workbenchZh['review.seededCount'].replaceAll('{n}', '3'))).toBeTruthy())
  })

  it('导入后 done 披露 blockError 变体（无约定块/语法错——报告照建，种子数披露）', async () => {
    const controller = fakeController({
      importReview: vi.fn(async () => ({ ok: true as const, reviewId: 'rev-new', seeded: 0, blockError: 'no-review-block' as const })),
    })
    const rendered = subject(slot({ record: boundRecord() }), controller)
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['review.importButton'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['review.bodyLabel']), { target: { value: '# 纯报告' } })
    fireEvent.click(within(dialog).getAllByRole('button', { name: workbenchZh['action.save'] }).at(-1)!)
    await waitFor(() => expect(within(dialog).getByText(workbenchZh['review.seededWithBlockError'].replaceAll('{n}', '0'))).toBeTruthy())
  })

  it('0023：done 状态行连带核验计数（seededChecks 在场时追加）', async () => {
    const controller = fakeController({
      importReview: vi.fn(async () => ({ ok: true as const, reviewId: 'rev-new', seeded: 2, seededChecks: 4 })),
    })
    const rendered = subject(slot({ record: boundRecord() }), controller)
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['review.importButton'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['review.bodyLabel']), { target: { value: '# 报告' } })
    fireEvent.click(within(dialog).getAllByRole('button', { name: workbenchZh['action.save'] }).at(-1)!)
    // 状态行 = 种子数与核验计数同节点拼接（两个文本子节点），以 textContent 整体断言
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe(
      `${workbenchZh['review.seededCount'].replaceAll('{n}', '2')} · ${workbenchZh['review.seededChecks'].replaceAll('{n}', '4')}`,
    ))
  })
})

describe('S4 评审节：0023 核验行（criteriaChecks 信息面）与证据面（detail 只读）', () => {
  it('报告卡第二 Tag：核验计数（直数不差减）；无 criteriaChecks 的旧报告不渲染核验面', () => {
    subject(slot({ record: record({
      reviewReports: [
        report('rev-new', { title: '新形报告', criteriaChecks: [
          { ref: 'C1', result: 'satisfied' },
          { ref: 'C2', result: 'unmet' },
          { ref: 'C3', result: 'not-verifiable' },
        ] }),
        report('rev-legacy', { title: '旧形报告' }),
      ],
    }) }))
    expect(screen.getByText('核验 1 满足 / 1 不满足 / 1 无法核验')).toBeTruthy()
    // 旧形（0023 前）报告：字段缺席 ⇒ 零渲染（诚实缺席，不造 0/0/0 假面）
    expect(screen.queryByText('核验 0 满足 / 0 不满足 / 0 无法核验')).toBeNull()
  })

  it('详情 Modal：核验表在正文之上（结果 Tag 三态 + ref + 证据行）', async () => {
    const controller = fakeController({
      reviewContent: vi.fn(async () => ({ kind: 'ok' as const, content: '# 评审正文', contentTampered: false })),
    })
    const rendered = subject(slot({ record: record({
      reviewReports: [report('rev-a1', { title: '全量评审', criteriaChecks: [
        { ref: 'C1', result: 'satisfied', evidence: 'src/export/service.ts:30-42' },
        { ref: 'C2', result: 'not-verifiable', evidence: '需人工在浏览器验证' },
        { ref: 'C3', result: 'unmet' },
      ] })],
    }) }), controller)
    fireEvent.click(rendered.getByText('全量评审'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(workbenchZh['review.checksTitle'])).toBeTruthy()
    expect(within(dialog).getByText(workbenchZh['review.checkSatisfied'])).toBeTruthy()
    expect(within(dialog).getByText(workbenchZh['review.checkUnmet'])).toBeTruthy()
    expect(within(dialog).getByText(workbenchZh['review.checkNotVerifiable'])).toBeTruthy()
    expect(within(dialog).getByText(`${workbenchZh['review.checkEvidence']}：src/export/service.ts:30-42`)).toBeTruthy()
    expect(within(dialog).getByText(`${workbenchZh['review.checkEvidence']}：需人工在浏览器验证`)).toBeTruthy()
    // 无证据的核验行不渲染空证据行
    expect(within(dialog).queryByText(`${workbenchZh['review.checkEvidence']}：`)).toBeNull()
  })

  it('裁决表单：proposed 行的证据只读在场，保存原样回传（全行替换不丢证据）', async () => {
    const controller = fakeController()
    const seeded = report('rev-a1', { verdicts: [{ id: 'v-9', title: '事务缺失', severity: 'high', verdict: 'proposed', detail: 'src/export/importer.ts:88 导入与校验不在同一事务' }] })
    const rendered = subject(slot({ record: record({ reviewReports: [seeded] }) }), controller)
    fireEvent.click(rendered.getByText('事务缺失'))
    const dialog = await screen.findByRole('dialog')
    // 证据以只读文本在场（不是输入面）
    expect(within(dialog).getByText('src/export/importer.ts:88 导入与校验不在同一事务')).toBeTruthy()
    fireEvent.click(within(dialog).getAllByRole('button', { name: workbenchZh['action.save'] }).at(-1)!)
    await waitFor(() => expect(controller.saveReviewVerdict).toHaveBeenCalledWith(RID, 'rev-a1', {
      id: 'v-9',
      title: '事务缺失',
      severity: 'high',
      verdict: 'confirmed',
      detail: 'src/export/importer.ts:88 导入与校验不在同一事务',
    }))
  })
})

describe('S4 评审节：0024 自动收取候选与会话/报告列表形', () => {
  // 修订#1：抓取候选=工作区全体会话——含从未绑定的自由会话；空壳过滤
  const reviewSessionsFace = (): WorkbenchSessionsFace => ({
    ids: ['sess-review', 'sess-dev', 'sess-free', 'sess-shell'],
    summariesById: {
      'sess-review': { id: 'sess-review', displayTitle: '评审任务书 · R', running: false, blank: false },
      'sess-dev': { id: 'sess-dev', displayTitle: '工作包任务书 WP1 · R', running: false, blank: false },
      'sess-free': { id: 'sess-free', displayTitle: '手动开的评审会话', running: false, blank: false },
      'sess-shell': { id: 'sess-shell', displayTitle: undefined as unknown as string, running: false, blank: true },
    },
    subscribe: () => () => {},
    navigate: () => {},
  })

  it('会话候选（修订#1）：工作区全体会话在场（未绑定的自由会话也可选）；reviewSession 绑定居首；空壳过滤；滚动单选列表形', async () => {
    const controller = fakeController()
    const rendered = subject(slot({ record: record({
      reviewSession: { sessionId: 'sess-review', boundAt: AT, anchor: '# 评审任务书 · R' },
      workPackages: [wp('WP1', { sessions: [{ sessionId: 'sess-dev', purpose: 'dev', boundAt: AT }] })],
    }) }), controller, reviewSessionsFace())
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['review.importButton'] }))
    const dialog = await screen.findByRole('dialog')
    const radios = within(dialog).getAllByRole('radio')
    // 全体在场：置顶的评审绑定 + dev 绑定 + 未绑定的自由会话；空壳（blank）过滤
    expect(radios).toHaveLength(3)
    expect(radios[0]).toHaveProperty('value', 'sess-review')
    expect(radios[1]).toHaveProperty('value', 'sess-dev')
    expect(radios[2]).toHaveProperty('value', 'sess-free')
    // 自由会话（无任何绑定）同样可抓取
    fireEvent.click(within(dialog).getByRole('radio', { name: /手动开的评审会话/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['review.fetchButton'] }))
    await waitFor(() => expect(controller.reviewFetch).toHaveBeenCalledWith('sess-free'))
  })

  it('会话候选（修订#1）：工作区零会话 ⇒ noSessions 空态提示（粘贴常在）', async () => {
    const emptyFace: WorkbenchSessionsFace = { ids: [], summariesById: {}, subscribe: () => () => {}, navigate: () => {} }
    const rendered = subject(slot({ record: record() }), fakeController(), emptyFace)
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['review.importButton'] }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(workbenchZh['review.noSessions'])).toBeTruthy()
    expect(within(dialog).queryByRole('radio')).toBeNull()
    expect(within(dialog).getByLabelText(workbenchZh['review.bodyLabel'])).toBeTruthy()
  })

  it('裁决表单报告选择：多报告时为滚动单选列表（原生 select 弹层 webview 不滚动的连带修复）', async () => {
    const controller = fakeController()
    const reports = [
      report('rev-b', { title: '第二轮评审', at: '2026-10-22T08:00:00.000Z' }),
      report('rev-a', { title: '首轮评审', at: '2026-10-21T08:00:00.000Z', verdicts: [{ id: 'v-1', title: '旧发现', severity: 'low', verdict: 'confirmed' }] }),
    ]
    const rendered = subject(slot({ record: record({ reviewReports: reports }) }), controller)
    // 打开「添加裁决」——默认挂最新报告（rev-b）
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['review.addVerdict'] }))
    const dialog = await screen.findByRole('dialog')
    const radios = within(dialog).getAllByRole('radio', { name: /轮评审/ })
    expect(radios).toHaveLength(2)
    // 切到首轮评审 → 提交落 rev-a
    fireEvent.click(within(dialog).getByRole('radio', { name: /首轮评审/ }))
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['review.verdictTitleLabel']), { target: { value: '历史发现' } })
    fireEvent.click(within(dialog).getAllByRole('button', { name: workbenchZh['action.save'] }).at(-1)!)
    await waitFor(() => expect(controller.saveReviewVerdict).toHaveBeenCalledWith(RID, 'rev-a', expect.objectContaining({ title: '历史发现' })))
  })
})
