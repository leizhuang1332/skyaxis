// @vitest-environment jsdom
/**
 * Store + controller transitions through a fake fetcher: refresh phases,
 * save/remove outcomes, banner codes, self-healing refresh on
 * conflict/not-found, and dispose freezing.
 */
import { describe, expect, it, vi } from 'vitest'
import type { RepoRecord } from '../../src/repos-pool-shared/protocol.js'
import { createReposPoolController } from '../../src/client/repos-pool/controller.js'
import { createReposPoolStore } from '../../src/client/repos-pool/store.js'
import type { ReposFetcher } from '../../src/client/repos-pool/fetcher.js'

const record = (id: string): RepoRecord => ({
  id,
  name: `repo-${id}`,
  url: `https://example.com/${id}.git`,
  description: '',
  status: 'verified',
  validatedAt: null,
  lastError: null,
})

/** rAF-flushed snapshot read (the store batches notifications per frame). */
function setup(overrides: Partial<ReposFetcher> = {}) {
  const store = createReposPoolStore()
  const fetcher: ReposFetcher = {
    list: vi.fn(async () => ({ kind: 'ok' as const, revision: 1, repos: [record('a')] })),
    save: vi.fn(async () => ({ kind: 'network' as const })),
    remove: vi.fn(async () => ({ kind: 'network' as const })),
    validate: vi.fn(async () => ({ kind: 'network' as const })),
    ...overrides,
  } as ReposFetcher
  const controller = createReposPoolController(store, fetcher)
  const snap = () => store.getSnapshot()
  return { store, fetcher, controller, snap }
}

describe('repos-pool controller/store', () => {
  it('refresh lands ready with revision and repos', async () => {
    const { controller, snap } = setup()
    await controller.refresh()
    expect(snap().phase).toBe('ready')
    expect(snap().revision).toBe(1)
    expect(snap().repos).toHaveLength(1)
  })

  it('refresh lands degraded with the banner material', async () => {
    const { controller, snap } = setup({ list: vi.fn(async () => ({ kind: 'degraded' as const, reason: 'parse' as const, hasBackup: true })) })
    await controller.refresh()
    expect(snap().phase).toBe('degraded')
    expect(snap().degraded).toEqual({ reason: 'parse', hasBackup: true })
  })

  it('save-create appends the record, closes the form, clears the banner', async () => {
    const created = record('b')
    const { controller, snap } = setup({
      save: vi.fn(async () => ({ kind: 'ok' as const, revision: 2, repo: created })),
    })
    await controller.refresh()
    controller.openCreate()
    const saved = await controller.save({
      expectedRevision: 1,
      repo: { name: 'repo-b', url: 'https://example.com/b.git', description: '' },
      validation: { kind: 'verified' },
    })
    expect(saved).toEqual({ kind: 'ok' })
    expect(snap().repos.map((r) => r.id)).toEqual(['a', 'b'])
    expect(snap().editing.kind).toBe('closed')
    expect(snap().revision).toBe(2)
    expect(snap().banner).toBeUndefined()
  })

  it('save-edit replaces in place and preserves order', async () => {
    const renamed = { ...record('a'), name: 'renamed' }
    const { controller, snap } = setup({
      list: vi.fn(async () => ({ kind: 'ok' as const, revision: 1, repos: [record('a'), record('z')] })),
      save: vi.fn(async () => ({ kind: 'ok' as const, revision: 2, repo: renamed })),
    })
    await controller.refresh()
    controller.openEdit(snap().repos[0])
    await controller.save({ expectedRevision: 1, repo: { id: 'a', name: 'renamed', url: snap().repos[0].url, description: '' }, validation: { kind: 'unchanged' } })
    expect(snap().repos.map((r) => r.name)).toEqual(['renamed', 'repo-z'])
  })

  it('save conflict returns failed (no banner) and self-heals via refresh', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ kind: 'ok' as const, revision: 1, repos: [record('a')] })
      .mockResolvedValueOnce({ kind: 'ok' as const, revision: 5, repos: [record('a'), record('later')] })
    const { controller, snap } = setup({
      list,
      save: vi.fn(async () => ({ kind: 'http-error' as const, status: 409, code: 'conflict', currentRevision: 5 })),
    })
    await controller.refresh()
    const saved = await controller.save({
      expectedRevision: 1,
      repo: { name: 'x', url: 'https://example.com/x.git', description: '' },
      validation: { kind: 'verified' },
    })
    expect(saved).toEqual({ kind: 'failed', code: 'conflict', revision: 5 })
    expect(snap().banner).toBeUndefined() // the form owns save-failure presentation
    expect(snap().revision).toBe(5) // refreshed — retry will carry the fresh revision
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('remove 404 self-heals with a banner', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ kind: 'ok' as const, revision: 1, repos: [record('a')] })
      .mockResolvedValueOnce({ kind: 'ok' as const, revision: 2, repos: [] })
    const { controller, snap } = setup({
      list,
      remove: vi.fn(async () => ({ kind: 'http-error' as const, status: 404, code: 'not-found' })),
    })
    await controller.refresh()
    await controller.remove('ghost')
    expect(snap().banner?.code).toBe('not-found')
    expect(snap().repos).toHaveLength(0)
  })

  it('drops a stale refresh response when a newer one lands first (P3 race guard)', async () => {
    let resolveStale!: (value: { kind: 'ok'; revision: number; repos: RepoRecord[] }) => void
    const stalePromise = new Promise<{ kind: 'ok'; revision: number; repos: RepoRecord[] }>((resolve) => {
      resolveStale = resolve
    })
    const list = vi.fn()
      .mockReturnValueOnce(stalePromise)
      .mockResolvedValueOnce({ kind: 'ok' as const, revision: 9, repos: [record('fresh')] })
    const { controller, snap } = setup({ list })

    const stale = controller.refresh() // fires first…
    const fresh = controller.refresh() // …but a newer one resolves first
    await fresh
    expect(snap().revision).toBe(9)
    expect(snap().repos.map((r) => r.id)).toEqual(['fresh'])

    resolveStale({ kind: 'ok', revision: 1, repos: [record('stale')] })
    await stale
    expect(snap().revision).toBe(9) // the late older response did not overwrite
    expect(snap().repos.map((r) => r.id)).toEqual(['fresh'])
  })

  it('dispose freezes the store against late results', async () => {
    const { controller, snap } = setup({
      save: vi.fn(async () => ({ kind: 'ok' as const, revision: 2, repo: record('late') })),
    })
    controller.dispose()
    await controller.refresh()
    expect(snap().phase).toBe('loading') // untouched
  })
})
