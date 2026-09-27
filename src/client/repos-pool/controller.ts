/**
 * Repos-pool controller: fetch → store orchestration (the official
 * PresentedOpenController shape, adapted). Owns no subscriptions — the page
 * pulls `refresh()` on mount; conflict/not-found outcomes self-heal by
 * refreshing so the revision realigns.
 */
import type { AddressSlot, ImportReport, RepoRecord, SaveRequestBody } from '../../repos-pool-shared/protocol.js'
import type { ReposPoolStore } from './store.js'
import type { ReposFetcher } from './fetcher.js'

/** Save-time failure detail, surfaced by the caller (the form) — not a page banner. */
export type SaveFailure = {
  readonly code: 'network' | 'conflict' | 'not-found' | 'unreadable-file' | 'bad-request' | 'invalid-url' | 'duplicate-url' | 'internal'
  readonly reason?: import('../../repos-pool-shared/protocol.js').UrlRejection
  /** Which address slot the 422 refers to (decision 0004 / D4). */
  readonly field?: AddressSlot
  readonly revision?: number
}

export type SaveOutcome = { readonly kind: 'ok' } | ({ readonly kind: 'failed' } & SaveFailure)

/** Import failure detail, surfaced by the caller (the import dialog). */
export type ImportFailure = {
  readonly code: 'network' | 'conflict' | 'unreadable-file' | 'bad-request' | 'too-large' | 'internal'
  readonly revision?: number
}

export type ImportOutcome =
  | { readonly kind: 'ok'; readonly revision: number; readonly repos: readonly RepoRecord[]; readonly report: ImportReport }
  | ({ readonly kind: 'failed' } & ImportFailure)

export function createReposPoolController(store: ReposPoolStore, fetcher: ReposFetcher) {
  let disposed = false
  let refreshSeq = 0
  const alive = <T>(value: T | undefined): value is T => value !== undefined && !disposed

  const patch = (partial: Partial<Parameters<ReposPoolStore['set']>[0]>): void => {
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
      patch({ phase: 'ready', revision: result.revision, repos: result.repos, degraded: undefined })
      return
    }
    if (result.kind === 'degraded') {
      patch({ phase: 'degraded', revision: 0, repos: [], degraded: { reason: result.reason, hasBackup: result.hasBackup } })
      return
    }
    patch({ phase: 'load-error' })
  }

  /**
   * Failures are RETURNED, not bannered: the form owns their presentation
   * (in-dialog, per the host dialog pattern — a banner would sit invisible
   * behind the modal). conflict/not-found still self-heal via refresh so the
   * form's revision prop realigns for an immediate retry.
   */
  async function save(input: SaveRequestBody, signal?: AbortSignal): Promise<SaveOutcome> {
    patch({ busy: true })
    const result = await fetcher.save(input, signal)
    if (!alive(result)) return { kind: 'failed', code: 'internal' }
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
      return { kind: 'ok' }
    }
    patch({ busy: false })
    const failed = async (): Promise<SaveOutcome> => {
      if (result.kind === 'network') return { kind: 'failed', code: 'network' }
      if (result.status === 409 && result.code === 'conflict') {
        await refresh(signal)
        return { kind: 'failed', code: 'conflict', revision: result.currentRevision }
      }
      if (result.status === 404) {
        await refresh(signal)
        return { kind: 'failed', code: 'not-found', revision: result.currentRevision }
      }
      if (result.code === 'invalid-url') return { kind: 'failed', code: 'invalid-url', reason: result.reason, field: result.field }
      if (result.code !== undefined) return { kind: 'failed', code: result.code as SaveFailure['code'] }
      return { kind: 'failed', code: 'internal' }
    }
    return failed()
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

  /**
   * Import orchestration (decision 0004 / D5). `expectedRevision` is ALWAYS
   * the caller's — the real import must carry the revision the dry-run
   * response returned (the preview is anchored to that snapshot); reading it
   * from the store here would silently merge onto whatever snapshot a
   * background focus-refresh happened to land on. Failures are RETURNED, not
   * bannered: the dialog owns their presentation. conflict self-heals via
   * refresh (the dialog goes back to preview); network failures refresh too
   * so an immediate retry doesn't eat a guaranteed 409.
   */
  async function importRepos(content: string, options: { dryRun: boolean; expectedRevision: number }, signal?: AbortSignal): Promise<ImportOutcome> {
    patch({ busy: true })
    const result = await fetcher.importRepos({
      expectedRevision: options.expectedRevision,
      ...(options.dryRun ? { dryRun: true } : {}),
      content,
    }, signal)
    if (!alive(result)) return { kind: 'failed', code: 'internal' }
    patch({ busy: false })
    if (result.kind === 'ok') {
      if (!options.dryRun) {
        // Seed from the response snapshot (the save precedent — the merged
        // list is authoritative), then refresh as a belt-and-braces
        // realignment.
        patch({ phase: 'ready', revision: result.revision, repos: [...result.repos], degraded: undefined, banner: undefined })
        void refresh(signal)
      }
      return { kind: 'ok', revision: result.revision, repos: [...result.repos], report: result.report }
    }
    if (result.kind === 'network') {
      await refresh(signal)
      return { kind: 'failed', code: 'network' }
    }
    if (result.status === 409 && result.code === 'conflict') {
      await refresh(signal)
      return { kind: 'failed', code: 'conflict', revision: result.currentRevision }
    }
    if (result.code === 'too-large' || result.code === 'bad-request' || result.code === 'unreadable-file') {
      return { kind: 'failed', code: result.code }
    }
    return { kind: 'failed', code: 'internal' }
  }

  return {
    refresh,
    save,
    remove,
    importRepos,
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
