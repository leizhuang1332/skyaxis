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
import type { CloneTaskSnapshot, RepoDirScanRow, RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { RepoRecord, RepoStatus } from '../../src/repos-pool-shared/protocol.js'
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
    'repos.recommended': '推荐',
    'repos.statusVerified': '已验证',
    'repos.statusUnverified': '未验证',
    'repos.statusForcedNetwork': '已保存（网络不可达）',
    'repos.statusForcedAuth': '已保存（无权限）',
    'repos.scanTitle': '发现可关联的仓库',
    'repos.scanHint': '工作区 repos/ 目录中检测到已克隆但未关联的仓库，关联不会重新克隆。',
    'repos.adopt': '关联',
    'repos.errDestMissing': '目录已不存在，请刷新页面后重试',
    'repos.errNoBranch': '无法读取分支（非 git 仓库或 detached HEAD）',
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
  urlHttp: `https://example.com/org/${name}.git`,
  description: '',
  statusHttp: 'verified',
  validatedAtHttp: '2026-09-25T09:30:00.000Z',
  lastErrorHttp: null,
})

/** Dual-address factory (0005 P4): per-slot statuses drive the pickAddress
 * recommendation ordering the picker asserts on. */
const dualRepo = (id: string, name: string, sshStatus: RepoStatus = 'verified', httpStatus: RepoStatus = 'verified'): RepoRecord => ({
  id,
  name,
  description: '',
  urlSsh: `git@example.com:org/${name}.git`,
  statusSsh: sshStatus,
  validatedAtSsh: '2026-09-25T09:30:00.000Z',
  lastErrorSsh: null,
  urlHttp: `https://example.com/org/${name}.git`,
  statusHttp: httpStatus,
  validatedAtHttp: '2026-09-25T09:30:00.000Z',
  lastErrorHttp: null,
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

function fakeController(options?: { tasks?: readonly CloneTaskSnapshot[]; linkOutcome?: ReposOutcome; scanDirs?: readonly RepoDirScanRow[]; adoptOutcome?: ReposOutcome }) {
  return {
    repoTasks: vi.fn(async () => ({ kind: 'ok' as const, tasks: options?.tasks ?? [] })),
    repoScan: vi.fn(async () => ({ kind: 'ok' as const, dirs: options?.scanDirs ?? [] })),
    linkRepo: vi.fn(async (): Promise<ReposOutcome> => options?.linkOutcome ?? { kind: 'ok', tasks: [] }),
    adoptRepo: vi.fn(async (): Promise<ReposOutcome> => options?.adoptOutcome ?? { kind: 'ok', tasks: [] }),
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

describe('ReposSection (0005 P4: dual-address picker)', () => {
  const DUAL_ID = '22222222-2222-4222-8222-222222222222'
  const REQUIREMENT_ID = '11111111-1111-4111-8111-111111111111'

  it('recommends the verified http address over an unverified ssh one and snapshots it on link', async () => {
    vi.stubGlobal('fetch', stubPool([dualRepo(DUAL_ID, 'repo-a', 'unverified', 'verified')]))
    const controller = fakeController()
    const { unmount } = subject({ requirement: record(), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByText('repo-a')).toBeTruthy())
    // The badge rides the recommended (https) address button, not the ssh one.
    const badge = screen.getByText(DICT.zh['repos.recommended'])
    expect(badge.closest('button')?.textContent).toContain('https://example.com/org/repo-a.git')
    expect(badge.closest('button')?.textContent).not.toContain('git@example.com:org/repo-a.git')
    expect(screen.getByText(DICT.zh['repos.statusVerified'])).toBeTruthy()
    expect(screen.getByText(DICT.zh['repos.statusUnverified'])).toBeTruthy()
    fireEvent.click(screen.getByText('repo-a'))
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.link'] }))
    await waitFor(() => expect(controller.linkRepo).toHaveBeenCalledWith(
      REQUIREMENT_ID,
      { repoId: DUAL_ID, repoUrl: 'https://example.com/org/repo-a.git', repoName: 'repo-a' },
      'req-11111111',
    ))
    unmount()
  })

  it('recommends verified http over forced ssh and renders the forced status tags', async () => {
    vi.stubGlobal('fetch', stubPool([
      dualRepo(DUAL_ID, 'repo-a', 'forced-network', 'verified'),
      dualRepo('33333333-3333-4333-8333-333333333333', 'repo-b', 'forced-auth', 'verified'),
    ]))
    const controller = fakeController()
    const { unmount } = subject({ requirement: record(), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByText('repo-a')).toBeTruthy())
    // Both rows carry a recommended http line ⇒ two badges: locate repo-a's
    // http line by its URL, not by the badge text.
    const aHttpButton = screen.getByText('https://example.com/org/repo-a.git').closest('button')
    expect(aHttpButton?.textContent).toContain(DICT.zh['repos.recommended'])
    expect(screen.getByText(DICT.zh['repos.statusForcedNetwork'])).toBeTruthy()
    expect(screen.getByText(DICT.zh['repos.statusForcedAuth'])).toBeTruthy()
    fireEvent.click(screen.getByText('repo-a'))
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.link'] }))
    await waitFor(() => expect(controller.linkRepo).toHaveBeenCalledWith(
      REQUIREMENT_ID,
      { repoId: DUAL_ID, repoUrl: 'https://example.com/org/repo-a.git', repoName: 'repo-a' },
      'req-11111111',
    ))
    unmount()
  })

  it('prefers ssh within the same trust tier and snapshots it on link', async () => {
    vi.stubGlobal('fetch', stubPool([dualRepo(DUAL_ID, 'repo-a', 'verified', 'verified')]))
    const controller = fakeController()
    const { unmount } = subject({ requirement: record(), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByText('repo-a')).toBeTruthy())
    const badge = screen.getByText(DICT.zh['repos.recommended'])
    expect(badge.closest('button')?.textContent).toContain('git@example.com:org/repo-a.git')
    expect(badge.closest('button')?.textContent).not.toContain('https://example.com/org/repo-a.git')
    // The SSH label rides the same button as the ssh URL (label↔URL pairing).
    expect(screen.getByText('SSH').closest('button')?.textContent).toContain('git@example.com:org/repo-a.git')
    fireEvent.click(screen.getByText('repo-a'))
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.link'] }))
    await waitFor(() => expect(controller.linkRepo).toHaveBeenCalledWith(
      REQUIREMENT_ID,
      { repoId: DUAL_ID, repoUrl: 'git@example.com:org/repo-a.git', repoName: 'repo-a' },
      'req-11111111',
    ))
    unmount()
  })

  it('pins the manually picked address and moves the recommended badge back', async () => {
    vi.stubGlobal('fetch', stubPool([dualRepo(DUAL_ID, 'repo-a', 'verified', 'verified')]))
    const controller = fakeController()
    const { unmount } = subject({ requirement: record(), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByText('repo-a')).toBeTruthy())
    // Name-row click takes the recommendation (ssh): picked ⇒ no badge.
    fireEvent.click(screen.getByText('repo-a'))
    expect(screen.queryByText(DICT.zh['repos.recommended'])).toBeNull()
    const httpButton = screen.getByText('https://example.com/org/repo-a.git').closest('button')
    expect(httpButton).toBeTruthy()
    fireEvent.click(httpButton as HTMLElement)
    // Pinned http: the badge reappears on the ssh line as the way back.
    const badge = screen.getByText(DICT.zh['repos.recommended'])
    expect(badge.closest('button')?.textContent).toContain('git@example.com:org/repo-a.git')
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.link'] }))
    await waitFor(() => expect(controller.linkRepo).toHaveBeenCalledWith(
      REQUIREMENT_ID,
      { repoId: DUAL_ID, repoUrl: 'https://example.com/org/repo-a.git', repoName: 'repo-a' },
      'req-11111111',
    ))
    unmount()
  })

  it('reclone snapshots the current recommended address (the D7 known behavior)', async () => {
    vi.stubGlobal('fetch', stubPool([dualRepo(DUAL_ID, 'repo-a', 'unverified', 'verified')]))
    const controller = fakeController()
    const { unmount } = subject({ requirement: record([{ repoId: DUAL_ID, branch: 'req-11111111' }]), controller })
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: DICT.zh['repos.menuLabel'] })))
    fireEvent.click(await waitFor(() => screen.getByRole('menuitem', { name: DICT.zh['repos.reclone'] })))
    await waitFor(() => expect(controller.recloneRepo).toHaveBeenCalledWith(
      REQUIREMENT_ID,
      { repoId: DUAL_ID, repoUrl: 'https://example.com/org/repo-a.git', repoName: 'repo-a' },
    ))
    unmount()
  })

  it('filters rows on either address, not just the recommended one', async () => {
    vi.stubGlobal('fetch', stubPool([
      dualRepo(DUAL_ID, 'repo-a', 'verified', 'verified'),
      poolRepo('33333333-3333-4333-8333-333333333333', 'repo-b'),
    ]))
    const controller = fakeController()
    const { unmount } = subject({ requirement: record(), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByText('repo-a')).toBeTruthy())
    const input = screen.getByPlaceholderText(DICT.zh['view.filterPlaceholder'])
    // ssh-only needle: matched by the NON-recommended sibling address of repo-a.
    fireEvent.change(input, { target: { value: 'git@example.com:org/repo-a' } })
    expect(screen.getByText('repo-a')).toBeTruthy()
    expect(screen.queryByText('repo-b')).toBeNull()
    fireEvent.change(input, { target: { value: 'org/repo-b' } })
    expect(screen.getByText('repo-b')).toBeTruthy()
    expect(screen.queryByText('repo-a')).toBeNull()
    fireEvent.change(input, { target: { value: 'no-such-host' } })
    expect(screen.queryByText('repo-a')).toBeNull()
    expect(screen.queryByText('repo-b')).toBeNull()
    unmount()
  })

  it('renders both addresses on a linked row with slot labels', async () => {
    vi.stubGlobal('fetch', stubPool([dualRepo(DUAL_ID, 'repo-a', 'unverified', 'verified')]))
    const controller = fakeController()
    const { unmount } = subject({ requirement: record([{ repoId: DUAL_ID, branch: 'req-11111111' }]), controller })
    await waitFor(() => expect(screen.getByText('git@example.com:org/repo-a.git')).toBeTruthy())
    expect(screen.getByText('https://example.com/org/repo-a.git')).toBeTruthy()
    // Label↔URL pairing: each slot label's sibling is that slot's URL.
    expect(screen.getByText('SSH').nextElementSibling?.textContent).toBe('git@example.com:org/repo-a.git')
    expect(screen.getByText('HTTP').nextElementSibling?.textContent).toBe('https://example.com/org/repo-a.git')
    unmount()
  })

  it('single-address rows keep one whole-row button with no recommendation badge', async () => {
    vi.stubGlobal('fetch', stubPool([poolRepo(DUAL_ID, 'repo-a')]))
    const controller = fakeController()
    const { unmount } = subject({ requirement: record(), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByText('repo-a')).toBeTruthy())
    expect(screen.queryByText(DICT.zh['repos.recommended'])).toBeNull()
    // The name and its single address share ONE button (click-anywhere row).
    const rowButton = screen.getByText('repo-a').closest('button')
    expect(rowButton?.textContent).toContain('https://example.com/org/repo-a.git')
    unmount()
  })

  it('re-selecting another repo drops the pinned slot (no stale-slot snapshot)', async () => {
    vi.stubGlobal('fetch', stubPool([
      dualRepo(DUAL_ID, 'repo-a', 'verified', 'verified'),
      dualRepo('33333333-3333-4333-8333-333333333333', 'repo-b', 'verified', 'verified'),
    ]))
    const controller = fakeController()
    const { unmount } = subject({ requirement: record(), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByText('repo-a')).toBeTruthy())
    // Pin repo-a's http, then switch repos via the NAME row: repo-b must come
    // in on its own recommendation (ssh), never the carried-over http pin.
    fireEvent.click(screen.getByText('https://example.com/org/repo-a.git').closest('button') as HTMLElement)
    fireEvent.click(screen.getByText('repo-b'))
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.link'] }))
    await waitFor(() => expect(controller.linkRepo).toHaveBeenCalledWith(
      REQUIREMENT_ID,
      { repoId: '33333333-3333-4333-8333-333333333333', repoUrl: 'git@example.com:org/repo-b.git', repoName: 'repo-b' },
      'req-11111111',
    ))
    unmount()
  })

  it('link stays disabled until a repo is picked; re-clicking the name row deselects', async () => {
    vi.stubGlobal('fetch', stubPool([dualRepo(DUAL_ID, 'repo-a', 'verified', 'verified')]))
    const controller = fakeController()
    const { unmount } = subject({ requirement: record(), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByText('repo-a')).toBeTruthy())
    const link = () => screen.getByRole('button', { name: DICT.zh['repos.link'] }) as HTMLButtonElement
    expect(link().disabled).toBe(true)
    fireEvent.click(screen.getByText('repo-a'))
    expect(link().disabled).toBe(false)
    // Toggle off — the only deselect path: the badge returns, link re-disables.
    fireEvent.click(screen.getByText('repo-a'))
    expect(link().disabled).toBe(true)
    expect(screen.getByText(DICT.zh['repos.recommended'])).toBeTruthy()
    unmount()
  })

  it('reopening the picker resets the selection', async () => {
    vi.stubGlobal('fetch', stubPool([dualRepo(DUAL_ID, 'repo-a', 'verified', 'verified')]))
    const controller = fakeController()
    const { unmount } = subject({ requirement: record(), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByText('repo-a')).toBeTruthy())
    fireEvent.click(screen.getByText('repo-a'))
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['form.cancel'] }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Reopen: no stale pick — badge visible again, link disabled again.
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByText('repo-a')).toBeTruthy())
    expect(screen.getByText(DICT.zh['repos.recommended'])).toBeTruthy()
    expect((screen.getByRole('button', { name: DICT.zh['repos.link'] }) as HTMLButtonElement).disabled).toBe(true)
    unmount()
  })
})

