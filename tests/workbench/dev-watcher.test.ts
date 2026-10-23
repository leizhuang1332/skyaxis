/**
 * Register-level dev-declare watcher matrix (0016 P1a): edge detection,
 * throttling, re-arm, due judgment, and the detached-seed contract — fakes
 * for the sessions face / fetcher.list / controller detached face, fake
 * clock for the throttle window. The watcher is the GLOBAL completion
 * signal (decisions/0016 修订 #2): pins the cross-requirement sweep that
 * fires while nobody watches the tab.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDevDeclareWatcher } from '../../src/client/workbench/dev-watcher.js'
import type { DevSeedOutcome, WorkbenchController } from '../../src/client/workbench/controller.js'
import type { WorkbenchFetcher } from '../../src/client/workbench/fetcher.js'
import type { WorkbenchSessionsFace } from '../../src/client/workbench/view.js'
import type { WorkbenchRecord } from '../../src/workbench-shared/protocol.js'

const RID = '11111111-1111-4111-8111-111111111111'
const RID2 = '22222222-2222-4222-8222-222222222222'
const NOW_ISO = '2026-10-17T09:00:00.000Z'

function fakeFace(ids: readonly { id: string; running: boolean; displayTitle?: string }[]): { face: WorkbenchSessionsFace; flip(next: readonly { id: string; running: boolean; displayTitle?: string }[]): void } {
  let listeners: Array<() => void> = []
  let current = ids
  return {
    face: {
      get ids() { return current.map((row) => row.id) },
      get summariesById() {
        const byId: Record<string, { id: string; displayTitle: string; running: boolean; blank: boolean }> = {}
        for (const row of current) byId[row.id] = { id: row.id, displayTitle: row.displayTitle ?? row.id, running: row.running, blank: row.displayTitle === undefined }
        return byId
      },
      subscribe: (listener) => {
        listeners.push(listener)
        return () => { listeners = listeners.filter((candidate) => candidate !== listener) }
      },
      navigate: () => {},
    },
    flip(next) {
      current = next
      for (const listener of [...listeners]) listener()
    },
  }
}

function record(requirementId: string, workPackageId: string, sessionId: string, slot?: { sessionId: string; adjudication: 'pending' | 'imported' | 'dismissed' }): WorkbenchRecord {
  return {
    requirementId,
    stage: 'implement',
    stageHistory: [{ stage: 'understand', at: NOW_ISO }],
    splitApprovedAt: NOW_ISO,
    criteria: [],
    findings: [],
    workPackages: [{
      id: workPackageId,
      title: 'WP',
      boundary: '',
      order: 1,
      dependsOn: [],
      covers: [],
      status: 'in-dev',
      plans: [],
      sessions: [{ sessionId, purpose: 'dev', boundAt: NOW_ISO }],
      commits: [],
      acceptances: [],
    }],
    releaseItems: [],
    reviewReports: [],
    knowledgeCandidates: [],
    ...(slot !== undefined
      ? { devDeclares: { [workPackageId]: { seed: { sessionId: slot.sessionId, contentHash: 'a'.repeat(64), seededAt: NOW_ISO }, adjudication: slot.adjudication } } }
      : {}),
  } as WorkbenchRecord
}

function harness(options: {
  records?: readonly WorkbenchRecord[]
  now?: () => number
  throttleMs?: number
  seedResult?: (requirementId: string, workPackageId: string, revision: number) => DevSeedOutcome | undefined
}) {
  const seeds: Array<{ requirementId: string; workPackageId: string; revision: number }> = []
  const fetcher = {
    list: async () => options.records !== undefined
      ? { kind: 'ok' as const, rows: options.records.map((record) => ({ requirementId: record.requirementId, revision: 5, record })) }
      : { kind: 'degraded' as const, reason: 'io' as const, hasBackup: false },
  } as Pick<WorkbenchFetcher, 'list'> as WorkbenchFetcher
  const controller = {
    seedDevDeclareDetached: async (requirementId: string, revision: number, workPackageId: string): Promise<DevSeedOutcome | undefined> => {
      seeds.push({ requirementId, workPackageId, revision })
      return options.seedResult !== undefined ? options.seedResult(requirementId, workPackageId, revision) : { landed: true, revision }
    },
  } as Pick<WorkbenchController, 'seedDevDeclareDetached'> as WorkbenchController
  let clock = 1_000
  const watcher = createDevDeclareWatcher({
    fetcher,
    controller,
    sessions: undefined,
    throttleMs: options.throttleMs ?? 0,
    now: options.now ?? ((): number => clock),
  })
  return {
    seeds,
    watcher,
    setClock(next: number): void { clock = next },
  }
}

afterEach(() => { vi.useRealTimers() })

describe('0016 P1a: register-level dev-declare watcher', () => {
  it('0016 刀一验收修正: sweep 先跑标题寻址绑定（真实会话→WP），再逐 WP 收取', async () => {
    const TITLE = '# skyaxis 工作包任务书 WP1 · 修图APP'
    const { face, flip } = fakeFace([
      { id: 'sess-shell', running: false },
      { id: 'sess-real', running: true, displayTitle: TITLE },
    ])
    const due = record(RID, 'WP1', 'sess-shell') // shell 绑定在场（blank 面下允许追加真实行）
    const seeds: Array<{ requirementId: string; workPackageId: string; revision: number }> = []
    const binds: Array<{ requirementId: string; workPackageId: string; sessionId: string; revision: number }> = []
    let revision = 5
    const watcher = createDevDeclareWatcher({
      fetcher: {
        list: async () => ({ kind: 'ok' as const, rows: [{ requirementId: RID, revision, record: due }] }),
        bindSession: async (requirementId: string, expectedRevision: number, workPackageId: string, sessionId: string) => {
          binds.push({ requirementId, workPackageId, sessionId, revision: expectedRevision })
          revision += 1
          return { kind: 'ok' as const, revision, record: due }
        },
      } as unknown as WorkbenchFetcher,
      controller: fakeController(seeds),
      sessions: face,
      throttleMs: 0,
    })
    // 真实会话跑完（idle 翻转沿）→ 单次 sweep：先绑定真实行、再按新 revision 收取
    flip([
      { id: 'sess-shell', running: false },
      { id: 'sess-real', running: false, displayTitle: TITLE },
    ])
    await flush()
    expect(binds).toEqual([{ requirementId: RID, workPackageId: 'WP1', sessionId: 'sess-real', revision: 5 }])
    // 绑定落账后 revision 穿线到收取（6）——同一需求的分片内穿线
    expect(seeds).toEqual([{ requirementId: RID, workPackageId: 'WP1', revision: 6 }])
    watcher.dispose()
  })

  it('0021 渲染轮: 标题去品牌——新形头行同样寻址绑定（matcher 双臂；上例钉 legacy 形）', async () => {
    const TITLE = '# 工作包任务书 WP1 · 修图APP'
    const { face, flip } = fakeFace([
      { id: 'sess-shell', running: false },
      { id: 'sess-real', running: true, displayTitle: TITLE },
    ])
    const due = record(RID, 'WP1', 'sess-shell')
    const binds: Array<{ requirementId: string; workPackageId: string; sessionId: string; revision: number }> = []
    let revision = 5
    const watcher = createDevDeclareWatcher({
      fetcher: {
        list: async () => ({ kind: 'ok' as const, rows: [{ requirementId: RID, revision, record: due }] }),
        bindSession: async (requirementId: string, expectedRevision: number, workPackageId: string, sessionId: string) => {
          binds.push({ requirementId, workPackageId, sessionId, revision: expectedRevision })
          revision += 1
          return { kind: 'ok' as const, revision, record: due }
        },
      } as unknown as WorkbenchFetcher,
      controller: fakeController([]),
      sessions: face,
      throttleMs: 0,
    })
    flip([
      { id: 'sess-shell', running: false },
      { id: 'sess-real', running: false, displayTitle: TITLE },
    ])
    await flush()
    expect(binds).toEqual([{ requirementId: RID, workPackageId: 'WP1', sessionId: 'sess-real', revision: 5 }])
    watcher.dispose()
  })


  it('idle edge → one sweep seeds every due in-dev WP (cross-requirement); a pending slot on the CURRENT binding is skipped client-side', async () => {
    const { face, flip } = fakeFace([{ id: 'sess-a', running: true }])
    const due = record(RID, 'WP1', 'sess-a')
    const settled = record(RID2, 'WP2', 'sess-b', { sessionId: 'sess-b', adjudication: 'pending' })
    const h = harness({ records: [due, settled] })
    const wired = createDevDeclareWatcher({ fetcher: fakeFetcher([due, settled]), controller: fakeController(h.seeds), sessions: face, throttleMs: 0 })
    void wired
    flip([{ id: 'sess-a', running: false }])
    await flush()
    expect(h.seeds).toEqual([{ requirementId: RID, workPackageId: 'WP1', revision: 5 }])
  })

  it('throttle: the FIRST sweep bypasses the window; a flip inside it coalesces into ONE trailing sweep', async () => {
    vi.useFakeTimers()
    const { face, flip } = fakeFace([{ id: 'sess-a', running: true }])
    const due = record(RID, 'WP1', 'sess-a')
    let clock = 1_000
    const seeds: Array<{ requirementId: string; workPackageId: string; revision: number }> = []
    const watcher = createDevDeclareWatcher({
      fetcher: fakeFetcher([due]),
      controller: fakeController(seeds, () => { clock += 10_000 }),
      sessions: face,
      throttleMs: 30_000,
      now: () => clock,
    })
    flip([{ id: 'sess-a', running: false }]) // leading sweep — never-swept bypasses the window
    await vi.advanceTimersByTimeAsync(0)
    expect(seeds.length).toBe(1)
    flip([{ id: 'sess-a', running: true }]) // re-arm + running edge
    await vi.advanceTimersByTimeAsync(0)
    flip([{ id: 'sess-a', running: false }]) // t=11000 — inside the window → trailing timer only
    await vi.advanceTimersByTimeAsync(0)
    expect(seeds.length).toBe(1)
    await vi.advanceTimersByTimeAsync(30_000) // the trailing sweep fires
    expect(seeds.length).toBe(2)
    watcher.dispose()
  })

  it('running edge re-arms the one-shot: a second round gets a fresh attempt', async () => {
    const { face, flip } = fakeFace([{ id: 'sess-a', running: true }])
    const due = record(RID, 'WP1', 'sess-a')
    const seeds: Array<{ requirementId: string; workPackageId: string; revision: number }> = []
    const watcher = createDevDeclareWatcher({ fetcher: fakeFetcher([due]), controller: fakeController(seeds), sessions: face, throttleMs: 0 })
    flip([{ id: 'sess-a', running: false }])
    await flush()
    expect(seeds.length).toBe(1)
    // one-shot: an armed sweep again (e.g. another session's flip) does NOT re-attempt
    flip([{ id: 'sess-a', running: true }, { id: 'sess-b', running: true }])
    await flush()
    flip([{ id: 'sess-a', running: true }, { id: 'sess-b', running: false }])
    await flush()
    expect(seeds.length).toBe(1)
    // a RUNNING edge of the watched session re-arms; its idle flip attempts again
    flip([{ id: 'sess-a', running: true }])
    await flush()
    flip([{ id: 'sess-a', running: false }])
    await flush()
    expect(seeds.length).toBe(2)
    watcher.dispose()
  })

  it('list failure skips the sweep entirely (catch-up next flip); detached revision threads a landed write', async () => {
    const { face, flip } = fakeFace([{ id: 'sess-a', running: true }, { id: 'sess-b', running: true }])
    let listCalls = 0
    const dueA = record(RID, 'WP1', 'sess-a')
    const dueB = record(RID2, 'WP2', 'sess-b')
    const seeds: Array<{ requirementId: string; workPackageId: string; revision: number }> = []
    const watcher = createDevDeclareWatcher({
      fetcher: {
        list: async () => {
          listCalls += 1
          return listCalls <= 1
            ? { kind: 'network' as const }
            : { kind: 'ok' as const, rows: [dueA, dueB].map((record) => ({ requirementId: record.requirementId, revision: 5, record })) }
        },
      } as unknown as WorkbenchFetcher,
      controller: fakeController(seeds),
      sessions: face,
      throttleMs: 0,
    })
    flip([{ id: 'sess-a', running: false }, { id: 'sess-b', running: false }])
    await flush()
    expect(seeds).toEqual([]) // failed list → skip, no crash
    flip([{ id: 'sess-a', running: true }, { id: 'sess-b', running: true }])
    await flush()
    flip([{ id: 'sess-a', running: false }, { id: 'sess-b', running: false }])
    await flush()
    // 0032: revisions are PER-RECORD — RID's landed write bumps only RID's
    // map entry; RID2 seeds under ITS OWN revision (5), never RID's 6 (the
    // single-file shared-counter threading is gone).
    expect(seeds).toEqual([
      { requirementId: RID, workPackageId: 'WP1', revision: 5 },
      { requirementId: RID2, workPackageId: 'WP2', revision: 5 },
    ])
    watcher.dispose()
  })
})

/** Fake fetcher over a fixed record list. */
function fakeFetcher(records: readonly WorkbenchRecord[]): WorkbenchFetcher {
  return { list: async () => ({ kind: 'ok' as const, rows: records.map((record) => ({ requirementId: record.requirementId, revision: 5, record })) }) } as unknown as WorkbenchFetcher
}

/** Fake detached controller face; onSeed runs after each recorded attempt (side effects for the next call). */
function fakeController(seeds: Array<{ requirementId: string; workPackageId: string; revision: number }>, onSeed?: () => void): WorkbenchController {
  let revision = 5
  return {
    seedDevDeclareDetached: async (requirementId: string, expectedRevision: number, workPackageId: string): Promise<DevSeedOutcome | undefined> => {
      seeds.push({ requirementId, workPackageId, revision: expectedRevision })
      const outcome = { landed: true, revision: revision + 1 }
      revision += 1
      onSeed?.()
      return outcome
    },
  } as unknown as WorkbenchController
}

const flush = async (ticks = 5): Promise<void> => {
  for (let i = 0; i < ticks; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}
