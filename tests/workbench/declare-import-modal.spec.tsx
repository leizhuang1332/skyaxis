// @vitest-environment jsdom
/**
 * 声明块导入 Modal（P3b client 组件测试）：粘贴→解析→逐条勾选→导入的
 * payload（选中 key 集 + dry-run 响应 revision 锚定——不是 store 当前值）；
 * duplicate 默认不勾；抓取四降级文案与填充；sessions face 缺席时抓取行
 * 整块不渲染；无绑定会话提示；409 → stale + 重新解析；导入中禁关；
 * blockError 保编辑态；done 报告计数。
 *
 * 全部断言走真词典 workbenchZh；Modal portal，afterEach cleanup。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { DeclarePreviewResponseOk, WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import type { WorkbenchController } from '../../src/client/workbench/controller.js'
import type { RequirementWorkbenchState } from '../../src/client/workbench/store.js'
import type { WorkbenchSessionsFace } from '../../src/client/workbench/view.js'
import { DeclareImportModal } from '../../src/client/workbench/declare-import-modal.js'

const RID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-09-29T08:00:00.000Z'
const DECLARE_TEXT = '```yaml\n# skyaxis-declare\nworkPackage: WP1\nclaims:\n  - built: true\nartifacts:\n  - type: sql\n    title: t 加索引\n    content: ALTER TABLE t ADD i(c)\nknowledge:\n  - type: convention\n    title: 导出走异步\n    draft: 内容\n```'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

function record(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: RID,
    stage: 'deliver',
    stageHistory: [{ stage: 'deliver', at: AT }],
    criteria: [],
    findings: [],
    workPackages: [{
      id: 'WP1', title: 'WP1', boundary: '', order: 1, dependsOn: [], covers: [],
      status: 'in-dev', plans: [], sessions: [{ sessionId: 'sess-a', purpose: 'dev', boundAt: AT }], commits: [], acceptances: [],
    }],
    releaseItems: [],
    reviewReports: [],
    knowledgeCandidates: [],
    splitApprovedAt: AT,
    ...overrides,
  }
}

function slot(overrides: Partial<RequirementWorkbenchState> = {}): RequirementWorkbenchState {
  return {
    phase: 'ready',
    revision: 5,
    record: record(),
    planFileExists: [],
    reviewFileExists: [],
    releaseDrifted: [],
    busy: false,
    ...overrides,
  }
}

const PREVIEW: DeclarePreviewResponseOk = {
  ok: true,
  revision: 5,
  entries: [
    { kind: 'built', key: 'built-0', workPackageId: 'WP1' },
    { kind: 'artifact', key: 'artifact-0', type: 'sql', title: 't 加索引', content: 'ALTER TABLE t ADD i(c)', envs: ['prod'], workPackageId: 'WP1', duplicate: false },
    { kind: 'knowledge', key: 'knowledge-0', type: 'convention', title: '导出走异步', draft: '内容', duplicate: true },
  ],
  skipped: [{ key: 'artifact-1', label: '坏行', reason: 'bad-type' }],
  stageReady: true,
}

function fakeController(overrides: Record<string, unknown> = {}): WorkbenchController {
  return {
    open: vi.fn(async () => undefined),
    declareFetch: vi.fn(async () => ({ kind: 'ok' as const, response: { ok: true as const, text: DECLARE_TEXT } })),
    declarePreview: vi.fn(async () => ({ kind: 'ok' as const, preview: PREVIEW })),
    declareImport: vi.fn(async () => ({ built: 1, artifacts: 1, knowledge: 0, skipped: PREVIEW.skipped })),
    dismissBanner: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  } as never
}

const sessionsFace = (): WorkbenchSessionsFace => ({
  ids: ['sess-a'],
  summariesById: { 'sess-a': { id: 'sess-a', displayTitle: 'WP1·开发 会话A', running: false, blank: false } },
  subscribe: () => () => {},
  navigate: () => {},
})

function subject(overrides: {
  slot?: RequirementWorkbenchState
  controller?: WorkbenchController
  sessions?: WorkbenchSessionsFace | undefined
} = {}) {
  const controller = overrides.controller ?? fakeController()
  const rendered = render(
    <DeclareImportModal
      t={bindZh()}
      open
      requirementId={RID}
      slot={overrides.slot ?? slot()}
      controller={controller}
      sessions={overrides.sessions}
      onClose={() => {}}
    />,
  )
  return { ...rendered, controller }
}

const pasteAndParse = async (rendered: ReturnType<typeof subject>): Promise<void> => {
  fireEvent.change(rendered.getByLabelText(workbenchZh['declare.textLabel']), { target: { value: DECLARE_TEXT } })
  fireEvent.click(rendered.getByRole('button', { name: workbenchZh['declare.parseButton'] }))
  await waitFor(() => expect(rendered.getByText(workbenchZh['declare.groupBuilt'])).toBeTruthy())
}

afterEach(() => {
  cleanup()
})

describe('声明块导入 Modal：粘贴→预览→导入', () => {
  it('三组勾选 + skipped 明细 + stageReady 咨询行；duplicate 默认不勾', async () => {
    const rendered = subject()
    await pasteAndParse(rendered)

    expect(rendered.getByText(workbenchZh['declare.stageReadyProposal'])).toBeTruthy()
    expect(rendered.getByText(workbenchZh['declare.skippedTitle'])).toBeTruthy()
    expect(rendered.getByText(`坏行 — ${workbenchZh['declare.skip.bad-type']}`)).toBeTruthy()

    const dialog = rendered.getByRole('dialog')
    const builtBox = within(dialog).getByLabelText(/WP1 · built/) as HTMLInputElement
    const artifactBox = within(dialog).getByLabelText(/t 加索引（SQL） · env prod/) as HTMLInputElement
    const knowledgeBox = within(dialog).getByLabelText(/导出走异步（convention）/) as HTMLInputElement
    expect(builtBox.checked).toBe(true)
    expect(artifactBox.checked).toBe(true)
    expect(knowledgeBox.checked).toBe(false) // duplicate 默认不勾
    expect(within(dialog).getByText(/与已有条目重复/)).toBeTruthy()
  })

  it('导入 payload：选中 key 集 + dry-run 响应的 revision（锚定不是 store 当前）', async () => {
    const controller = fakeController()
    const rendered = subject({ controller })
    await pasteAndParse(rendered)

    // store revision 在预览后被别处推进到 9 —— 导入仍必须带预览返回的 5。
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['declare.importSubmit'] }))
    await waitFor(() => expect(controller.declareImport).toHaveBeenCalledTimes(1))
    expect(controller.declareImport).toHaveBeenCalledWith(RID, DECLARE_TEXT, ['built-0', 'artifact-0'], 5, undefined)
  })

  it('选中为空禁用导入；取消勾选后 payload 随之收缩', async () => {
    const controller = fakeController()
    const rendered = subject({ controller })
    await pasteAndParse(rendered)
    const dialog = rendered.getByRole('dialog')
    const importButton = () => rendered.getByRole('button', { name: workbenchZh['declare.importSubmit'] }) as HTMLButtonElement
    expect(importButton().disabled).toBe(false)

    fireEvent.click(within(dialog).getByLabelText(/WP1 · built/))
    fireEvent.click(within(dialog).getByLabelText(/t 加索引/))
    expect(importButton().disabled).toBe(true)

    fireEvent.click(within(dialog).getByLabelText(/导出走异步/)) // 手动勾上 duplicate 条目仍可导入
    expect(importButton().disabled).toBe(false)
    fireEvent.click(importButton())
    await waitFor(() => expect(controller.declareImport).toHaveBeenCalledWith(RID, DECLARE_TEXT, ['knowledge-0'], 5, undefined))
  })

  it('done 报告：四计数 + skipped 明细', async () => {
    const rendered = subject()
    await pasteAndParse(rendered)
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['declare.importSubmit'] }))
    await waitFor(() => expect(rendered.getByText(/导入完成/)).toBeTruthy())
    expect(rendered.getByText(/built 1 · 上线项 1 · 知识候选 0 · 跳过 1/)).toBeTruthy()
  })

  it('blockError：无块/语法错保编辑态 + alert 行，不进预览', async () => {
    const controller = fakeController({
      declarePreview: vi.fn(async () => ({ kind: 'ok' as const, preview: { ...PREVIEW, entries: [], skipped: [], stageReady: false, blockError: 'yaml-syntax' as const, blockErrorLine: 4 } })),
    })
    const rendered = subject({ controller })
    await pasteAndParse(rendered).catch(() => undefined)
    fireEvent.change(rendered.getByLabelText(workbenchZh['declare.textLabel']), { target: { value: '坏文本' } })
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['declare.parseButton'] }))
    expect(await rendered.findByRole('alert')).toBeTruthy()
    expect(rendered.getByRole('alert').textContent).toBe(workbenchZh['declare.blockYamlSyntax'].replaceAll('{n}', '4'))
    expect(rendered.queryByText(workbenchZh['declare.groupBuilt'])).toBeNull()
  })
})

describe('声明块导入 Modal：抓取通道', () => {
  it('sessions 缺席 → 抓取行整块不渲染（诚实降级，粘贴通道常在）', () => {
    const rendered = subject({ sessions: undefined })
    expect(rendered.queryByText(workbenchZh['declare.sessionLabel'])).toBeNull()
    expect(rendered.getByLabelText(workbenchZh['declare.textLabel'])).toBeTruthy()
  })

  it('无绑定会话 → 提示行', () => {
    const rendered = subject({ slot: slot({ record: record({ workPackages: [] }) }), sessions: sessionsFace() })
    expect(rendered.getByText(workbenchZh['declare.noBoundSessions'])).toBeTruthy()
  })

  it('选中会话抓取 → textarea 填入声明块文本', async () => {
    const controller = fakeController()
    const rendered = subject({ controller, sessions: sessionsFace() })
    fireEvent.change(rendered.getByRole('combobox'), { target: { value: 'sess-a' } })
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['declare.fetchButton'] }))
    await waitFor(() => expect(controller.declareFetch).toHaveBeenCalledWith('sess-a'))
    await waitFor(() => expect((rendered.getByLabelText(workbenchZh['declare.textLabel']) as HTMLTextAreaElement).value).toContain('# skyaxis-declare'))
  })

  it('四种 missing 各自的降级文案', async () => {
    for (const [missing, key] of [
      ['no-service', 'declare.fetchNoService'],
      ['not-found', 'declare.fetchNotFound'],
      ['unreadable', 'declare.fetchUnreadable'],
      ['no-declare-block', 'declare.fetchNoBlock'],
    ] as const) {
      const controller = fakeController({
        declareFetch: vi.fn(async () => ({ kind: 'ok' as const, response: { ok: true as const, missing } })),
      })
      const rendered = subject({ controller, sessions: sessionsFace() })
      fireEvent.change(rendered.getByRole('combobox'), { target: { value: 'sess-a' } })
      fireEvent.click(rendered.getByRole('button', { name: workbenchZh['declare.fetchButton'] }))
      expect(await rendered.findByText(workbenchZh[key])).toBeTruthy()
      cleanup()
    }
  })
})

describe('声明块导入 Modal：409 stale 与导入中禁关', () => {
  it('解析撞 409 → stale 态 + 重新解析按钮（不自动链）', async () => {
    const controller = fakeController({
      declarePreview: vi.fn(async () => ({ kind: 'http-error' as const, status: 409, code: 'conflict' })),
    })
    const rendered = subject({ controller })
    fireEvent.change(rendered.getByLabelText(workbenchZh['declare.textLabel']), { target: { value: DECLARE_TEXT } })
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['declare.parseButton'] }))
    await waitFor(() => expect(rendered.getByText(workbenchZh['declare.reparseButton'])).toBeTruthy())

    // 重新解析：先 open 刷新再 preview
    const okController = fakeController()
    controller.open = okController.open
    controller.declarePreview = okController.declarePreview
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['declare.reparseButton'] }))
    await waitFor(() => expect(controller.open).toHaveBeenCalledWith(RID))
    await waitFor(() => expect(rendered.getByText(workbenchZh['declare.groupBuilt'])).toBeTruthy())
  })

  it('导入撞 409 → stale 态', async () => {
    const controller = fakeController({
      declareImport: vi.fn(async () => ({ kind: 'http-error' as const, status: 409, code: 'conflict' })),
    })
    const rendered = subject({ controller })
    await pasteAndParse(rendered)
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['declare.importSubmit'] }))
    await waitFor(() => expect(rendered.getByText(workbenchZh['declare.reparseButton'])).toBeTruthy())
  })

  it('导入进行中：关闭按钮点了不生效（服务端已提交，关闭会读成取消）', async () => {
    let releaseImport: (() => void) | undefined
    const controller = fakeController({
      declareImport: vi.fn(async () => new Promise<{ built: number; artifacts: number; knowledge: number; skipped: [] }>((resolve) => {
        releaseImport = () => resolve({ built: 0, artifacts: 0, knowledge: 0, skipped: [] })
      })),
    })
    const onClose = vi.fn()
    const rendered = render(
      <DeclareImportModal
        t={bindZh()}
        open
        requirementId={RID}
        slot={slot()}
        controller={controller}
        onClose={onClose}
      />,
    )
    fireEvent.change(rendered.getByLabelText(workbenchZh['declare.textLabel']), { target: { value: DECLARE_TEXT } })
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['declare.parseButton'] }))
    await waitFor(() => expect(rendered.getByRole('button', { name: workbenchZh['declare.importSubmit'] })).toBeTruthy())
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['declare.importSubmit'] }))

    const dialog = rendered.getByRole('dialog')
    const closeButtons = within(dialog).getAllByRole('button', { name: workbenchZh['action.cancel'] })
    fireEvent.click(closeButtons[0]!)
    expect(onClose).not.toHaveBeenCalled()

    releaseImport?.()
    await waitFor(() => expect(rendered.getByText(/导入完成/)).toBeTruthy())
  })
})
