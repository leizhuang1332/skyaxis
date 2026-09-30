/**
 * Waterfall waiting tracker (P2b): the Face U projection — Map keys → cached
 * Set with equality guard, honest-empty on missing service, dispose semantics.
 */
import { describe, expect, it, vi } from 'vitest'
import { createWaitingTracker } from '../../src/client/waiting-tracker.js'

interface FakeFace {
  map: Map<string, unknown>
  listeners: Set<() => void>
  publish(): void
  getSnapshot(): ReadonlyMap<string, unknown>
  subscribe(listener: () => void): () => void
}

function fakeFace(initial: Record<string, unknown> = {}): FakeFace {
  const face: FakeFace = {
    map: new Map(Object.entries(initial)),
    listeners: new Set(),
    publish(): void {
      for (const listener of [...face.listeners]) listener()
    },
    getSnapshot(): ReadonlyMap<string, unknown> {
      return face.map
    },
    subscribe(listener: () => void): () => void {
      face.listeners.add(listener)
      return () => { face.listeners.delete(listener) }
    },
  }
  return face
}

function fakeCtx(face?: FakeFace): { ctx: unknown; disposed: boolean } {
  const state = { disposed: false }
  const ctx = {
    inject(_deps: readonly string[], callback: (scope: unknown) => () => void) {
      // Real cordis semantics: fiber.dispose runs the callback's cleanup fn.
      const cleanup = callback(face === undefined ? {} : { uiSession: { pendingInteractions: face } })
      return { dispose: () => { cleanup(); state.disposed = true } }
    },
  }
  return { ctx, disposed: state.disposed }
}

describe('createWaitingTracker（Face U 投影）', () => {
  it('初始为空集；发布后含 sessionId', () => {
    const face = fakeFace()
    const tracker = createWaitingTracker(fakeCtx(face).ctx as never)
    expect(tracker.getSnapshot().size).toBe(0)
    face.map.set('session-1', { kind: 'approval' })
    face.publish()
    expect(tracker.getSnapshot().has('session-1')).toBe(true)
    tracker.dispose()
  })

  it('移除即清除；双 session 并存', () => {
    const face = fakeFace({ 's-1': {}, 's-2': {} })
    const tracker = createWaitingTracker(fakeCtx(face).ctx as never)
    expect(tracker.getSnapshot().size).toBe(2)
    face.map.delete('s-1')
    face.publish()
    expect(tracker.getSnapshot().has('s-1')).toBe(false)
    expect(tracker.getSnapshot().has('s-2')).toBe(true)
    tracker.dispose()
  })

  it('等值重发布不 notify（重放风暴不抖动）', () => {
    const face = fakeFace({ 's-1': {} })
    const tracker = createWaitingTracker(fakeCtx(face).ctx as never)
    const listener = vi.fn()
    tracker.subscribe(listener)
    face.publish() // same keys — guard must hold
    expect(listener).not.toHaveBeenCalled()
    face.map.set('s-2', {})
    face.publish()
    expect(listener).toHaveBeenCalledTimes(1)
    tracker.dispose()
  })

  it('dispose 退订（后续发布不可见）并清空', () => {
    const face = fakeFace({ 's-1': {} })
    const tracker = createWaitingTracker(fakeCtx(face).ctx as never)
    tracker.dispose()
    face.map.set('s-2', {})
    face.publish()
    expect(tracker.getSnapshot().size).toBe(0)
  })

  it('服务缺席（无 uiSession）⇒ 恒空集', () => {
    const tracker = createWaitingTracker(fakeCtx(undefined).ctx as never)
    expect(tracker.getSnapshot().size).toBe(0)
    tracker.dispose()
  })

  it('快照引用稳定：等值重投影返回同一 Set', () => {
    const face = fakeFace({ 's-1': {} })
    const tracker = createWaitingTracker(fakeCtx(face).ctx as never)
    const a = tracker.getSnapshot()
    face.publish()
    expect(tracker.getSnapshot()).toBe(a)
    tracker.dispose()
  })

  it('subscribe 返回退订函数', () => {
    const face = fakeFace()
    const tracker = createWaitingTracker(fakeCtx(face).ctx as never)
    const listener = vi.fn()
    const unsub = tracker.subscribe(listener)
    unsub()
    face.map.set('s-9', {})
    face.publish()
    expect(listener).not.toHaveBeenCalled()
    tracker.dispose()
  })
})
