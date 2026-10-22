/**
 * Register-level review-report watcher (0024 D2-A, decisions/0024) — the
 * review twin of dev-watcher.ts. The dev declare/analysis/split/wp-plan
 * deliveries all gained a collection engine; the review SOW's report had
 * NONE (the acceptance finding): the delivered session was anonymous (no
 * bind) and the report only returned by manual paste. This watcher closes
 * the loop:
 *
 *   review SOW delivery ──bind──▶ record.reviewSession (the watch pointer)
 *     sessions.list flip → running→idle EDGES schedule the throttled sweep
 *     → the sweep lists the ledger once, then per record with a
 *       reviewSession binding (RUNNING gate — never read mid-run) attempts
 *       ONE quiet auto-import (controller.autoImportReview: fetch the whole
 *       assistant message carrying `# skyaxis-review`, write it through the
 *       same writeReview idempotency anchor as the manual import — repeats
 *       converge zero-write, deleted rows never resurrect)
 *     → idle→running EDGES re-arm (a follow-up turn / re-review round in
 *       the SAME session must get a fresh attempt)
 *
 * No title-addressed bind pass here (dev needed it to repair pre-bind
 * history; review binds at delivery from day one). Failure honesty mirrors
 * dev: a degraded list skips the sweep (the next flip or the view's mount
 * catch-up retries); a miss (no-review-block) is advisory — attempted stays
 * set, only a running edge re-arms. The watcher never banners, never
 * busy-toggles — invisible when healthy.
 */
import type { WorkbenchController } from './controller.js'
import type { WorkbenchFetcher } from './fetcher.js'
import type { WorkbenchSessionsFace } from './view.js'

/** Default sweep throttle window (the dev-watcher「30s 节流」ruling; tests inject 0). */
const DEFAULT_THROTTLE_MS = 30_000

export interface ReviewWatcherDeps {
  readonly fetcher: WorkbenchFetcher
  readonly controller: WorkbenchController
  /** Absent face (jsdom/tests) ⇒ the watcher inert — honest degrade, no timer. */
  readonly sessions: WorkbenchSessionsFace | undefined
  readonly throttleMs?: number
  /** Injection point for tests (fake timers own the clock); default Date.now. */
  readonly now?: () => number
}

export function createReviewWatcher(deps: ReviewWatcherDeps): { dispose(): void } {
  const throttleMs = deps.throttleMs ?? DEFAULT_THROTTLE_MS
  const now = deps.now ?? ((): number => Date.now())
  let disposed = false
  // INITIAL capture (the sessions face does NOT fire on subscribe — without
  // this the first flip has no baseline and every early edge is invisible).
  let prevRunning = new Set<string>(
    deps.sessions?.ids.filter((id) => deps.sessions?.summariesById[id]?.running === true) ?? [],
  )
  let lastSweepAt = 0
  let trailingTimer: ReturnType<typeof setTimeout> | undefined
  let sweeping = false
  // requirementId → the review-session id an import was attempted under; a
  // running edge of THAT session re-arms exactly this key (a follow-up turn
  // in the same session deserves a fresh attempt — precise, not blanket).
  const attempted = new Map<string, string>()

  const dispose = (): void => {
    disposed = true
    if (trailingTimer !== undefined) clearTimeout(trailingTimer)
    trailingTimer = undefined
  }

  const scheduleSweep = (): void => {
    if (disposed) return
    // lastSweepAt === 0 = never swept — the FIRST sweep bypasses the window
    // (the post-restart catch-up should not sit out a cold-start delay).
    const elapsed = lastSweepAt === 0 ? Number.POSITIVE_INFINITY : now() - lastSweepAt
    if (elapsed >= throttleMs) {
      void sweep()
      return
    }
    if (trailingTimer !== undefined) return // already coalesced
    trailingTimer = setTimeout(() => {
      trailingTimer = undefined
      void sweep()
    }, throttleMs - elapsed)
  }

  const sweep = async (): Promise<void> => {
    if (disposed || sweeping) return
    sweeping = true
    lastSweepAt = now()
    try {
      const list = await deps.fetcher.list()
      if (disposed || list.kind !== 'ok') return // degraded/network → next flip retries
      let revision = list.revision
      const liveRunning = deps.sessions
      for (const record of list.records) {
        const binding = record.reviewSession
        if (binding === undefined) continue
        // RUNNING gate (the「关闸永不 mid-run」ruling) — checked BEFORE the
        // attempted mark: an idle flip after the run re-triggers the sweep
        // and gets its full attempt.
        if (liveRunning !== undefined && liveRunning.summariesById[binding.sessionId]?.running === true) continue
        if (attempted.get(record.requirementId) === binding.sessionId) continue
        attempted.set(record.requirementId, binding.sessionId)
        const outcome = await deps.controller.autoImportReview(record.requirementId, binding.sessionId, revision)
        if (outcome === undefined) continue // 409/network → next flip retries (attempted stays set; the view's mount catch-up covers the open tab)
        if (outcome.landed && outcome.revision !== revision) revision = outcome.revision // a landed write bumped the file revision — thread the fresh value
      }
    } finally {
      sweeping = false
    }
  }

  const unsubscribe = deps.sessions?.subscribe(() => {
    if (disposed) return
    const snapshot = deps.sessions
    if (snapshot === undefined) return
    const current = new Set(snapshot.ids.filter((id) => snapshot.summariesById[id]?.running === true))
    const runningEdges = new Set<string>()
    let idleEdge = false
    for (const id of current) {
      if (!prevRunning.has(id)) {
        runningEdges.add(id)
      } else {
        idleEdge = true
      }
    }
    for (const id of prevRunning) {
      if (!current.has(id)) idleEdge = true
    }
    // Precise re-arm: only the requirement whose review session just went
    // RUNNING gets its fresh attempt (the follow-up-turn case); another
    // session's activity never re-arms unrelated requirements.
    if (runningEdges.size > 0) {
      for (const [requirementId, sessionId] of attempted) {
        if (runningEdges.has(sessionId)) attempted.delete(requirementId)
      }
    }
    prevRunning = current
    if (idleEdge) scheduleSweep()
  })

  return {
    dispose: () => {
      dispose()
      if (unsubscribe !== undefined) unsubscribe()
    },
  }
}
