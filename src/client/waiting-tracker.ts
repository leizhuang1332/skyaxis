/**
 * Waterfall waiting-input tracker (P2b, research 0007 §1.2 as amended): the
 * fourth card state — "this session is waiting for the user to answer an
 * approval / question" — sourced from `ctx.uiSession.pendingInteractions`.
 *
 * Why that face and NOT `ctx.remote.$on` (the hook-order blind spot, verified
 * first-hand): cordis waterfall listeners chain in REGISTRATION order, and
 * the shipped GUI answerers (dsh-client-ui-approval / ui-user-questions)
 * return a RESULT without calling next() when the user answers — a passive
 * third-party $on listener registered after them never fires for answered
 * requests. $on has no prepend and plugin apply order is uncontrollable, so
 * the blind spot is unfixable from a plugin. The GUI consumers publish EVERY
 * delivered waterfall request into pendingInteractions (keyed by sessionId,
 * root-scoped so subagents included, republished after replay so it survives
 * page refresh) — order-immune, read-only, and fed exactly when the shipped
 * approval/question panels are fed. If those GUI plugins are disabled the
 * face runs dry and the fourth state degrades honestly back to three.
 *
 * Composition note: dsh-client-ui-session is NOT in this repo's dependency
 * store — the minimal local shape below (the CatalogLike precedent in
 * task-graph/subagents.ts) keeps the subscription structural. The service is
 * injected in a sub-scope (the requirements register precedent): a missing
 * 'uiSession' degrades only this tracker, never the plugin load. The store
 * lives OUTSIDE the inject fiber so the face identity survives service
 * restarts; a restart re-subscribes and re-projects.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Minimal local shape of uiSession.pendingInteractions (package not in store). */
interface PendingInteractionsLike {
  getSnapshot(): ReadonlyMap<string, unknown>
  subscribe(listener: () => void): () => void
}

export interface WaitingFace {
  /** Cached key Set — identity-stable across equal snapshots (useSyncExternalStore contract). */
  getSnapshot(): ReadonlySet<string>
  subscribe(listener: () => void): () => void
}

export interface WaitingTracker extends WaitingFace {
  dispose(): void
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>()

export function createWaitingTracker(ctx: Context): WaitingTracker {
  const listeners = new Set<() => void>()
  let current: ReadonlySet<string> = EMPTY_SET

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  /** Map keys → Set with set-equality guard: replay storms must not thrash. */
  const replace = (map: ReadonlyMap<string, unknown>): void => {
    const next = new Set<string>()
    for (const key of map.keys()) next.add(key)
    const unchanged = next.size === current.size && [...next].every((key) => current.has(key))
    if (unchanged) return
    current = next
    notify()
  }

  let unsub: (() => void) | undefined
  let loggedFirst = false
  const fiber = ctx.inject(['uiSession'], (scope: unknown) => {
    const face = (scope as { uiSession?: { pendingInteractions?: PendingInteractionsLike } }).uiSession?.pendingInteractions
    // TODO(P2b 验收期诊断)：定位 Face U 接线断点，验收后降级为静默降级。
    if (face === undefined) {
      console.error('[skyaxis waiting-tracker] uiSession available but pendingInteractions face missing — fourth state degraded')
      return () => {}
    }
    const project = (source: string): void => {
      replace(face.getSnapshot())
      // TODO(P2b 验收期诊断)：三向分流——提问卡片弹出时若无此日志 ⇒ face 未通知；
      // 有日志但 size=0 ⇒ GUI 卡片不经 sessionId 投影；size>0 ⇒ 断点在下游穿线。
      console.info(`[skyaxis waiting-tracker] project(${source}) size=${current.size} keys=${[...current].join(',')}`)
    }
    unsub = face.subscribe(() => { project('notify') })
    project('initial')
    if (!loggedFirst) {
      loggedFirst = true
      console.info('[skyaxis waiting-tracker] face ready, first snapshot size:', current.size)
    }
    return () => {
      unsub?.()
      unsub = undefined
    }
  }) as { dispose(): void }

  return {
    getSnapshot: () => current,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose(): void {
      void fiber.dispose()
      unsub = undefined
      // Waiting facts do not outlive their source — dispose empties the set.
      if (current.size !== 0) {
        current = EMPTY_SET
        notify()
      }
      listeners.clear()
    },
  }
}
