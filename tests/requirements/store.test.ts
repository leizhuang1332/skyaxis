// @vitest-environment jsdom
/**
 * Store + controller transitions through a fake fetcher: refresh phases,
 * save/remove outcomes, banner codes, self-healing refresh on
 * conflict/not-found, and dispose freezing.
 */
import { describe, expect, it, vi } from 'vitest'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import { createRequirementsController } from '../../src/client/requirements/controller.js'
import { createRequirementsStore } from '../../src/client/requirements/store.js'
import type { RequirementsFetcher } from '../../src/client/requirements/fetcher.js'

const record = (id: string): RequirementRecord => ({
  id,
  title: `需求-${id}`,
  description: `说明 ${id}`,
  workspacePath: '',
  linkedRepos: [],
  createdAt: '2026-09-25T09:30:00.000Z',
  updatedAt: '2026-09-25T09:30:00.000Z',
})

/** rAF-flushed snapshot read (the store batches notifications per frame). */
function setup(overrides: Partial<RequirementsFetcher> = {}) {
  const store = createRequirementsStore()
  const fetcher: RequirementsFetcher = {
    list: vi.fn(async () => ({ kind: 'ok' as const, revision: 1, requirements: [record('a')] })),
    save: vi.fn(async () => ({ kind: 'network' as const })),
    remove: vi.fn(async () => ({ kind: 'network' as const })),
    ...overrides,
  } as RequirementsFetcher
  const controller = createRequirementsController(store, fetcher)
  const snap = () => store.getSnapshot()
  return { store, fetcher, controller, snap }
}

