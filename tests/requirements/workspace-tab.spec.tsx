// @vitest-environment jsdom
/**
 * Workspace tab seat (0003 P3a): the unbound setup flow (notice card, dialog
 * with the host-suggested default), the bound flow (inline path editing,
 * status tag, open, unbind without confirmation), and the optional remote
 * capability degradation (picker unavailable, opener gated by canOpen).
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CloneTaskSnapshot, RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { RequirementsController, WorkspaceOutcome } from '../../src/client/requirements/controller.js'
import type { RequirementsT } from '../../src/client/requirements/dictionary.js'
import {
  WorkspaceTabBody,
  createWorkspaceCapabilities,
} from '../../src/client/requirements/workspace-tab.js'

const DICT = {
  zh: {
    'workspace.setUp': '设置工作区目录',
    'workspace.emptyHint': '为该需求设置一个工作区目录，关联仓库与 PRD 文档将落位其中。',
    'workspace.pathLabel': '工作区目录',
    'workspace.browse': '选择目录…',
    'workspace.tagOk': '正常',
    'workspace.tagMissing': '目录缺失',
    'workspace.tagUnregistered': '未注册',
    'workspace.rebind': '重新注册',
    'workspace.rebindHint': '在宿主工作区列表中重建此目录的注册',
    'workspace.open': '打开',
    'workspace.unbind': '解绑',
    'workspace.unbindHint': '解绑不会删除磁盘上的文件',
    'workspace.invalidPath': '路径无效：请输入绝对路径，且不能指向普通文件',
    'workspace.pickerUnavailable': '当前后端不支持目录选择',
    'workspace.sectionRepos': '关联仓库',
    'workspace.sectionReposHint': '设置工作区后可用（即将上线）。',
    'workspace.sectionPrd': 'PRD 文档',
    'workspace.sectionPrdHint': '设置工作区后可用（即将上线）。',
    'form.cancel': '取消',
    'form.submit': '保存',
    'form.submitting': '保存中…',
    'form.closeLabel': '关闭',
  },
} as const

const bindZh = (): RequirementsT => (key) => (DICT.zh as Record<string, string>)[key] ?? key

/** Status lands asynchronously (useEffect pull); the dialog pre-fill reads it. */
async function settleStatus(controller: RequirementsController): Promise<void> {
  await waitFor(() => expect(controller.workspaceStatus).toHaveBeenCalled())
  await waitFor(() => expect(screen.getByRole('button', { name: DICT.zh['workspace.setUp'] })).toBeTruthy())
}

const record = (workspacePath = ''): RequirementRecord => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: '既有需求',
  description: '既有说明',
  workspacePath,
  linkedRepos: [],
  createdAt: '2026-09-25T09:30:00.000Z',
  updatedAt: '2026-09-25T09:30:00.000Z',
})

type StatusPayload = {
  bound: boolean
  path: string
  directoryExists: boolean
  registered: boolean
  suggestedPath: string
}

function fakeController(overrides?: {
  status?: Partial<StatusPayload>
  setOutcome?: WorkspaceOutcome
}): RequirementsController {
  return {
    workspaceStatus: vi.fn(async () => ({
      kind: 'ok' as const,
      bound: (overrides?.status?.bound ?? false),
      path: (overrides?.status?.path ?? ''),
      directoryExists: (overrides?.status?.directoryExists ?? true),
      registered: (overrides?.status?.registered ?? true),
      suggestedPath: (overrides?.status?.suggestedPath ?? '/home/.dsh/skyaxis/workspaces/ji-you-xu-qiu'),
    })),
    setWorkspace: vi.fn(async (): Promise<WorkspaceOutcome> => overrides?.setOutcome ?? 'ok'),
    clearWorkspace: vi.fn(async (): Promise<WorkspaceOutcome> => overrides?.setOutcome ?? 'ok'),
    rebindWorkspace: vi.fn(async (): Promise<WorkspaceOutcome> => overrides?.setOutcome ?? 'ok'),
    repoTasks: vi.fn(async () => ({ kind: 'ok' as const, tasks: [] as readonly CloneTaskSnapshot[] })),
    repoScan: vi.fn(async () => ({ kind: 'ok' as const, dirs: [] })),
    linkRepo: vi.fn(async () => ({ kind: 'ok' as const, tasks: [] })),
    adoptRepo: vi.fn(async () => ({ kind: 'ok' as const, tasks: [] })),
    unlinkRepo: vi.fn(async () => ({ kind: 'ok' as const, tasks: [] })),
    recloneRepo: vi.fn(async () => ({ kind: 'ok' as const, tasks: [] })),
    cancelRepoClone: vi.fn(async () => ({ kind: 'ok' as const, tasks: [] })),
    refresh: vi.fn(async () => undefined),
    save: vi.fn(async () => true),
    remove: vi.fn(async () => undefined),
    openCreate: vi.fn(),
    openEdit: vi.fn(),
    closeForm: vi.fn(),
    openDetail: vi.fn(),
    closeDetail: vi.fn(),
    dismissBanner: vi.fn(),
    dispose: vi.fn(),
  } as unknown as RequirementsController
}

