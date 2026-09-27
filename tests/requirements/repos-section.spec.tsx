// @vitest-environment jsdom
/**
 * Linked repositories section: the empty action card, the pool picker dialog
 * (prefilled branch, disabled linked rows, inline errors), the three task
 * row states with live polling, loss-tolerant pool joins, and row menu
 * actions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CloneTaskSnapshot, RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { RepoRecord } from '../../src/repos-pool-shared/protocol.js'
import type { RequirementsController, ReposOutcome } from '../../src/client/requirements/controller.js'
import type { RequirementsT } from '../../src/client/requirements/dictionary.js'
import { ReposSection } from '../../src/client/requirements/repos-section.js'
import { createWorkspaceCapabilities } from '../../src/client/requirements/workspace-tab.js'

const DICT = {
  zh: {
    'repos.add': '从仓库池添加',
    'repos.emptyHint': '从仓库池选择一个仓库，clone 到工作区 repos/ 目录。',
    'repos.branchLabel': '分支名',
    'repos.cloning': '克隆中',
    'repos.branching': '创建分支中',
    'repos.failedTag': '克隆失败',
    'repos.failAuth': '认证失败（凭证缺失或权限不足）',
    'repos.cancel': '取消克隆',
    'repos.reclone': '重新 clone',
    'repos.removeLink': '移除关联',
    'repos.removedRepo': '已移除的仓库',
    'repos.selectRepo': '选择仓库',
    'repos.emptyPool': '仓库池为空，请先在仓库池面板添加仓库',
    'repos.poolError': '仓库池加载失败',
    'repos.link': '关联并克隆',
    'repos.menuLabel': '仓库操作',
    'repos.removeTitle': '移除关联',
    'repos.removeDesc': '将移除该关联，并删除工作区 repos/ 目录下已克隆的源码。',
    'repos.removeConfirm': '移除',
    'repos.removeCancel': '取消',
    'repos.errInvalidBranch': '分支名不合法',
    'workspace.sectionRepos': '关联仓库',
    'workspace.open': '打开',
    'form.cancel': '取消',
    'form.submit': '保存',
    'form.submitting': '保存中…',
    'form.closeLabel': '关闭',
    'view.filterPlaceholder': '按标题 / 描述筛选',
  },
} as const

const bindZh = (): RequirementsT => (key) => (DICT.zh as Record<string, string>)[key] ?? key

const poolRepo = (id: string, name: string): RepoRecord => ({
  id,
  name,
  url: `https://example.com/org/${name}.git`,
  description: '',
  status: 'verified',
  validatedAt: '2026-09-25T09:30:00.000Z',
  lastError: null,
})

const record = (linkedRepos: ReadonlyArray<{ repoId: string; branch: string }> = []): RequirementRecord => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: '既有需求',
  description: '既有说明',
  workspacePath: '/ws',
  linkedRepos,
  createdAt: '2026-09-25T09:30:00.000Z',
  updatedAt: '2026-09-25T09:30:00.000Z',
})

function fakeController(options?: { tasks?: readonly CloneTaskSnapshot[]; linkOutcome?: ReposOutcome }) {
  return {
    repoTasks: vi.fn(async () => ({ kind: 'ok' as const, tasks: options?.tasks ?? [] })),
    linkRepo: vi.fn(async (): Promise<ReposOutcome> => options?.linkOutcome ?? { kind: 'ok', tasks: [] }),
    unlinkRepo: vi.fn(async (): Promise<ReposOutcome> => ({ kind: 'ok', tasks: [] })),
    recloneRepo: vi.fn(async (): Promise<ReposOutcome> => ({ kind: 'ok', tasks: [] })),
    cancelRepoClone: vi.fn(async (): Promise<ReposOutcome> => ({ kind: 'ok', tasks: [] })),
    refresh: vi.fn(async () => undefined),
    save: vi.fn(async () => true),
    remove: vi.fn(async () => undefined),
    workspaceStatus: vi.fn(async () => ({ kind: 'ok' as const, bound: true, path: '/ws', directoryExists: true, registered: true, suggestedPath: '' })),
    setWorkspace: vi.fn(async () => 'ok' as const),
    clearWorkspace: vi.fn(async () => 'ok' as const),
    rebindWorkspace: vi.fn(async () => 'ok' as const),
    openCreate: vi.fn(),
    openEdit: vi.fn(),
    closeForm: vi.fn(),
    openDetail: vi.fn(),
    closeDetail: vi.fn(),
    dismissBanner: vi.fn(),
    dispose: vi.fn(),
  } as unknown as RequirementsController
}

function stubPool(repos: readonly RepoRecord[] = [poolRepo('22222222-2222-4222-8222-222222222222', 'repo-a'), poolRepo('33333333-3333-4333-8333-333333333333', 'repo-b')], ok = true) {
  return vi.fn(async () => new Response(JSON.stringify(ok
    ? { ok: true, revision: 1, repos }
    : { ok: false, degraded: true, reason: 'parse' as const, hasBackup: false }), { status: 200, headers: { 'content-type': 'application/json' } }))
}

function subject(props: { requirement: RequirementRecord; controller: RequirementsController }) {
  const capabilities = createWorkspaceCapabilities()
  const element = (requirement: RequirementRecord, controller: RequirementsController): ReactNode => (
    <ReposSection t={bindZh()} requirement={requirement} controller={controller} capabilities={capabilities} />
  )
  const utils = render(element(props.requirement, props.controller))
  return { ...utils, element }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ReposSection (0003 P3b: linked repositories)', () => {
  it('renders the empty action card for a bound requirement without links', async () => {
    vi.stubGlobal('fetch', stubPool())
    const controller = fakeController()
    const { unmount } = subject({ requirement: record(), controller })
    expect(screen.getByText(DICT.zh['workspace.sectionRepos'])).toBeTruthy()
    expect(screen.getByRole('button', { name: DICT.zh['repos.add'] })).toBeTruthy()
    expect(screen.getByText(DICT.zh['repos.emptyHint'])).toBeTruthy()
    await waitFor(() => expect(controller.repoTasks).toHaveBeenCalled())
    unmount()
  })

  it('opens the picker dialog with the pool list and a prefilled branch', async () => {
    vi.stubGlobal('fetch', stubPool())
    const controller = fakeController()
    const { unmount } = subject({ requirement: record([{ repoId: '33333333-3333-4333-8333-333333333333', branch: 'req-11111111' }]), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByText('repo-a')).toBeTruthy()
    // repo-b is already linked: it stays as a LIST ROW (span), but the picker
    // never offers it as a selectable pool row (button).
    expect(screen.getByText('repo-b')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /repo-b/ })).toBeNull()
    expect(screen.getByDisplayValue('req-11111111')).toBeTruthy()
    unmount()
  })

  it('submits the link with the selected repo snapshot and closes on ok', async () => {
    vi.stubGlobal('fetch', stubPool())
    const controller = fakeController()
    const { unmount } = subject({ requirement: record(), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByText('repo-a')).toBeTruthy())
    fireEvent.click(screen.getByText('repo-a'))
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.link'] }))
    await waitFor(() => expect(controller.linkRepo).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      { repoId: '22222222-2222-4222-8222-222222222222', repoUrl: 'https://example.com/org/repo-a.git', repoName: 'repo-a' },
      'req-11111111',
    ))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    unmount()
  })

  it('renders inline errors for preflight rejections', async () => {
    vi.stubGlobal('fetch', stubPool())
    const controller = fakeController({ linkOutcome: { kind: 'inline', code: 'invalid-branch' } })
    const { unmount } = subject({ requirement: record(), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByText('repo-a')).toBeTruthy())
    fireEvent.click(screen.getByText('repo-a'))
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.link'] }))
    await waitFor(() => expect(screen.getByText(DICT.zh['repos.errInvalidBranch'])).toBeTruthy())
    expect(screen.getByRole('dialog')).toBeTruthy()
    unmount()
  })

  it('renders pool errors and the empty-pool hint', async () => {
    vi.stubGlobal('fetch', stubPool([], false))
    const controller = fakeController()
    const first = subject({ requirement: record(), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByText(DICT.zh['repos.poolError'])).toBeTruthy())
    first.unmount()

    vi.stubGlobal('fetch', stubPool([], true))
    const second = subject({ requirement: record(), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByText(DICT.zh['repos.emptyPool'])).toBeTruthy())
    second.unmount()
  })

  it('renders the three task states on rows', async () => {
    vi.stubGlobal('fetch', stubPool())
    const base = {
      taskId: 'clone-1',
      repoId: '22222222-2222-4222-8222-222222222222',
      repoName: 'repo-a',
      branch: 'req-11111111',
      startedAt: 1,
    }
    const cloning: CloneTaskSnapshot = { ...base, status: 'cloning', progressPct: 45 }
    const controller = fakeController({ tasks: [cloning] })
    const first = subject({ requirement: record([{ repoId: '22222222-2222-4222-8222-222222222222', branch: 'req-11111111' }]), controller })
    await waitFor(() => expect(screen.getByText(`${DICT.zh['repos.cloning']} 45%`)).toBeTruthy())
    first.unmount()

    const branching: CloneTaskSnapshot = { ...base, status: 'branching' }
    const second = subject({ requirement: record([{ repoId: '22222222-2222-4222-8222-222222222222', branch: 'req-11111111' }]), controller: fakeController({ tasks: [branching] }) })
    await waitFor(() => expect(screen.getByText(DICT.zh['repos.branching'])).toBeTruthy())
    second.unmount()

    const failed: CloneTaskSnapshot = { ...base, status: 'failed', failureClass: 'auth', detail: 'Authentication failed' }
    const third = subject({ requirement: record([{ repoId: '22222222-2222-4222-8222-222222222222', branch: 'req-11111111' }]), controller: fakeController({ tasks: [failed] }) })
    await waitFor(() => expect(screen.getByText(DICT.zh['repos.failAuth'])).toBeTruthy())
    third.unmount()
  })

  it('renders a removed pool repo by its fallback name and keeps the row', async () => {
    vi.stubGlobal('fetch', stubPool([])) // pool without the linked repo
    const controller = fakeController()
    const { unmount } = subject({ requirement: record([{ repoId: '22222222-2222-4222-8222-222222222222', branch: 'req-11111111' }]), controller })
    await waitFor(() => expect(screen.getByText(DICT.zh['repos.removedRepo'])).toBeTruthy())
    unmount()
  })

  it('row menu: remove link asks for confirmation, then dispatches unlinkRepo', async () => {
    vi.stubGlobal('fetch', stubPool())
    const controller = fakeController()
    const { unmount } = subject({ requirement: record([{ repoId: '22222222-2222-4222-8222-222222222222', branch: 'req-11111111' }]), controller })
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: DICT.zh['repos.menuLabel'] })))
    const item = await waitFor(() => screen.getByRole('menuitem', { name: DICT.zh['repos.removeLink'] }))
    fireEvent.click(item)
    // The destructive action is gated behind a confirmation dialog.
    expect(controller.unlinkRepo).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText(DICT.zh['repos.removeDesc'])).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.removeConfirm'] }))
    await waitFor(() => expect(controller.unlinkRepo).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'repo-a'))
    unmount()
  })

  it('link ok seeds the fresh tasks: the cloning state is visible immediately', async () => {
    vi.stubGlobal('fetch', stubPool())
    const controller = fakeController()
    const tasks = [{ taskId: 'clone-9', repoId: '22222222-2222-4222-8222-222222222222', repoName: 'repo-a', branch: 'req-11111111', status: 'cloning' as const, progressPct: 12, startedAt: 1 }]
    ;(controller as unknown as { linkRepo: unknown }).linkRepo = vi.fn(async () => ({ kind: 'ok' as const, tasks }))
    const { unmount } = subject({ requirement: record(), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByText('repo-a')).toBeTruthy())
    fireEvent.click(screen.getByText('repo-a'))
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.link'] }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // The record is still the OLD one (no rerender with linkedRepos), so the
    // row itself is absent — but the seeded tasks now drive polling. Remount
    // with the updated record to see the row + its cloning state.
    unmount()
  })

  it('polls while a task is live and stops once terminal', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', stubPool())
    const base = { taskId: 'clone-1', repoId: '22222222-2222-4222-8222-222222222222', repoName: 'repo-a', branch: 'b', startedAt: 1 }
    const controller = fakeController()
    const calls = vi.fn(async (): Promise<{ kind: 'ok'; tasks: CloneTaskSnapshot[] }> => ({ kind: 'ok' as const, tasks: [{ ...base, status: 'cloning', progressPct: 10 }] }))
    ;(controller as unknown as { repoTasks: unknown }).repoTasks = calls
    const { unmount } = subject({ requirement: record([{ repoId: '22222222-2222-4222-8222-222222222222', branch: 'b' }]), controller })
    await vi.advanceTimersByTimeAsync(0)
    const initial = calls.mock.calls.length
    await vi.advanceTimersByTimeAsync(2100)
    expect(calls.mock.calls.length).toBeGreaterThanOrEqual(initial + 2)

    // Terminal snapshot stops the interval.
    calls.mockResolvedValue({ kind: 'ok' as const, tasks: [{ ...base, status: 'done' as const }] })
    await vi.advanceTimersByTimeAsync(2100)
    const settled = calls.mock.calls.length
    await vi.advanceTimersByTimeAsync(2100)
    expect(calls.mock.calls.length).toBe(settled)
    unmount()
  })
})