describe('ReposSection (reverse-link discovery: repos/ scan + adopt)', () => {
  const REQUIREMENT_ID = '11111111-1111-4111-8111-111111111111'
  const REPO_A_ID = '22222222-2222-4222-8222-222222222222'
  const REPO_B_ID = '33333333-3333-4333-8333-333333333333'

  const scanRow = (name: string, overrides?: Partial<RepoDirScanRow>): RepoDirScanRow => ({
    name,
    isGitRepo: true,
    branch: 'main',
    ...(overrides ?? {}),
  })

  it('renders adoptable pool repos from the scan, skipping non-git, detached, linked and orphan dirs', async () => {
    vi.stubGlobal('fetch', stubPool())
    const controller = fakeController({
      scanDirs: [
        scanRow('repo-a'),                                  // adoptable
        scanRow('plain-dir', { isGitRepo: false }),         // not a repo
        scanRow('detached', { branch: undefined }),         // detached HEAD
        scanRow('repo-b'),                                  // matches pool repo-b, but LINKED below
        scanRow('orphan'),                                  // no pool repo derives this name
      ],
    })
    const { unmount } = subject({
      requirement: record([{ repoId: REPO_B_ID, branch: 'req-11111111' }]),
      controller,
    })
    await waitFor(() => expect(screen.getByText(DICT.zh['repos.scanTitle'])).toBeTruthy())
    expect(screen.getByText(DICT.zh['repos.scanHint'])).toBeTruthy()
    // Exactly one adoptable row: repo-a with its on-disk branch and the action.
    expect(screen.getByText('repo-a')).toBeTruthy()
    expect(screen.getByText('main')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: DICT.zh['repos.adopt'] })).toHaveLength(1)
    unmount()
  })

  it('renders the discovery strip in the EMPTY state too (lost ledger, surviving clones)', async () => {
    vi.stubGlobal('fetch', stubPool())
    const controller = fakeController({ scanDirs: [scanRow('repo-a', { branch: 'feature-x' })] })
    const { unmount } = subject({ requirement: record(), controller })
    await waitFor(() => expect(screen.getByText(DICT.zh['repos.scanTitle'])).toBeTruthy())
    expect(screen.getByText('feature-x')).toBeTruthy()
    expect(screen.getByRole('button', { name: DICT.zh['repos.adopt'] })).toBeTruthy()
    unmount()
  })

  it('adopt dispatches adoptRepo with the repo snapshot (no branch — host reads it)', async () => {
    vi.stubGlobal('fetch', stubPool())
    const controller = fakeController({ scanDirs: [scanRow('repo-a', { branch: 'dev' })] })
    const { unmount } = subject({ requirement: record(), controller })
    await waitFor(() => expect(screen.getByRole('button', { name: DICT.zh['repos.adopt'] })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.adopt'] }))
    await waitFor(() => expect(controller.adoptRepo).toHaveBeenCalledWith(REQUIREMENT_ID, { repoId: REPO_A_ID, repoName: 'repo-a' }))
    unmount()
  })

  it('renders the inline rejection copy when adopt fails', async () => {
    vi.stubGlobal('fetch', stubPool())
    const controller = fakeController({
      scanDirs: [scanRow('repo-a')],
      adoptOutcome: { kind: 'inline', code: 'dest-missing' },
    })
    const { unmount } = subject({ requirement: record(), controller })
    await waitFor(() => expect(screen.getByRole('button', { name: DICT.zh['repos.adopt'] })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.adopt'] }))
    await waitFor(() => expect(screen.getByText(DICT.zh['repos.errDestMissing'])).toBeTruthy())
    unmount()
  })

  it('breaks derived-name collisions with the origin url; an unbreakable tie stays unlisted', async () => {
    // "my repo" and "my-repo" both derive dirName "my-repo" — a name match
    // alone cannot pick; the scan's origin url must. (Full dual records: the
    // pool response guard requires per-slot url/status pairs.)
    const colliding = [
      { ...dualRepo(REPO_A_ID, 'my repo'), urlSsh: 'git@example.com:org/a.git' },
      { ...dualRepo(REPO_B_ID, 'my-repo'), urlSsh: 'git@example.com:org/b.git' },
    ]
    vi.stubGlobal('fetch', stubPool(colliding))
    const withUrl = fakeController({ scanDirs: [scanRow('my-repo', { remoteUrl: 'git@example.com:org/b.git' })] })
    const first = subject({ requirement: record(), controller: withUrl })
    await waitFor(() => expect(screen.getByText('my-repo')).toBeTruthy())
    expect(screen.queryByText('my repo')).toBeNull() // the url loser never lists
    first.unmount()

    // No url on the scan row: the tie is unbreakable — nothing lists. A
    // can-list row anchors readiness first, so the absence below is a real
    // join decision, not a not-yet-rendered frame.
    vi.stubGlobal('fetch', stubPool([...colliding, poolRepo('44444444-4444-4444-8444-444444444444', 'repo-anchor')]))
    const withoutUrl = fakeController({ scanDirs: [scanRow('my-repo', { remoteUrl: undefined }), scanRow('repo-anchor')] })
    const second = subject({ requirement: record(), controller: withoutUrl })
    await waitFor(() => expect(screen.getByText('repo-anchor')).toBeTruthy())
    expect(screen.queryByText('my repo')).toBeNull()
    expect(screen.queryByText('my-repo')).toBeNull()
    second.unmount()
  })

  it('leaves the dir unlisted when the origin url matches NO candidate (address rotation)', async () => {
    const colliding = [
      { ...dualRepo(REPO_A_ID, 'my repo'), urlSsh: 'git@example.com:org/a.git' },
      { ...dualRepo(REPO_B_ID, 'my-repo'), urlSsh: 'git@example.com:org/b.git' },
    ]
    // The clone predates a pool-side address change: its origin url matches
    // neither candidate — guessing by name is exactly what must NOT happen.
    vi.stubGlobal('fetch', stubPool([...colliding, poolRepo('44444444-4444-4444-8444-444444444444', 'repo-anchor')]))
    const controller = fakeController({ scanDirs: [
      scanRow('my-repo', { remoteUrl: 'git@example.com:org/other.git' }),
      scanRow('repo-anchor'),
    ] })
    const { unmount } = subject({ requirement: record(), controller })
    await waitFor(() => expect(screen.getByText('repo-anchor')).toBeTruthy())
    expect(screen.queryByText('my repo')).toBeNull()
    expect(screen.queryByText('my-repo')).toBeNull()
    unmount()
  })

  it('never re-offers a directory already claimed by a linked repo (occupancy guard)', async () => {
    // 'my repo' (linked) owns dirName 'my-repo'; the scan dir carries the url
    // of the UNLINKED 'my-repo' twin — a pure name/url join would offer it,
    // and adopting would point two ledger rows at one directory.
    const colliding = [
      { ...dualRepo(REPO_A_ID, 'my repo'), urlSsh: 'git@example.com:org/a.git' },
      { ...dualRepo(REPO_B_ID, 'my-repo'), urlSsh: 'git@example.com:org/b.git' },
    ]
    vi.stubGlobal('fetch', stubPool(colliding))
    const controller = fakeController({ scanDirs: [scanRow('my-repo', { remoteUrl: 'git@example.com:org/b.git' })] })
    const { unmount } = subject({
      requirement: record([{ repoId: REPO_A_ID, branch: 'req-11111111' }]),
      controller,
    })
    // Readiness: the pull ran and the linked row rendered; give the join a
    // frame to (wrongly) list, then hold the absence.
    await waitFor(() => expect(controller.repoScan).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('my repo')).toBeTruthy())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText(DICT.zh['repos.scanTitle'])).toBeNull()
    expect(screen.queryByRole('button', { name: DICT.zh['repos.adopt'] })).toBeNull()
    unmount()
  })

  it('stays silently hidden when the scan pull fails (no strip, no crash)', async () => {
    vi.stubGlobal('fetch', stubPool())
    const controller = fakeController()
    ;(controller as unknown as { repoScan: unknown }).repoScan = vi.fn(async () => ({ kind: 'http-error' as const, status: 400, code: 'no-workspace' as const }))
    const { unmount } = subject({ requirement: record(), controller })
    await waitFor(() => expect(controller.repoScan).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText(DICT.zh['repos.scanTitle'])).toBeNull()
    expect(screen.queryByRole('button', { name: DICT.zh['repos.adopt'] })).toBeNull()
    unmount()
  })

  it('ignores a scan that lands after unmount (aborted pull writes no state)', async () => {
    vi.stubGlobal('fetch', stubPool())
    const controller = fakeController()
    let release: ((value: { kind: 'ok'; dirs: readonly RepoDirScanRow[] }) => void) | undefined
    ;(controller as unknown as { repoScan: unknown }).repoScan = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const { unmount } = subject({ requirement: record(), controller })
    await waitFor(() => expect(controller.repoScan).toHaveBeenCalledTimes(1))
    unmount()
    // The late ok-response must neither write state nor reject unhandled.
    release?.({ kind: 'ok', dirs: [scanRow('repo-a')] })
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  it('rescans when the workspace binding moves (rebind flow)', async () => {
    vi.stubGlobal('fetch', stubPool())
    const controller = fakeController({ scanDirs: [] })
    const utils = subject({ requirement: record(), controller })
    await waitFor(() => expect(controller.repoScan).toHaveBeenCalledTimes(1))
    utils.rerender(utils.element({ ...record(), workspacePath: '/ws-2' }, controller))
    await waitFor(() => expect(controller.repoScan).toHaveBeenCalledTimes(2))
    utils.unmount()
  })

  it('rescans after unlink deletes the directory — no dead adopt entry reappears', async () => {
    vi.stubGlobal('fetch', stubPool())
    const controller = fakeController()
    ;(controller as unknown as { repoScan: unknown }).repoScan = vi.fn()
      .mockResolvedValueOnce({ kind: 'ok' as const, dirs: [scanRow('repo-a', { branch: 'main' })] as readonly RepoDirScanRow[] })
      .mockResolvedValue({ kind: 'ok' as const, dirs: [] as readonly RepoDirScanRow[] })
    const { unmount } = subject({
      requirement: record([{ repoId: REPO_A_ID, branch: 'req-11111111' }]),
      controller,
    })
    // Dir row exists and repo-a is linked: occupancy hides the strip.
    await waitFor(() => expect(screen.getByText('repo-a')).toBeTruthy())
    expect(screen.queryByText(DICT.zh['repos.scanTitle'])).toBeNull()
    // Unlink (menu → confirm) deletes the directory host-side; the stale
    // snapshot would immediately re-offer repo-a — the rescan must run.
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.menuLabel'] }))
    fireEvent.click(await waitFor(() => screen.getByRole('menuitem', { name: DICT.zh['repos.removeLink'] })))
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.removeConfirm'] }))
    await waitFor(() => expect(controller.unlinkRepo).toHaveBeenCalled())
    await waitFor(() => expect(controller.repoScan).toHaveBeenCalledTimes(2))
    unmount()
  })
})

describe('ReposSection (branch carry-over default)', () => {
  it('prefills the picker with the LAST linked repo branch, falling back to the minted prefix', async () => {
    vi.stubGlobal('fetch', stubPool())
    const controller = fakeController()
    const links = [
      { repoId: '22222222-2222-4222-8222-222222222222', branch: 'feature-a' },
      { repoId: '33333333-3333-4333-8333-333333333333', branch: 'feature-b' },
    ]
    const { unmount } = subject({ requirement: record(links), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    // Carry-over: the LAST link's branch, not the minted req- prefix, not the first.
    expect(screen.getByDisplayValue('feature-b')).toBeTruthy()
    unmount()

    // No links yet: the minted default still seeds the first link.
    const fresh = subject({ requirement: record(), controller })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['repos.add'] }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByDisplayValue('req-11111111')).toBeTruthy()
    fresh.unmount()
  })
})
