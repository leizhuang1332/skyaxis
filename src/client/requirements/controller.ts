/**
 * Requirements controller: fetch → store orchestration (the repos-pool
 * controller shape, adapted). Owns no subscriptions — the page pulls
 * `refresh()` on mount; conflict/not-found outcomes self-heal by refreshing
 * so the revision realigns.
 */
import type { RequirementRecord, SaveRequestBody } from '../../requirements-shared/protocol.js'
import type { RequirementsStore } from './store.js'
import type { RequirementsFetcher } from './fetcher.js'

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
      patch({ busy: false, revision: result.revision, requirements: store.getSnapshot().requirements.filter((requirement) => requirement.id !== id), banner: undefined })
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
    openEdit: (requirement: RequirementRecord) => patch({ editing: { kind: 'edit', requirement }, banner: undefined }),
    closeForm: () => patch({ editing: { kind: 'closed' } }),
    dismissBanner: () => patch({ banner: undefined }),
    dispose: () => {
      disposed = true
    },
  }
}

export type RequirementsController = ReturnType<typeof createRequirementsController>
