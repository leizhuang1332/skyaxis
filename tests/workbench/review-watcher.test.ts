/**
 * Register-level review-report watcher matrix (0024 D2-A): edge detection,
 * attempted-once + precise re-arm, the running gate, revision threading,
 * the degraded-list skip — dev-watcher.test's harness shape. Plus the
 * controller autoImportReview contract (quiet face, miss passthrough,
 * echo-only-when-open / never-fabricate-slots) against a real store.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReviewWatcher } from '../../src/client/workbench/review-watcher.js'
import { createWorkbenchController, type ReviewAutoImportOutcome, type WorkbenchController } from '../../src/client/workbench/controller.js'
import { createWorkbenchStore } from '../../src/client/workbench/store.js'
import type { WorkbenchFetcher } from '../../src/client/workbench/fetcher.js'
import type { WorkbenchSessionsFace } from '../../src/client/workbench/view.js'
import type { WorkbenchRecord } from '../../src/workbench-shared/protocol.js'

const RID = '11111111-1111-4111-8111-111111111111'
const RID2 = '22222222-2222-4222-8222-222222222222'
const NOW_ISO = '2026-10-22T09:00:00.000Z'

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

function reviewRecord(requirementId: string, sessionId?: string): WorkbenchRecord {
  return {
    requirementId,
    stage: 'review',
    stageHistory: [{ stage: 'review', at: NOW_ISO }],
    criteria: [],
    findings: [],
    workPackages: [],
    releaseItems: [],
    reviewReports: [],
    knowledgeCandidates: [],
    ...(sessionId !== undefined ? { reviewSession: { sessionId, boundAt: NOW_ISO, anchor: '# 评审任务书 · R' } } : {}),
  } as WorkbenchRecord
}

function fakeController(
  imports: Array<{ requirementId: string; sessionId: string; revision: number }>,
  outcomeFor?: (requirementId: string) => ReviewAutoImportOutcome | undefined,
): WorkbenchController {
  let revision = 5
  return {
    autoImportReview: async (requirementId: string, sessionId: string, expectedRevision: number): Promise<ReviewAutoImportOutcome | undefined> => {
      imports.push({ requirementId, sessionId, revision: expectedRevision })
      if (outcomeFor !== undefined) return outcomeFor(requirementId)
      const outcome = { landed: true as const, revision: revision + 1 }
      revision += 1
      return outcome
    },
  } as Pick<WorkbenchController, 'autoImportReview'> as WorkbenchController
}

const flush = async (ticks = 5): Promise<void> => {
  for (let i = 0; i < ticks; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => { vi.useRealTimers() })

describe('0024 D2-A: register-level review-report watcher', () => {
  it('idle edge → 单次 sweep：有 reviewSession 绑定的记录逐个自动收取；revision 随落盘穿线', async () => {
    const { face, flip } = fakeFace([{ id: 'sess-review', running: true }])
    const records = [reviewRecord(RID, 'sess-review'), reviewRecord(RID2, 'sess-review-2')]
    const imports: Array<{ requirementId: string; sessionId: string; revision: number }> = []
    const watcher = createReviewWatcher({
      fetcher: { list: async () => ({ kind: 'ok' as const, revision: 5, records }) } as unknown as WorkbenchFetcher,
      controller: fakeController(imports),
      sessions: face,
      throttleMs: 0,
    })
    flip([{ id: 'sess-review', running: false }])
    await flush()
    expect(imports).toEqual([
      { requirementId: RID, sessionId: 'sess-review', revision: 5 },
      // RID 的落盘把 revision 顶到 6，穿线给下一条
      { requirementId: RID2, sessionId: 'sess-review-2', revision: 6 },
    ])
    watcher.dispose()
  })

  it('attempted 一次性：同绑定的后续 idle 翻转不重试；running 边沿精确重臂（同会话续话轮）', async () => {
    const { face, flip } = fakeFace([{ id: 'sess-review', running: true }])
    const imports: Array<{ requirementId: string; sessionId: string; revision: number }> = []
    const watcher = createReviewWatcher({
      fetcher: { list: async () => ({ kind: 'ok' as const, revision: 5, records: [reviewRecord(RID, 'sess-review')] }) } as unknown as WorkbenchFetcher,
      controller: fakeController(imports),
      sessions: face,
      throttleMs: 0,
    })
    flip([{ id: 'sess-review', running: false }])
    await flush()
    expect(imports).toHaveLength(1)
    // 无 running 边沿的再翻转（别的会话活动）不重试
    flip([{ id: 'sess-other', running: false }])
    await flush()
    expect(imports).toHaveLength(1)
    // 绑定会话再次 running（续话/重评轮）→ 精确重臂；跑完再收
    flip([{ id: 'sess-review', running: true }])
    await flush()
    flip([{ id: 'sess-review', running: false }])
    await flush()
    expect(imports).toHaveLength(2)
    watcher.dispose()
  })

  it('RUNNING 关闸：绑定会话仍在跑的记录跳过本次 sweep（不占 attempted 名额，idle 后补收）', async () => {
    const { face, flip } = fakeFace([{ id: 'sess-a', running: true }])
    const imports: Array<{ requirementId: string; sessionId: string; revision: number }> = []
    const watcher = createReviewWatcher({
      fetcher: { list: async () => ({ kind: 'ok' as const, revision: 5, records: [reviewRecord(RID, 'sess-review')] }) } as unknown as WorkbenchFetcher,
      controller: fakeController(imports),
      sessions: face,
      throttleMs: 0,
    })
    // 别的会话 idle 触发 sweep，但绑定会话仍在跑（在场且 running）→ 零收取
    flip([{ id: 'sess-a', running: false }, { id: 'sess-review', running: true }])
    await flush()
    expect(imports).toHaveLength(0)
    // 绑定会话跑完 → 补收（证明 running 态没占 attempted 名额）
    flip([{ id: 'sess-a', running: false }, { id: 'sess-review', running: false }])
    await flush()
    expect(imports).toEqual([{ requirementId: RID, sessionId: 'sess-review', revision: 5 }])
    watcher.dispose()
  })

  it('list 降级跳过整个 sweep（下次翻转重试）；miss（无块）占 attempted 等重臂——running 边沿精确重开后补收', async () => {
    const { face, flip } = fakeFace([{ id: 'sess-review', running: true }])
    const imports: Array<{ requirementId: string; sessionId: string; revision: number }> = []
    let degraded = true
    const watcher = createReviewWatcher({
      fetcher: { list: async () => degraded
        ? { kind: 'degraded' as const, reason: 'io' as const, hasBackup: false }
        : { kind: 'ok' as const, revision: 5, records: [reviewRecord(RID, 'sess-review')] } } as unknown as WorkbenchFetcher,
      controller: fakeController(imports, () => ({ landed: false, miss: 'no-review-block' })),
      sessions: face,
      throttleMs: 0,
    })
    flip([{ id: 'sess-review', running: false }])
    await flush()
    expect(imports).toHaveLength(0) // 降级 → 整个 sweep 跳过
    // 恢复后：一次无关会话的 running→idle 周期触发补收（miss 占 attempted）
    degraded = false
    flip([{ id: 'sess-other', running: true }])
    flip([{ id: 'sess-other', running: false }])
    await flush()
    expect(imports).toHaveLength(1)
    // 再来一次无关 idle 周期 → attempted 已占，不重试
    flip([{ id: 'sess-other', running: true }])
    flip([{ id: 'sess-other', running: false }])
    await flush()
    expect(imports).toHaveLength(1)
    // 绑定会话再次 running（续话轮写完报告）→ 重臂 → idle 边沿补收
    flip([{ id: 'sess-review', running: true }, { id: 'sess-other', running: false }])
    flip([{ id: 'sess-review', running: false }, { id: 'sess-other', running: false }])
    await flush()
    expect(imports).toHaveLength(2)
    watcher.dispose()
  })

  it('无 reviewSession 绑定的记录零触碰；autoImportReview 返回 undefined（409/网络）不穿线', async () => {
    const { face, flip } = fakeFace([{ id: 'sess-a', running: true }])
    const imports: Array<{ requirementId: string; sessionId: string; revision: number }> = []
    const watcher = createReviewWatcher({
      fetcher: { list: async () => ({ kind: 'ok' as const, revision: 5, records: [reviewRecord(RID2), reviewRecord(RID, 'sess-review')] }) } as unknown as WorkbenchFetcher,
      controller: fakeController(imports, (requirementId) => requirementId === RID ? undefined : { landed: true, revision: 6 }),
      sessions: face,
      throttleMs: 0,
    })
    flip([{ id: 'sess-a', running: false }])
    await flush()
    // RID2 无绑定零触碰；RID 尝试过一次（undefined 结果也记 attempted）
    expect(imports).toEqual([{ requirementId: RID, sessionId: 'sess-review', revision: 5 }])
    flip([{ id: 'sess-other', running: false }])
    await flush()
    expect(imports).toHaveLength(1)
    watcher.dispose()
  })
})

describe('0024 D2-A: controller autoImportReview 契约（安静面）', () => {
  const DETAIL_OK = (record: WorkbenchRecord, revision: number) => ({
    kind: 'ok' as const,
    revision,
    record,
    planFileExists: [],
    reviewFileExists: [],
    releaseDrifted: [],
  })

  it('miss（无块）原样透传、零写入、零 slot 伪造', async () => {
    const store = createWorkbenchStore()
    const writes: unknown[] = []
    const fetcher = {
      reviewFetch: async () => ({ kind: 'ok' as const, response: { ok: true as const, missing: 'no-review-block' as const } }),
      writeReview: async (...args: unknown[]) => { writes.push(args); return { kind: 'http-error' as const, status: 500 } },
      detail: async () => DETAIL_OK(reviewRecord(RID), 3),
    } as unknown as WorkbenchFetcher
    const controller = createWorkbenchController(store, fetcher)
    const outcome = await controller.autoImportReview(RID, 'sess-review', 3)
    expect(outcome).toEqual({ landed: false, miss: 'no-review-block' })
    expect(writes).toHaveLength(0)
    expect(store.getSnapshot().byRequirement[RID]).toBeUndefined() // 未打开的需求绝不伪造 slot
  })

  it('落盘成功：未打开的需求 detached 直写（零 slot 伪造）；打开中的需求 open() 重拉回显', async () => {
    const after = reviewRecord(RID, 'sess-review')
    // 两个用例共用一个 fake：抓取回报告全文，写入 ok，detail 回「收取后」的台账
    const store = createWorkbenchStore()
    const writes: Array<{ requirementId: string; revision: number; title?: string }> = []
    const fetcher = {
      reviewFetch: async () => ({ kind: 'ok' as const, response: { ok: true as const, text: '# 评审报告\n\n```yaml\n# skyaxis-review\nfindings: []\n```' } }),
      writeReview: async (requirementId: string, _text: string, expectedRevision: number, title?: string) => {
        writes.push({ requirementId, revision: expectedRevision, title })
        return { kind: 'ok' as const, revision: expectedRevision + 1, anchor: { reviewId: 'rev-1', seeded: 0 } }
      },
      detail: async () => DETAIL_OK(after, 4),
    } as unknown as WorkbenchFetcher
    const controller = createWorkbenchController(store, fetcher)

    // ① 未打开：写入落盘，slot 不被伪造
    const detached = await controller.autoImportReview(RID, 'sess-review', 3)
    expect(detached).toEqual({ landed: true, revision: 4 })
    expect(writes).toEqual([{ requirementId: RID, revision: 3, title: undefined }])
    expect(store.getSnapshot().byRequirement[RID]).toBeUndefined()

    // ② 打开中（先 open 预热 slot）：写入后 open() 重拉，record 换成「收取后」台账
    await controller.open(RID)
    expect(store.getSnapshot().byRequirement[RID]?.phase).toBe('ready')
    const echoed = await controller.autoImportReview(RID, 'sess-review', 4)
    expect(echoed).toEqual({ landed: true, revision: 5 }) // fake write bumps expectedRevision+1
    expect(writes).toEqual([
      { requirementId: RID, revision: 3, title: undefined },
      { requirementId: RID, revision: 4, title: undefined },
    ])
    expect(store.getSnapshot().byRequirement[RID]?.record).toBe(after)
  })
})
