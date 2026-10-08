// @vitest-environment jsdom
/**
 * S6 知识库节（P2 client 组件测试）：候选三按钮流（激活开 Modal / 编辑开
 * Modal 播种并落盘 / 丢弃确认断言 payload）、active 列表（触发 Tag 与 scope
 * meta 两形态、RowMenu 归档与编辑）、add 新建流（payload 无 id 带
 * requirementId）、统计四格（跨 WP session 去重 / n/m / fail 计数 / closed
 * 锚定与未关闭走当前时间）、空态两节、knowledge 切片 load-error 与
 * degraded 降级（候选与统计不受 knowledge 切片故障牵连）。
 *
 * 全部断言走真词典 workbenchZh；Modal 内容 portal 到 body，RTL 在 vitest
 * 下无自动 cleanup，afterEach 显式清理。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { KnowledgeCandidate, WorkbenchFinding, WorkbenchKnowledgeRecord, WorkbenchRecord, WorkbenchWorkPackage } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import type { WorkbenchController } from '../../src/client/workbench/controller.js'
import type { KnowledgeSliceState, RequirementWorkbenchState } from '../../src/client/workbench/store.js'
import { KnowledgeSection } from '../../src/client/workbench/knowledge-section.js'

const RID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-09-29T08:00:00.000Z'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

const requirement = {
  id: RID,
  title: '报价管理：导入导出与数据校验',
  description: '既有说明',
  workspacePath: '/ws',
  linkedRepos: [],
  createdAt: '2026-09-25T09:30:00.000Z',
  updatedAt: '2026-09-25T09:30:00.000Z',
}

function candidate(id: string, overrides: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  return { id, title: `候选-${id}`, draft: `草案-${id}`, type: 'business', at: AT, status: 'pending', ...overrides }
}

function knowledgeRow(id: string, overrides: Partial<WorkbenchKnowledgeRecord> = {}): WorkbenchKnowledgeRecord {
  return {
    id,
    scope: 'requirement',
    type: 'business',
    title: `知识-${id}`,
    content: `内容-${id}`,
    requirementId: RID,
    trigger: { mode: 'always' },
    status: 'active',
    provenance: { at: AT },
    ...overrides,
  }
}

function finding(id: string, status: WorkbenchFinding['status']): WorkbenchFinding {
  return { id, category: 'risk', severity: 'medium', title: `发现-${id}`, detail: '…', status, createdAt: AT }
}

function workPackage(id: string, sessionIds: readonly string[], failCount: number): WorkbenchWorkPackage {
  return {
    id,
    title: `包-${id}`,
    boundary: '…',
    order: 1,
    dependsOn: [],
    covers: [],
    status: 'accepted',
    plans: [],
    commits: [],
    acceptances: Array.from({ length: failCount }, () => ({ at: AT, result: 'fail' as const })),
    sessions: sessionIds.map((sessionId) => ({ sessionId, purpose: 'dev' as const, boundAt: AT })),
  }
}

function record(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: RID,
    stage: 'retro',
    stageHistory: [{ stage: 'retro', at: AT }],
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

function knowledge(overrides: Partial<KnowledgeSliceState> = {}): KnowledgeSliceState {
  return { phase: 'ready', revision: 1, records: [], ...overrides }
}

function fakeController(overrides: Record<string, unknown> = {}): WorkbenchController {
  return {
    open: vi.fn(async () => undefined),
    openKnowledge: vi.fn(async () => undefined),
    activateKnowledgeCandidate: vi.fn(async () => true),
    editKnowledgeCandidate: vi.fn(async () => true),
    dismissKnowledgeCandidate: vi.fn(async () => true),
    saveKnowledge: vi.fn(async () => true),
    archiveKnowledge: vi.fn(async () => true),
    dismissBanner: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  } as never
}

// vitest 未开 globals，RTL 的自动 cleanup 不生效；Modal portal 进 body，
// 不显式清理会让后一个用例看见前一个用例残留的 dialog（0003 P2 同款坑）。
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function subject(s: RequirementWorkbenchState, k: KnowledgeSliceState = knowledge(), controller: WorkbenchController = fakeController()) {
  return {
    ...render(<KnowledgeSection t={bindZh()} requirement={requirement} slot={s} knowledge={k} controller={controller} requirementId={RID} />),
    controller,
  }
}

describe('KnowledgeSection（S6 知识库三节）', () => {
  it('候选卡：type Tag + 标题 + draft 前缀摘要 + proposedSession 仅在有值时出现', () => {
    subject(slot({ record: record({ knowledgeCandidates: [candidate('c1'), candidate('c2', { type: 'convention', proposedSessionId: 'sess-9' })] }) }))

    expect(screen.getByText('候选-c1')).toBeTruthy()
    expect(screen.getByText('draft：草案-c1')).toBeTruthy()
    expect(screen.getByText(workbenchZh['knowledge.typeBusiness'])).toBeTruthy()
    expect(screen.getByText(workbenchZh['knowledge.typeConvention'])).toBeTruthy()
    expect(screen.getByText('提议 session：sess-9')).toBeTruthy()
    // c1 无 proposedSessionId ⇒ 前缀只出现一次（c2 的那份）。
    expect(screen.getAllByText(/提议 session：/)).toHaveLength(1)
  })

  it('激活：primary 按钮 → 激活 Modal 在场（作用域/类型/触发三组 radio）；取消关闭', () => {
    subject(slot({ record: record({ knowledgeCandidates: [candidate('c1')] }) }))

    fireEvent.click(screen.getByRole('button', { name: workbenchZh['knowledge.activate'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['knowledge.activateTitle'] })
    // 三组 radio 的组头（作用域/类型/触发）在场 + 各组首项可寻址（radio 细节归 activate spec）。
    expect(within(dialog).getByText(workbenchZh['knowledge.scopeLabel'])).toBeTruthy()
    expect(within(dialog).getByText(workbenchZh['knowledge.typeLabel'])).toBeTruthy()
    expect(within(dialog).getByText(workbenchZh['knowledge.triggerLabel'])).toBeTruthy()
    expect(within(dialog).getByLabelText(workbenchZh['knowledge.scopeRequirement'])).toBeTruthy()

    // 两处「取消」（头部关闭 + footer ghost），点 footer 那枚。
    const cancelButtons = within(dialog).getAllByRole('button', { name: workbenchZh['action.cancel'] })
    fireEvent.click(cancelButtons[cancelButtons.length - 1]!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('编辑：ghost 按钮 → 候选编辑 Modal 播种 title/draft → 保存调 editKnowledgeCandidate（payload 精确形状）', async () => {
    const { controller } = subject(slot({ record: record({ knowledgeCandidates: [candidate('c1')] }) }))

    fireEvent.click(screen.getByRole('button', { name: workbenchZh['knowledge.edit'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['knowledge.edit'] })
    const title = within(dialog).getByLabelText(workbenchZh['knowledge.titleLabel']) as HTMLInputElement
    const draft = within(dialog).getByLabelText(workbenchZh['knowledge.contentLabel']) as HTMLTextAreaElement
    expect(title.value).toBe('候选-c1')
    expect(draft.value).toBe('草案-c1')

    fireEvent.change(title, { target: { value: '改题' } })
    fireEvent.change(draft, { target: { value: '改稿' } })
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['action.save'] }))
    await waitFor(() => expect(controller.editKnowledgeCandidate).toHaveBeenCalledWith(RID, 'c1', { title: '改题', draft: '改稿', type: 'business' }))
  })

  it('丢弃：danger ghost → 确认 Modal（dropTitle）→ confirm 调 dismissKnowledgeCandidate', async () => {
    const { controller } = subject(slot({ record: record({ knowledgeCandidates: [candidate('c1')] }) }))

    fireEvent.click(screen.getByRole('button', { name: workbenchZh['knowledge.drop'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['knowledge.dropTitle'] })
    expect(dialog.textContent).toContain(workbenchZh['knowledge.dropDescription'])
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['action.confirm'] }))
    await waitFor(() => expect(controller.dismissKnowledgeCandidate).toHaveBeenCalledWith(RID, 'c1'))
  })

  it('空态两节：无 pending 候选与无 active 行各自出现空态文案', () => {
    subject(slot({ record: record() }), knowledge())

    expect(screen.getByText(workbenchZh['knowledge.emptyCandidates'])).toBeTruthy()
    expect(screen.getByText(workbenchZh['knowledge.emptyActive'])).toBeTruthy()
  })

  it('active 列表：keyword 触发 Tag 带值、manual Tag 裸名；scope meta 两形态（requirement 短句 / global 带激活日期）', () => {
    subject(
      slot({ record: record() }),
      knowledge({ records: [
        knowledgeRow('k1', { trigger: { mode: 'keyword', value: '导出' } }),
        knowledgeRow('k2', { scope: 'global', requirementId: undefined, trigger: { mode: 'manual' }, provenance: { at: '2026-09-20T10:00:00.000Z' } }),
      ] }),
    )

    expect(screen.getByText('keyword: 导出')).toBeTruthy()
    expect(screen.getByText('manual')).toBeTruthy()
    expect(screen.getByText('知识-k1')).toBeTruthy()
    expect(screen.getByText(workbenchZh['knowledge.metaRequirement'])).toBeTruthy()
    expect(screen.getByText(`${workbenchZh['knowledge.metaGlobal']} · ${workbenchZh['knowledge.activatedAtPrefix']} 2026-09-20`)).toBeTruthy()
  })

  it('归档：RowMenu 归档 → 确认 Modal（archiveDescription）→ archiveKnowledge(RID, id)', async () => {
    const { controller } = subject(slot({ record: record() }), knowledge({ records: [knowledgeRow('k1')] }))

    fireEvent.click(screen.getByRole('button', { name: '知识-k1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: workbenchZh['knowledge.archive'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['knowledge.archiveTitle'] })
    expect(dialog.textContent).toContain(workbenchZh['knowledge.archiveDescription'])
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['action.confirm'] }))
    await waitFor(() => expect(controller.archiveKnowledge).toHaveBeenCalledWith(RID, 'k1'))
  })

  it('active 行编辑：RowMenu 编辑 → form Modal 播种（formTitleEdit）→ saveKnowledge 带 id 的完整 payload', async () => {
    const { controller } = subject(slot({ record: record() }), knowledge({ records: [knowledgeRow('k1')] }))

    fireEvent.click(screen.getByRole('button', { name: '知识-k1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: workbenchZh['menu.edit'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['knowledge.formTitleEdit'] })
    expect((within(dialog).getByLabelText(workbenchZh['knowledge.titleLabel']) as HTMLInputElement).value).toBe('知识-k1')
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['action.save'] }))
    await waitFor(() => expect(controller.saveKnowledge).toHaveBeenCalledWith(RID, {
      id: 'k1',
      scope: 'requirement',
      type: 'business',
      title: '知识-k1',
      content: '内容-k1',
      requirementId: RID,
      trigger: { mode: 'always' },
    }))
  })

  it('add 新建流：＋ 手动添加 → formTitleNew → saveKnowledge 无 id、requirement 作用域带 requirementId', async () => {
    const { controller } = subject(slot({ record: record() }))

    fireEvent.click(screen.getByRole('button', { name: workbenchZh['knowledge.add'] }))
    const dialog = screen.getByRole('dialog', { name: workbenchZh['knowledge.formTitleNew'] })
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['knowledge.titleLabel']), { target: { value: '  手动条目  ' } })
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['knowledge.contentLabel']), { target: { value: '正文内容' } })
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['action.save'] }))
    await waitFor(() => expect(controller.saveKnowledge).toHaveBeenCalledWith(RID, {
      scope: 'requirement',
      type: 'business',
      title: '手动条目',
      content: '正文内容',
      requirementId: RID,
      trigger: { mode: 'always' },
    }))
  })

  it('统计四格：跨 WP session 去重（s1 复用只计一次）、findings n/m、fail 验收计数、closed 锚定周期天数', () => {
    subject(slot({ record: record({
      findings: [finding('a', 'open'), finding('b', 'resolved'), finding('c', 'wont-fix'), finding('d', 'resolved')],
      workPackages: [workPackage('WP1', ['s1', 's2'], 2), workPackage('WP2', ['s1', 's3'], 0)],
      stageHistory: [{ stage: 'understand', at: '2026-09-25T09:30:00.000Z' }, { stage: 'closed', at: '2026-10-02T09:30:00.000Z' }],
    }) }))

    expect(screen.getByText('3')).toBeTruthy() // sessions 去重 {s1,s2,s3}
    expect(screen.getByText('3/4')).toBeTruthy() // findings 处置/总数
    expect(screen.getByText('2')).toBeTruthy() // rework = fail 验收
    expect(screen.getByText('7')).toBeTruthy() // 周期 = closed − createdAt = 7 天
  })

  it('周期天数未关闭：用当前时间取整（Date.now 钉住 → 3 天整）', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-28T09:30:00.000Z'))
    subject(slot({ record: record({ stageHistory: [{ stage: 'retro', at: AT }] }) }))

    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.queryByText('3/4')).toBeNull() // 其余统计为 0，不与「3」混淆
  })

  it('knowledge 切片 load-error：loadError 文案在场，active 列表与空态不渲染；候选卡与统计不受牵连', () => {
    subject(
      slot({ record: record({ knowledgeCandidates: [candidate('c1')] }) }),
      knowledge({ phase: 'load-error', records: [] }),
    )

    expect(screen.getByText(workbenchZh['knowledge.loadError'])).toBeTruthy()
    expect(screen.queryByText(workbenchZh['knowledge.emptyActive'])).toBeNull()
    // 候选卡（主账本数据）照常渲染，统计四格照常在场。
    expect(screen.getByText('候选-c1')).toBeTruthy()
    expect(screen.getByText(workbenchZh['knowledge.statSessions'])).toBeTruthy()
  })

  it('knowledge 切片 degraded：复用 guideSection 形态 + 既有 page.degraded 文案（无新键）', () => {
    subject(
      slot({ record: record() }),
      knowledge({ phase: 'degraded', records: [], degraded: { reason: 'parse', hasBackup: true } }),
    )

    expect(screen.getByText(workbenchZh['page.degraded'])).toBeTruthy()
    expect(screen.getByText(workbenchZh['page.degradedBackupHint'])).toBeTruthy()
    expect(screen.queryByText(workbenchZh['knowledge.emptyActive'])).toBeNull()
  })
})