type Subject = { requirement: RequirementRecord; controller: RequirementsController; capabilities?: ReturnType<typeof createWorkspaceCapabilities> }

function subject(props: Subject) {
  const capabilities = props.capabilities ?? createWorkspaceCapabilities()
  const element = (requirement: RequirementRecord, controller: RequirementsController) => (
    <WorkspaceTabBody
      t={bindZh()}
      requirement={requirement}
      controller={controller}
      capabilities={capabilities}
    />
  )
  const utils = render(element(props.requirement, props.controller))
  return { ...utils, capabilities, element }
}

describe('RequirementWorkspaceTab (0003 P3a: workspace binding)', () => {
  it('renders the unbound guide card and opens the dialog pre-filled with the host suggestion', async () => {
    const controller = fakeController()
    const { unmount } = subject({ requirement: record(), controller })
    expect(screen.getByText(DICT.zh['workspace.emptyHint'])).toBeTruthy()
    expect(screen.getByText(DICT.zh['workspace.sectionRepos'])).toBeTruthy()
    expect(screen.getByText(DICT.zh['workspace.sectionPrd'])).toBeTruthy()

    await settleStatus(controller)
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['workspace.setUp'] }))
    await waitFor(() => expect(screen.getByDisplayValue('/home/.dsh/skyaxis/workspaces/ji-you-xu-qiu')).toBeTruthy())
    expect(screen.queryByRole('button', { name: DICT.zh['workspace.browse'] })).toBeNull()
    unmount()
  })

  it('confirms the dialog through controller.setWorkspace and shows the bound row afterwards', async () => {
    const controller = fakeController()
    const { unmount, element, rerender } = subject({ requirement: record(), controller })
    await settleStatus(controller)
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['workspace.setUp'] }))
    await waitFor(() => expect(screen.getByDisplayValue('/home/.dsh/skyaxis/workspaces/ji-you-xu-qiu')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['form.submit'] }))

    await waitFor(() => expect(controller.setWorkspace).toHaveBeenCalledWith(record().id, '/home/.dsh/skyaxis/workspaces/ji-you-xu-qiu'))
    rerender(element({ ...record(), workspacePath: '/home/.dsh/skyaxis/workspaces/ji-you-xu-qiu' }, controller))
    await waitFor(() => expect(screen.getByText('/home/.dsh/skyaxis/workspaces/ji-you-xu-qiu')).toBeTruthy())
    await waitFor(() => expect(screen.getByText(DICT.zh['workspace.tagOk'])).toBeTruthy())
    unmount()
  })

  it('keeps the dialog mounted with an inline error on invalid-path', async () => {
    const controller = fakeController({ setOutcome: 'invalid-path' })
    const { unmount } = subject({ requirement: record(), controller })
    await settleStatus(controller)
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['workspace.setUp'] }))
    await waitFor(() => expect(screen.getByDisplayValue('/home/.dsh/skyaxis/workspaces/ji-you-xu-qiu')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['form.submit'] }))
    await waitFor(() => expect(screen.getByText(DICT.zh['workspace.invalidPath'])).toBeTruthy())
    expect(screen.getByDisplayValue('/home/.dsh/skyaxis/workspaces/ji-you-xu-qiu')).toBeTruthy()
    unmount()
  })

  it('picker face: fills the input on success, stays silent on cancel, degrades on unavailable', async () => {
    const controller = fakeController()
    const capabilities = createWorkspaceCapabilities()
    const pick = vi.fn(async () => ({ ok: true as const, value: '/picked/dir' }))
    capabilities.setPicker({ pick } as never)

    const first = subject({ requirement: record(), controller, capabilities })
    await settleStatus(controller)
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['workspace.setUp'] }))
    await waitFor(() => expect(screen.getByRole('button', { name: DICT.zh['workspace.browse'] })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['workspace.browse'] }))
    await waitFor(() => expect(screen.getByDisplayValue('/picked/dir')).toBeTruthy())
    first.unmount()

    // Cancel: value null, silent — the draft stays untouched.
    const second = subject({ requirement: record(), controller, capabilities })
    capabilities.setPicker({ pick: vi.fn(async () => ({ ok: true as const, value: null })) } as never)
    await settleStatus(controller)
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['workspace.setUp'] }))
    await waitFor(() => expect(screen.getByRole('button', { name: DICT.zh['workspace.browse'] })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['workspace.browse'] }))
    await waitFor(() => expect(screen.getByDisplayValue('/home/.dsh/skyaxis/workspaces/ji-you-xu-qiu')).toBeTruthy())
    second.unmount()

    // Unavailable backend: the button disappears and the inline hint shows.
    const third = subject({ requirement: record(), controller, capabilities })
    capabilities.setPicker({ pick: vi.fn(async () => ({ ok: false as const, error: { code: 'directory-picker/unavailable' } })) } as never)
    await settleStatus(controller)
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['workspace.setUp'] }))
    await waitFor(() => expect(screen.getByRole('button', { name: DICT.zh['workspace.browse'] })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['workspace.browse'] }))
    await waitFor(() => expect(screen.getByText(DICT.zh['workspace.pickerUnavailable'])).toBeTruthy())
    expect(screen.queryByRole('button', { name: DICT.zh['workspace.browse'] })).toBeNull()
    third.unmount()
  })

  it('inline path editing: Enter commits (a teardown blur cannot roll it back), Escape cancels', async () => {
    const controller = fakeController()
    const { unmount } = subject({ requirement: record('/old/path'), controller })
    const pathButton = await waitFor(() => screen.getByText('/old/path'))

    // Escape restores the static row.
    fireEvent.click(pathButton)
    const editor = screen.getByDisplayValue('/old/path')
    fireEvent.change(editor, { target: { value: '/new/path' } })
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(screen.getByText('/old/path')).toBeTruthy()

    // Enter commits; the blur fired while the mutation is in flight is a no-op.
    fireEvent.click(screen.getByText('/old/path'))
    const editor2 = screen.getByDisplayValue('/old/path')
    fireEvent.change(editor2, { target: { value: '/new/path' } })
    fireEvent.keyDown(editor2, { key: 'Enter' })
    fireEvent.blur(editor2)
    await waitFor(() => expect(controller.setWorkspace).toHaveBeenCalledWith(record().id, '/new/path'))
    expect(screen.queryByDisplayValue('/new/path')).toBeNull()
    unmount()
  })

  it('flags a vanished directory with the warning tag', async () => {
    const controller = fakeController({ status: { bound: true, path: '/gone', directoryExists: false, registered: true } })
    const { unmount } = subject({ requirement: record('/gone'), controller })
    await waitFor(() => expect(screen.getByText(DICT.zh['workspace.tagMissing'])).toBeTruthy())
    expect(screen.queryByText(DICT.zh['workspace.tagOk'])).toBeNull()
    unmount()
  })

  it('shows the unregistered tag with a re-register button when the host row is gone', async () => {
    const controller = fakeController({ status: { bound: true, path: '/gone-from-registry', directoryExists: true, registered: false } })
    const { unmount } = subject({ requirement: record('/gone-from-registry'), controller })
    const rebind = await waitFor(() => screen.getByRole('button', { name: DICT.zh['workspace.rebind'] }))
    expect(screen.getByText(DICT.zh['workspace.tagUnregistered'])).toBeTruthy()
    expect(screen.queryByText(DICT.zh['workspace.tagOk'])).toBeNull()
    fireEvent.click(rebind)
    await waitFor(() => expect(controller.rebindWorkspace).toHaveBeenCalledWith(record().id))
    unmount()
  })

  it('unbinds directly without any confirmation dialog', async () => {
    const controller = fakeController()
    const { unmount } = subject({ requirement: record('/old/path'), controller })
    const unbind = await waitFor(() => screen.getByRole('button', { name: DICT.zh['workspace.unbind'] }))
    expect(unbind.getAttribute('title')).toBe(DICT.zh['workspace.unbindHint'])
    fireEvent.click(unbind)
    await waitFor(() => expect(controller.clearWorkspace).toHaveBeenCalledWith(record().id))
    unmount()
  })

  it('open button rides the opener capability and the canOpen pre-check', async () => {
    const controller = fakeController()
    const capabilities = createWorkspaceCapabilities()
    const openWorkspacePath = vi.fn(async () => ({ ok: true as const, value: { opened: true as const } }))
    capabilities.setOpener({ canOpenWorkspacePath: vi.fn(async () => ({ ok: true as const, value: true })), openWorkspacePath } as never)

    const { unmount } = subject({ requirement: record('/old/path'), controller, capabilities })
    const open = await waitFor(() => screen.getByRole('button', { name: DICT.zh['workspace.open'] }))
    fireEvent.click(open)
    // Plain open payload — no action key (reveal's argv cannot carry CJK paths,
    // decisions/0012; the absent key is the entire point of this regression lock).
    await waitFor(() => expect(openWorkspacePath).toHaveBeenCalledWith({ path: '/old/path' }))
    unmount()

    // canOpen false: no button at all.
    const off = createWorkspaceCapabilities()
    off.setOpener({ canOpenWorkspacePath: vi.fn(async () => ({ ok: true as const, value: false })) } as never)
    const second = subject({ requirement: record('/old/path'), controller, capabilities: off })
    await waitFor(() => expect(screen.getByText('/old/path')).toBeTruthy())
    expect(screen.queryByRole('button', { name: DICT.zh['workspace.open'] })).toBeNull()
    second.unmount()
  })
})
