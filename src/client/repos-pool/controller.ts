/**
 * Repos-pool controller: fetch → store orchestration (the official
 * PresentedOpenController shape, adapted). Owns no subscriptions — the page
 * pulls `refresh()` on mount; conflict/not-found outcomes self-heal by
 * refreshing so the revision realigns.
 */
import type { RepoRecord, SaveRequestBody } from '../../repos-pool-shared/protocol.js'
import type { ReposPoolStore } from './store.js'
import type { ReposFetcher } from './fetcher.js'

export function createReposPoolController(store: ReposPoolStore, fetcher: ReposFetcher) {
  let disposed = false
  const alive = <T>(value: T | undefined): value is T => value !== undefined && !disposed

  const patch = (partial: Partial<Parameters<ReposPoolStore['set']>[0]>): void => {
    if (disposed) return
    store.set({ ...store.getSnapshot(), ...partial })
  }

  async function refresh(signal?: AbortSignal): Promise<void> {
    const result = await fetcher.list(signal)
    if (!alive(result)) return
    // Banners deliberately survive a refresh: the self-heal path (conflict /
    // not-found → refresh) sets the banner first, and the user must still see
    // it after the list realigns. Successful saves/removes and explicit
    // dismissal clear banners.
    if (result.kind === 'ok') {
      patch({ phase: 'ready', revision: result.revision, repos: result.repos, degraded: undefined })
      return
    }
    if (result.kind === 'degraded') {
      patch({ phase: 'degraded', revision: 0, repos: [], degraded: { reason: result.reason, hasBackup: result.hasBackup } })
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
      const exists = snapshot.repos.some((repo) => repo.id === result.repo.id)
      patch({
        busy: false,
        revision: result.revision,
        repos: exists
          ? snapshot.repos.map((repo) => (repo.id === result.repo.id ? result.repo : repo))
          : [...snapshot.repos, result.repo],
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
      patch({ banner: { code: result.code as 'unreadable-file' | 'bad-request' | 'invalid-url' | 'duplicate-url' | 'internal' } })
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
      patch({ busy: false, revision: result.revision, repos: store.getSnapshot().repos.filter((repo) => repo.id !== id), banner: undefined })
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

  return {
    refresh,
    save,
    remove,
    openCreate: () => patch({ editing: { kind: 'create' }, banner: undefined }),
    openEdit: (repo: RepoRecord) => patch({ editing: { kind: 'edit', repo }, banner: undefined }),
    closeForm: () => patch({ editing: { kind: 'closed' } }),
    dismissBanner: () => patch({ banner: undefined }),
    dispose: () => {
      disposed = true
    },
  }
}

export type ReposPoolController = ReturnType<typeof createReposPoolController>
