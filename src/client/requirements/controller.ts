/**
 * Requirements controller: fetch → store orchestration (the repos-pool
 * controller shape, adapted). Owns no subscriptions — the page pulls
 * `refresh()` on mount; conflict/not-found outcomes self-heal by refreshing
 * so the revision realigns.
 */
import type { CloneTaskSnapshot, RequirementRecord, ReposMutateRequestBody, SaveRequestBody, WorkspaceSetRequestBody } from '../../requirements-shared/protocol.js'
import type { RequirementsStore, RequirementSort } from './store.js'
import type { RequirementsFetcher, ReposScanResult, ReposTasksResult, WorkspaceStatusResult } from './fetcher.js'

/** Workspace mutation outcome: 'invalid-path' stays inline (no banner). */
export type WorkspaceOutcome = 'ok' | 'invalid-path' | 'failed'

/**
 * Linked-repo mutation outcome: business rejections (the preflight family)
 * stay inline next to the form; transport/conflict failures banner.
 */
export type ReposOutcome =
  | { kind: 'ok'; tasks: readonly CloneTaskSnapshot[] }
  | { kind: 'inline'; code: 'no-workspace' | 'invalid-branch' | 'dest-exists' | 'dest-missing' | 'no-branch' | 'busy' | 'too-many' | 'git-missing' | 'bad-request' }
  | { kind: 'failed' }

