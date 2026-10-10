// @vitest-environment jsdom
/**
 * S5 交付节（P3a client 组件测试）：go/no-go 四计数与 GO 判定（零条目无
 * 横幅）、五分组空组不渲染、RowMenu 按 status 收窄、漂移行内披露、
 * applied/verified 锁定披露、登记 Modal 建/编 payload（envs 逗号解析含全角）、
 * 回滚预案确认/撤销流、导出 Modal 预览与 copy 注入、空态引导。
 *
 * 全部断言走真词典 workbenchZh；Modal portal 到 body，RTL 在 vitest 下无
 * 自动 cleanup，afterEach 显式清理（knowledge-section 惯例）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReleaseItem, WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import type { WorkbenchController } from '../../src/client/workbench/controller.js'
import type { RequirementWorkbenchState } from '../../src/client/workbench/store.js'
import { DeliverSection } from '../../src/client/workbench/deliver-section.js'

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

function item(id: string, overrides: Partial<ReleaseItem> = {}): ReleaseItem {
  return {
    id,
    type: 'sql',
    title: `上线项-${id}`,
    content: `ALTER ${id}`,
    contentHash: 'a'.repeat(64),
    envs: ['prod'],
    status: 'pending',
    ...overrides,
  }
}

function record(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: RID,
    stage: 'deliver',
    stageHistory: [{ stage: 'deliver', at: AT }],
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
    saveReleaseItem: vi.fn(async () => true),
    removeReleaseItem: vi.fn(async () => true),
    confirmReleaseItem: vi.fn(async () => true),
    markReleaseItemApplied: vi.fn(async () => true),
    markReleaseItemVerified: vi.fn(async () => true),
    rollbackReleaseItem: vi.fn(async () => true),
    confirmRollbackPlan: vi.fn(async () => true),
    revokeRollbackPlan: vi.fn(async () => true),
    dismissBanner: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  } as never
}

function subject(s: RequirementWorkbenchState, controller: WorkbenchController = fakeController(), copy?: (text: string) => Promise<boolean>, download?: (filename: string, text: string) => boolean) {
  return {
    ...render(<DeliverSection t={bindZh()} requirement={requirement} slot={s} controller={controller} requirementId={RID} copy={copy} download={download} />),
    controller,
  }
}

// vitest 未开 globals，RTL 的自动 cleanup 不生效；Modal portal 进 body。
afterEach(() => {
  cleanup()
})

describe('S5 交付节：go/no-go 与分组', () => {
  it('空态：零条目无 gonogo 横幅，空态引导 + 导出禁用', () => {
    subject(slot())
    expect(screen.queryByText(workbenchZh['release.gonogoNoGo'])).toBeNull()
    expect(screen.getByText(workbenchZh['release.empty'])).toBeTruthy()
    const exportButton = screen.getByRole('button', { name: workbenchZh['release.exportButton'] }) as HTMLButtonElement
    expect(exportButton.disabled).toBe(true)
  })

  it('四计数恒显零值 + 未确认 →「前置条件未满足」warning Tag', () => {
    subject(slot({ record: record({ releaseItems: [item('R0001')] }) }))
    expect(screen.getByText(workbenchZh['release.gonogoNoGo'])).toBeTruthy()
    expect(screen.getByText('待确认 1 · 已确认 0 · 漂移 0 · 回滚预案 未确认')).toBeTruthy()
  })

  it('三条件齐 → GO；四计数含回滚预案确认日期', () => {
    subject(slot({
      record: record({
        releaseItems: [item('R0001', { status: 'verified' })],
        rollbackPlanConfirmedAt: '2026-09-26T01:00:00.000Z',
      }),
    }))
    expect(screen.getByText(workbenchZh['release.gonogoGo'])).toBeTruthy()
    expect(screen.getByText('待确认 0 · 已确认 1 · 漂移 0 · 回滚预案 已确认（2026-09-26）')).toBeTruthy()
  })

  it('漂移入 gonogo 计数且行内 ⚠ 披露（结论保持未满足）', () => {
    subject(slot({
      record: record({ releaseItems: [item('R0001', { status: 'confirmed' })] }),
      releaseDrifted: ['R0001'],
    }))
    expect(screen.getByText('待确认 0 · 已确认 1 · 漂移 1 · 回滚预案 未确认')).toBeTruthy()
    expect(screen.getByText(`⚠ ${workbenchZh['release.driftNote']}`)).toBeTruthy()
  })

  it('五分组：空组不渲染、组带（N）计数、固定序 SQL 在 MQ 前', () => {
    subject(slot({ record: record({ releaseItems: [
      item('R0001', { type: 'mq' }),
      item('R0002'),
      item('R0003', { type: 'mq' }),
    ] }) }))
    const sqlAt = screen.getByText(`SQL（1）`)
    const mqAt = screen.getByText(`MQ（2）`)
    expect(sqlAt.compareDocumentPosition(mqAt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('配置（0）')).toBeNull()
    expect(screen.queryByText(workbenchZh['release.group.config'])).toBeNull()
    expect(screen.queryByText(workbenchZh['release.group.flag'])).toBeNull()
    expect(screen.queryByText(workbenchZh['release.group.other'])).toBeNull()
  })

  it('rolled-back 行保留（danger Tag）但不渲染菜单', () => {
    subject(slot({ record: record({ releaseItems: [item('R0001', { status: 'rolled-back' })] }) }))
    expect(screen.getByText(workbenchZh['release.status.rolled-back'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'R0001' })).toBeNull()
  })
})

describe('S5 交付节：行菜单按 status 收窄', () => {
  const openMenu = (rendered: ReturnType<typeof subject>, id: string): void => {
    fireEvent.click(rendered.getByRole('button', { name: id }))
  }

  it('pending → 确认/编辑/删除；确认动作直达 controller（无确认弹窗）', () => {
    const controller = fakeController()
    const rendered = subject(slot({ record: record({ releaseItems: [item('R0001')] }) }), controller)
    openMenu(rendered, 'R0001')
    fireEvent.click(screen.getByRole('menuitem', { name: workbenchZh['release.menuConfirm'] }))
    expect(controller.confirmReleaseItem).toHaveBeenCalledWith(RID, 'R0001')
  })

  it('confirmed → 标记已执行/回滚（无编辑删除）；applied → 标记已验证 + 锁定披露', () => {
    const controller = fakeController()
    const rendered = subject(slot({ record: record({ releaseItems: [
      item('R0001', { status: 'confirmed' }),
      item('R0002', { status: 'applied', appliedAt: AT }),
    ] }) }), controller)
    expect(screen.getByText(/内容已锁定只读/)).toBeTruthy()

    openMenu(rendered, 'R0001')
    expect(screen.queryByRole('menuitem', { name: workbenchZh['menu.edit'] })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: workbenchZh['release.menuApplied'] }))
    expect(controller.markReleaseItemApplied).toHaveBeenCalledWith(RID, 'R0001')
  })

  it('回滚与删除走确认 Modal（先关后调 fire-and-forget）', async () => {
    const controller = fakeController()
    const rendered = subject(slot({ record: record({ releaseItems: [item('R0001')] }) }), controller)
    openMenu(rendered, 'R0001')
    fireEvent.click(screen.getByRole('menuitem', { name: workbenchZh['release.menuRollback'] }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getAllByRole('button', { name: workbenchZh['release.menuRollback'] })
    fireEvent.click(confirm[confirm.length - 1]!)
    await waitFor(() => expect(controller.rollbackReleaseItem).toHaveBeenCalledWith(RID, 'R0001'))
  })
})

describe('S5 交付节：登记 Modal', () => {
  it('新建：五字段 + envs 全角逗号解析 + 空归属省略 + 空备注省略', async () => {
    const controller = fakeController()
    const rendered = subject(slot({ record: record({ workPackages: [] }) }), controller)
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['release.add'] }))
    const dialog = await screen.findByRole('dialog')

    fireEvent.change(within(dialog).getByLabelText(workbenchZh['release.titleLabel']), { target: { value: 't_order 加索引' } })
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['release.contentLabel']), { target: { value: 'ALTER TABLE t_order ADD INDEX i(c)' } })
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['release.envsLabel']), { target: { value: 'prod，pre' } })
    fireEvent.click(within(dialog).getAllByRole('button', { name: workbenchZh['action.save'] }).at(-1)!)

    await waitFor(() => expect(controller.saveReleaseItem).toHaveBeenCalledWith(RID, {
      type: 'sql',
      title: 't_order 加索引',
      content: 'ALTER TABLE t_order ADD INDEX i(c)',
      envs: ['prod', 'pre'],
    }))
  })

  it('编辑播种：带 id 提交；清备注与清归属真能清（全量替换语义）', async () => {
    const controller = fakeController()
    const target = item('R0001', { workPackageId: undefined, note: '旧备注', envs: ['prod'] })
    const rendered = subject(slot({ record: record({ releaseItems: [target] }) }), controller)
    fireEvent.click(rendered.getByRole('button', { name: 'R0001' }))
    fireEvent.click(screen.getByRole('menuitem', { name: workbenchZh['menu.edit'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['release.noteLabel']), { target: { value: '' } })
    fireEvent.click(within(dialog).getAllByRole('button', { name: workbenchZh['action.save'] }).at(-1)!)

    await waitFor(() => expect(controller.saveReleaseItem).toHaveBeenCalledWith(RID, {
      id: 'R0001',
      type: 'sql',
      title: '上线项-R0001',
      content: 'ALTER R0001',
      envs: ['prod'],
    }))
  })

  it('校验：空标题 → titleRequired，不触 controller', async () => {
    const controller = fakeController()
    const rendered = subject(slot(), controller)
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['release.add'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getAllByRole('button', { name: workbenchZh['action.save'] }).at(-1)!)
    await waitFor(() => expect(within(dialog).getByText(workbenchZh['release.titleRequired'])).toBeTruthy())
    expect(controller.saveReleaseItem).not.toHaveBeenCalled()
  })
})

describe('S5 交付节：回滚预案与导出', () => {
  it('确认预案流：按钮 → Modal → confirmRollbackPlan；已确认则换撤销按钮', async () => {
    const controller = fakeController()
    const rendered = subject(slot({ record: record({ releaseItems: [item('R0001')] }) }), controller)
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['release.confirmRollbackPlan'] }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(workbenchZh['release.rollbackPlanDescription'])).toBeTruthy()
    const confirm = within(dialog).getAllByRole('button', { name: workbenchZh['action.confirm'] })
    fireEvent.click(confirm[confirm.length - 1]!)
    await waitFor(() => expect(controller.confirmRollbackPlan).toHaveBeenCalledWith(RID))
  })

  it('撤销预案：已确认态出现撤销按钮（danger）', () => {
    subject(slot({ record: record({ releaseItems: [item('R0001')], rollbackPlanConfirmedAt: AT }) }))
    expect(screen.getByRole('button', { name: workbenchZh['release.revokeRollbackPlan'] })).toBeTruthy()
  })

  it('导出：Modal 预览含上线单标题/组/戳，copy 注入收到全文', async () => {
    const copy = vi.fn(async (_text: string) => true)
    const rendered = subject(slot({ record: record({
      releaseItems: [item('R0001', { status: 'confirmed' })],
      rollbackPlanConfirmedAt: AT,
    }) }), fakeController(), copy)
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['release.exportButton'] }))
    const dialog = await screen.findByRole('dialog')
    const preview = within(dialog).getByTestId('sheet-preview').textContent ?? ''
    expect(preview).toContain('上线单：报价管理：导入导出与数据校验')
    expect(preview).toContain('## SQL（1）')
    expect(preview).toContain('生成于 revision 3 ·')

    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['sheet.copy'] }))
    await waitFor(() => expect(copy.mock.calls[0]?.[0]).toContain('## SQL（1）'))
    await waitFor(() => expect(within(dialog).getByText(workbenchZh['sheet.copied'])).toBeTruthy())
  })

  it('导出下载（挂账轮）：注入收到 release-sheet 文件名与全文；失败出警示行', async () => {
    // jsdom cannot exercise a real anchor click — the injected download seam
    // is the test surface (the writeClipboard contract).
    const download = vi.fn((_filename: string, _text: string) => true)
    const rendered = subject(slot({ record: record({
      releaseItems: [item('R0001', { status: 'confirmed' })],
      rollbackPlanConfirmedAt: AT,
    }) }), fakeController(), undefined, download)
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['release.exportButton'] }))
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['sheet.download'] }))
    expect(download.mock.calls[0]?.[0]).toBe(`release-sheet-${RID}.md`)
    expect(download.mock.calls[0]?.[1]).toContain('## SQL（1）')
    expect(within(dialog).getByText(workbenchZh['sheet.downloaded'])).toBeTruthy()
  })

  it('导出下载失败：downloadFailed 警示行出现且可重试（复制并存）', async () => {
    let fail = true
    const download = vi.fn((_filename: string, _text: string) => !fail)
    const rendered = subject(slot({ record: record({
      releaseItems: [item('R0001', { status: 'confirmed' })],
      rollbackPlanConfirmedAt: AT,
    }) }), fakeController(), undefined, download)
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['release.exportButton'] }))
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['sheet.download'] }))
    expect(within(dialog).getByText(workbenchZh['sheet.downloadFailed'])).toBeTruthy()
    // Not locked out: a later attempt succeeds and the alert is gone.
    fail = false
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['sheet.download'] }))
    expect(within(dialog).queryByText(workbenchZh['sheet.downloadFailed'])).toBeNull()
    expect(within(dialog).getByText(workbenchZh['sheet.downloaded'])).toBeTruthy()
  })
})

describe('S5 交付节：导入声明入口（P3b）', () => {
  it('头行 [导入声明] 打开 Modal（编辑态：文本域在场）', async () => {
    const rendered = subject(slot())
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['declare.importButton'] }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(workbenchZh['declare.textLabel'])).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: workbenchZh['declare.parseButton'] })).toBeTruthy()
  })
})