describe('requirements controller/store', () => {
  it('refresh lands ready with revision and requirements', async () => {
    const { controller, snap } = setup()
    await controller.refresh()
    expect(snap().phase).toBe('ready')
    expect(snap().revision).toBe(1)
    expect(snap().requirements).toHaveLength(1)
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
      save: vi.fn(async () => ({ kind: 'ok' as const, revision: 2, requirement: created })),
    })
    await controller.refresh()
    controller.openCreate()
    const saved = await controller.save({
      expectedRevision: 1,
      requirement: { title: '需求-b', description: '说明 b' },
    })
    expect(saved).toBe(true)
    expect(snap().requirements.map((r) => r.id)).toEqual(['a', 'b'])
    expect(snap().editing.kind).toBe('closed')
    expect(snap().revision).toBe(2)
    expect(snap().banner).toBeUndefined()
  })

  it('save-edit replaces in place and preserves order', async () => {
    const renamed = { ...record('a'), title: 'renamed' }
    const { controller, snap } = setup({
      list: vi.fn(async () => ({ kind: 'ok' as const, revision: 1, requirements: [record('a'), record('z')] })),
      save: vi.fn(async () => ({ kind: 'ok' as const, revision: 2, requirement: renamed })),
    })
    await controller.refresh()
    controller.openEdit(snap().requirements[0])
    await controller.save({ expectedRevision: 1, requirement: { id: 'a', title: 'renamed', description: snap().requirements[0].description } })
    expect(snap().requirements.map((r) => r.title)).toEqual(['renamed', '需求-z'])
  })

  it('conflict sets the banner and self-heals via refresh', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ kind: 'ok' as const, revision: 1, requirements: [record('a')] })
      .mockResolvedValueOnce({ kind: 'ok' as const, revision: 5, requirements: [record('a'), record('later')] })
    const { controller, snap } = setup({
      list,
      save: vi.fn(async () => ({ kind: 'http-error' as const, status: 409, code: 'conflict', currentRevision: 5 })),
    })
    await controller.refresh()
    const saved = await controller.save({
      expectedRevision: 1,
      requirement: { title: 'x', description: '' },
    })
    expect(saved).toBe(false)
    expect(snap().banner).toEqual({ code: 'conflict', revision: 5 })
    expect(snap().revision).toBe(5) // refreshed
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('remove 404 self-heals with a banner', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ kind: 'ok' as const, revision: 1, requirements: [record('a')] })
      .mockResolvedValueOnce({ kind: 'ok' as const, revision: 2, requirements: [] })
    const { controller, snap } = setup({
      list,
      remove: vi.fn(async () => ({ kind: 'http-error' as const, status: 404, code: 'not-found' })),
    })
    await controller.refresh()
    await controller.remove('ghost')
    expect(snap().banner?.code).toBe('not-found')
    expect(snap().requirements).toHaveLength(0)
  })

  it('drops a stale refresh response when a newer one lands first (P3 race guard)', async () => {
    let resolveStale!: (value: { kind: 'ok'; revision: number; requirements: RequirementRecord[] }) => void
    const stalePromise = new Promise<{ kind: 'ok'; revision: number; requirements: RequirementRecord[] }>((resolve) => {
      resolveStale = resolve
    })
    const list = vi.fn()
      .mockReturnValueOnce(stalePromise)
      .mockResolvedValueOnce({ kind: 'ok' as const, revision: 9, requirements: [record('fresh')] })
    const { controller, snap } = setup({ list })

    const stale = controller.refresh() // fires first…
    const fresh = controller.refresh() // …but a newer one resolves first
    await fresh
    expect(snap().revision).toBe(9)
    expect(snap().requirements.map((r) => r.id)).toEqual(['fresh'])

    resolveStale({ kind: 'ok', revision: 1, requirements: [record('stale')] })
    await stale
    expect(snap().revision).toBe(9) // the late older response did not overwrite
    expect(snap().requirements.map((r) => r.id)).toEqual(['fresh'])
  })

  it('dispose freezes the store against late results', async () => {
    const { controller, snap } = setup({
      save: vi.fn(async () => ({ kind: 'ok' as const, revision: 2, requirement: record('late') })),
    })
    controller.dispose()
    await controller.refresh()
    expect(snap().phase).toBe('loading') // untouched
  })

  it('openDetail selects the id and rides a refresh', async () => {
    const { controller, fetcher, snap } = setup()
    await controller.refresh()
    controller.openDetail('a')
    expect(snap().selectedId).toBe('a')
    expect(fetcher.list).toHaveBeenCalledTimes(2)
  })

  it('closeDetail clears the selection', async () => {
    const { controller, snap } = setup()
    await controller.refresh()
    controller.openDetail('a')
    controller.closeDetail()
    expect(snap().selectedId).toBeNull()
  })

  it('the tab is a per-requirement memory — each id keeps its own, every entry path lands on it', async () => {
    const { controller, snap } = setup()
    await controller.refresh()
    controller.openDetail('a')
    controller.selectDetailTab('workspace')
    controller.openDetail('b') // b has no memory yet — the view falls back to the first tab
    expect(snap().selectedId).toBe('b')
    expect(snap().detailTabByRequirement).toEqual({ a: 'workspace' })
    controller.selectDetailTab('overview')
    controller.openDetail('a') // switcher back to a — a's memory, not b's
    expect(snap().detailTabByRequirement).toEqual({ a: 'workspace', b: 'overview' })
    controller.closeDetail() // the list round-trip never wipes memories
    controller.openDetail('a')
    expect(snap().detailTabByRequirement).toEqual({ a: 'workspace', b: 'overview' })
  })

  it('remove retires the record\'s tab memory with it', async () => {
    const { controller, snap } = setup({ remove: vi.fn(async () => ({ kind: 'ok' as const, revision: 2 })) })
    await controller.refresh()
    controller.openDetail('a')
    controller.selectDetailTab('workspace')
    await controller.remove('a')
    expect(snap().requirements).toHaveLength(0)
    expect(snap().detailTabByRequirement).toEqual({})
  })

  it('selectDetailTab records under the live selection; setListFilter writes its field', async () => {
    const { controller, snap } = setup()
    await controller.refresh()
    controller.selectDetailTab('overview') // no selection yet — a guarded no-op
    expect(snap().detailTabByRequirement).toEqual({})
    controller.openDetail('a')
    controller.selectDetailTab('overview')
    controller.setListFilter('需求-a')
    expect(snap().detailTabByRequirement).toEqual({ a: 'overview' })
    expect(snap().listFilter).toBe('需求-a')
  })

  it('a refresh that drops the selected record keeps selectedId — the missing branch is the view\'s', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ kind: 'ok' as const, revision: 1, requirements: [record('a')] })
      .mockResolvedValueOnce({ kind: 'ok' as const, revision: 2, requirements: [record('b')] })
    const { controller, snap } = setup({ list })
    await controller.refresh() // call 1 → [a]
    controller.openDetail('a') // rides call 2 → [b], record gone
    await new Promise((resolve) => setTimeout(resolve, 0)) // let the ridden refresh land
    expect(snap().selectedId).toBe('a') // the id reference outlived the record on purpose
    expect(snap().requirements.map((r) => r.id)).toEqual(['b'])
  })
})