export function createRequirementsController(store: RequirementsStore, fetcher: RequirementsFetcher) {
  let disposed = false
  let refreshSeq = 0
  const alive = <T>(value: T | undefined): value is T => value !== undefined && !disposed

  const patch = (partial: Partial<Parameters<RequirementsStore['set']>[0]>): void => {
    if (disposed) return
    store.set({ ...store.getSnapshot(), ...partial })
  }

  async function refresh(signal?: AbortSignal): Promise<void> {
    // Focus-triggered refreshes can race an in-flight one; a late older
    // response must not overwrite a newer snapshot.
    const seq = ++refreshSeq
    const result = await fetcher.list(signal)
    if (!alive(result) || seq !== refreshSeq) return
    // Banners deliberately survive a refresh: the self-heal path (conflict /
    // not-found → refresh) sets the banner first, and the user must still see
    // it after the list realigns. Successful saves/removes and explicit
    // dismissal clear banners.
    if (result.kind === 'ok') {
      patch({ phase: 'ready', revision: result.revision, requirements: result.requirements, degraded: undefined })
      return
    }
    if (result.kind === 'degraded') {
      patch({ phase: 'degraded', revision: 0, requirements: [], degraded: { reason: result.reason, hasBackup: result.hasBackup } })
      return
    }
    patch({ phase: 'load-error' })
  }

  async function save(input: SaveRequestBody, signal?: AbortSignal): Promise<boolean> {
    patch({ busy: true })
    const result = await fetcher.save(input, signal)
    if (!alive(result)) return false
    if (result.kind === 'ok') {
      const snapshot = store.getSnapshot()
      const exists = snapshot.requirements.some((requirement) => requirement.id === result.requirement.id)
      patch({
        busy: false,
        revision: result.revision,
        requirements: exists
          ? snapshot.requirements.map((requirement) => (requirement.id === result.requirement.id ? result.requirement : requirement))
          : [...snapshot.requirements, result.requirement],
        editing: { kind: 'closed' },
        banner: undefined,
      })
      return true
    }
    patch({ busy: false })
    if (result.kind === 'network') {
      patch({ banner: { code: 'network' } })
      return false
    }
    if (result.status === 409 && result.code === 'conflict') {
      patch({ banner: { code: 'conflict', revision: result.currentRevision } })
      await refresh(signal)
      return false
    }
    if (result.status === 404) {
      patch({ banner: { code: 'not-found' } })
      await refresh(signal)
      return false
    }
    if (result.code !== undefined) {
      patch({ banner: { code: result.code as 'unreadable-file' | 'bad-request' | 'internal' } })
      return false
    }
    patch({ banner: { code: 'internal' } })
    return false
  }

  async function remove(id: string, signal?: AbortSignal): Promise<void> {
    patch({ busy: true })
    const result = await fetcher.remove({ expectedRevision: store.getSnapshot().revision, id }, signal)
    if (!alive(result)) return
    if (result.kind === 'ok') {
      const { requirements, detailTabByRequirement } = store.getSnapshot()
      const tabMemory = { ...detailTabByRequirement }
      delete tabMemory[id] // the record is gone; its tab memory retires with it
      patch({ busy: false, revision: result.revision, requirements: requirements.filter((requirement) => requirement.id !== id), detailTabByRequirement: tabMemory, banner: undefined })
      return
    }
    patch({ busy: false })
    if (result.kind === 'network') {
      patch({ banner: { code: 'network' } })
      return
    }
    if (result.status === 409 && result.code === 'conflict') {
      patch({ banner: { code: 'conflict', revision: result.currentRevision } })
      await refresh(signal)
      return
    }
    if (result.status === 404) {
      patch({ banner: { code: 'not-found' } })
      await refresh(signal)
      return
    }
    patch({ banner: { code: result.code === 'unreadable-file' ? 'unreadable-file' : 'internal' } })
  }

  /** Pass-through read for the workspace tab (status never enters the page store). */
  async function workspaceStatus(id: string, signal?: AbortSignal): Promise<WorkspaceStatusResult | undefined> {
    const result = await fetcher.workspaceStatus(id, signal)
    return alive(result) ? result : undefined
  }

  async function mutateWorkspace(body: WorkspaceSetRequestBody, signal?: AbortSignal): Promise<WorkspaceOutcome> {
    patch({ busy: true })
    const result = await fetcher.setWorkspace(body, signal)
    if (!alive(result)) return 'failed'
    if (result.kind === 'ok') {
      const snapshot = store.getSnapshot()
      patch({
        busy: false,
        revision: result.revision,
        requirements: snapshot.requirements.map((requirement) =>
          requirement.id === result.requirement.id ? result.requirement : requirement),
        banner: undefined,
      })
      return 'ok'
    }
    patch({ busy: false })
    if (result.kind === 'network') {
      patch({ banner: { code: 'network' } })
      return 'failed'
    }
    // Path validation failures render inline next to the input, never as a banner.
    if (result.code === 'invalid-path') return 'invalid-path'
    if (result.status === 409 && result.code === 'conflict') {
      patch({ banner: { code: 'conflict', revision: result.currentRevision } })
      await refresh(signal)
      return 'failed'
    }
    if (result.status === 404) {
      patch({ banner: { code: 'not-found' } })
      await refresh(signal)
      return 'failed'
    }
    if (result.code !== undefined) {
      patch({ banner: { code: result.code as 'unreadable-file' | 'bad-request' | 'internal' } })
      return 'failed'
    }
    patch({ banner: { code: 'internal' } })
    return 'failed'
  }

  async function setWorkspace(id: string, path: string, signal?: AbortSignal): Promise<WorkspaceOutcome> {
    return mutateWorkspace({ expectedRevision: store.getSnapshot().revision, id, action: 'set', path }, signal)
  }

  async function clearWorkspace(id: string, signal?: AbortSignal): Promise<WorkspaceOutcome> {
    return mutateWorkspace({ expectedRevision: store.getSnapshot().revision, id, action: 'clear' }, signal)
  }

  /** Registry-only repair: no ledger write, so no store change on success. */
  async function repoTasks(id: string, signal?: AbortSignal): Promise<ReposTasksResult | undefined> {
    const result = await fetcher.repoTasks(id, signal)
    return alive(result) ? result : undefined
  }

  /** Pass-through read for the discovery strip (scan facts never enter the page store). */
  async function repoScan(id: string, signal?: AbortSignal): Promise<ReposScanResult | undefined> {
    const result = await fetcher.repoScan(id, signal)
    return alive(result) ? result : undefined
  }

  const REPOS_INLINE_CODES = new Set(['no-workspace', 'invalid-branch', 'dest-exists', 'dest-missing', 'no-branch', 'busy', 'too-many', 'git-missing', 'bad-request'])

  async function mutateRepos(body: ReposMutateRequestBody, updatesRecord: boolean, signal?: AbortSignal): Promise<ReposOutcome> {
    const result = await fetcher.mutateRepos(body, signal)
    if (!alive(result)) return { kind: 'failed' }
    if (result.kind === 'ok') {
      if (updatesRecord && 'requirement' in result) {
        const snapshot = store.getSnapshot()
        patch({
          revision: result.revision,
          requirements: snapshot.requirements.map((requirement) =>
            requirement.id === result.requirement.id ? result.requirement : requirement),
          banner: undefined,
        })
      }
      return { kind: 'ok', tasks: result.tasks }
    }
    if (result.kind === 'network') {
      patch({ banner: { code: 'network' } })
      return { kind: 'failed' }
    }
    if (REPOS_INLINE_CODES.has(result.code ?? '')) {
      return { kind: 'inline', code: result.code as 'no-workspace' }
    }
    if (result.status === 409 && result.code === 'conflict') {
      patch({ banner: { code: 'conflict', revision: result.currentRevision } })
      await refresh(signal)
      return { kind: 'failed' }
    }
    if (result.status === 404) {
      patch({ banner: { code: 'not-found' } })
      await refresh(signal)
      return { kind: 'failed' }
    }
    patch({ banner: { code: 'internal' } })
    return { kind: 'failed' }
  }

  async function linkRepo(id: string, repo: { repoId: string; repoUrl: string; repoName: string }, branch: string, signal?: AbortSignal): Promise<ReposOutcome> {
    return mutateRepos({ expectedRevision: store.getSnapshot().revision, id, action: 'link', ...repo, branch }, true, signal)
  }

  /** Reverse-link an already-cloned directory — branch is host-read, never sent. */
  async function adoptRepo(id: string, repo: { repoId: string; repoName: string }, signal?: AbortSignal): Promise<ReposOutcome> {
    return mutateRepos({ expectedRevision: store.getSnapshot().revision, id, action: 'adopt', ...repo }, true, signal)
  }

  async function unlinkRepo(id: string, repoId: string, repoName?: string, signal?: AbortSignal): Promise<ReposOutcome> {
    return mutateRepos({ expectedRevision: store.getSnapshot().revision, id, action: 'unlink', repoId, ...(repoName !== undefined ? { repoName } : {}) }, true, signal)
  }

  async function recloneRepo(id: string, repo: { repoId: string; repoUrl: string; repoName: string }, signal?: AbortSignal): Promise<ReposOutcome> {
    return mutateRepos({ id, action: 'reclone', ...repo }, false, signal)
  }

  async function cancelRepoClone(id: string, repoId: string, signal?: AbortSignal): Promise<ReposOutcome> {
    return mutateRepos({ id, action: 'cancel', repoId }, false, signal)
  }

  async function rebindWorkspace(id: string, signal?: AbortSignal): Promise<WorkspaceOutcome> {
    const result = await fetcher.rebindWorkspace(id, signal)
    if (!alive(result)) return 'failed'
    if (result.kind === 'ok') return 'ok'
    if (result.kind === 'network') {
      patch({ banner: { code: 'network' } })
      return 'failed'
    }
    if (result.code === 'invalid-path') return 'invalid-path'
    if (result.status === 404) {
      patch({ banner: { code: 'not-found' } })
      await refresh(signal)
      return 'failed'
    }
    if (result.code !== undefined) {
      patch({ banner: { code: result.code as 'unreadable-file' | 'bad-request' | 'internal' } })
      return 'failed'
    }
    patch({ banner: { code: 'internal' } })
    return 'failed'
  }

  return {
    refresh,
    save,
    remove,
    workspaceStatus,
    setWorkspace,
    clearWorkspace,
    rebindWorkspace,
    repoTasks,
    repoScan,
    linkRepo,
    adoptRepo,
    unlinkRepo,
    recloneRepo,
    cancelRepoClone,
    openCreate: () => patch({ editing: { kind: 'create' }, banner: undefined }),
    openEdit: (requirement: RequirementRecord) => patch({ editing: { kind: 'edit', requirement }, banner: undefined }),
    closeForm: () => patch({ editing: { kind: 'closed' } }),
    // Detail view (0003 P1). openDetail rides a refresh so the pulled-only
    // model keeps the record fresh on entry; refresh never clears selectedId
    // — a vanished record is the detail view's missing branch, not a pop.
    // Tab state is a PER-REQUIREMENT memory (0004 follow-up): selectDetailTab
    // records under the live id, every entry path (list or switcher) lands
    // on that requirement's remembered tab, and only remove() retires an
    // entry (with its record). The list round-trip never wipes memories.
    openDetail: (id: string) => {
      patch({ selectedId: id })
      void refresh()
    },
    closeDetail: () => patch({ selectedId: null }),
    selectDetailTab: (tabId: string) => {
      const { selectedId, detailTabByRequirement } = store.getSnapshot()
      if (selectedId === null) return
      patch({ detailTabByRequirement: { ...detailTabByRequirement, [selectedId]: tabId } })
    },
    setListFilter: (text: string) => patch({ listFilter: text }),
    // Ordering is a pure view projection (sortRequirements in store.ts): the
    // ledger keeps file order as the source of truth, so a refresh or a save
    // never has to remember the sort — only this field carries it.
    setListSort: (sort: RequirementSort) => patch({ listSort: sort }),
    dismissBanner: () => patch({ banner: undefined }),
    dispose: () => {
      disposed = true
    },
  }
}

export type RequirementsController = ReturnType<typeof createRequirementsController>
