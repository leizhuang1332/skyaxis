/**
 * Waiting tracker against the REAL cordis Context (P2b acceptance failure
 * diagnostic): the unit tests used a hand-written fake ctx, which cannot
 * expose a real inject-semantics mismatch. This verifies the tracker picks
 * up a `uiSession.pendingInteractions` service that another plugin provides —
 * including the late-arrival case (provided AFTER the tracker subscribes),
 * which is exactly the composition ordering skyaxis cannot control.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createWaitingTracker } from '../../src/client/waiting-tracker.js'

interface FakeFace {
  map: Map<string, unknown>
  listeners: Set<() => void>
  publish(): void
  getSnapshot(): ReadonlyMap<string, unknown>
  subscribe(listener: () => void): () => void
}

function fakeFace(): FakeFace {
  const face: FakeFace = {
    map: new Map(),
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

/** cordis inject callbacks land asynchronously — the production path is identical. */
const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 30) })

/** A plugin that provides `uiSession` — mirrors dsh-client-ui-session's shape. */
function uiSessionPlugin(face: FakeFace) {
  return (ctx: Context): void => {
    ctx.provide('uiSession', { pendingInteractions: face } as never)
  }
}

describe('createWaitingTracker × real cordis Context', () => {
  it('picks up a pendingInteractions face provided by another plugin (provider first)', async () => {
    const face = fakeFace()
    const ctx = new Context()
    const provider = ctx.plugin(uiSessionPlugin(face))
    await provider.await()

    const tracker = createWaitingTracker(ctx)
    await tick()
    face.map.set('session-1', { kind: 'question' })
    face.publish()

    expect(tracker.getSnapshot().has('session-1')).toBe(true)
    tracker.dispose()
  })

  it('picks up the face when the provider activates AFTER the tracker (late arrival)', async () => {
    const face = fakeFace()
    const ctx = new Context()
    // Tracker subscribes first — the inject callback must fire on later provide.
    const tracker = createWaitingTracker(ctx)
    expect(tracker.getSnapshot().size).toBe(0)

    const provider = ctx.plugin(uiSessionPlugin(face))
    await provider.await()
    await tick()

    face.map.set('session-late', { kind: 'approval' })
    face.publish()
    expect(tracker.getSnapshot().has('session-late')).toBe(true)
    tracker.dispose()
  })

  it('degrades to an empty set when no provider exists (silent, no throw)', async () => {
    const ctx = new Context()
    const tracker = createWaitingTracker(ctx)
    expect(tracker.getSnapshot().size).toBe(0)
    tracker.dispose()
  })
})
