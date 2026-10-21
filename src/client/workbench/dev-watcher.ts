/**
 * Register-level dev-declare watcher (0016 P1a, decisions/0016 修订 #2) —
 * the GLOBAL completion-signal engine. The view-level analysis/split watchers
 * only fire for the requirement whose tab is open; a dev session finishing
 * while nobody watches would lose its declaration until someone happened to
 * open that requirement. This watcher lives at register.tsx scope (the
 * waiting-tracker structural precedent — created once per plugin lifetime,
 * subscribed to the sessions face, never per-tab):
 *
 *   sessions.list snapshot flip
 *     → running→idle EDGES schedule the throttled sweep (leading edge fires
 *       immediately, further flips inside the window coalesce into one
 *       trailing sweep — the「30s 节流共享 demand」ruling, D11 will share
 *       the demand with focus-refresh in P1c)
 *     → idle→running EDGES re-arm (clear the attempted keys — a rework
 *       round must get a fresh seed attempt even in one mount)
 *     → the sweep lists the ledger once, then per record per in-dev WP with
 *       a dev binding attempts ONE quiet seed (the endpoint's
 *       two-dimensional anchor makes repeats zero-write no-ops; the
 *       client cannot see the hash dimension at all — that judgment is
 *       the host's).
 *
 * Failure honesty: a failed/degraded list skip the sweep entirely (the next
 * flip or the view's mount catch-up retries — never a phantom state); a
 * 409 on an individual seed skips that WP (revision churn from a concurrent
 * writer — the sweep's revision rides each response's fresh value). The
 * watcher never banners, never busy-toggles — it is invisible when healthy.
 */
import type { WorkbenchController } from './controller.js'
import type { WorkbenchFetcher } from './fetcher.js'
import type { WorkbenchRecord } from '../../workbench-shared/protocol.js'
import type { WorkbenchSessionsFace } from './view.js'
import { DEV_SOW_TITLE_WP_RE } from './sow.js'

/** Default sweep throttle window (the「30s 节流」ruling; tests inject 0). */
const DEFAULT_THROTTLE_MS = 30_000

/**
 * 0016 刀一验收修正: title-addressed dev-session binding — the pure join the
 * view-level pass and this watcher's sweep share. For every in-dev WP whose
 * latest dev binding is ABSENT or points to a blank shell (the DSH delivery
 * artifact that never runs), find the newest UNBOUND session whose display
 * title carries the WP's SOW head (`# (skyaxis )?工作包任务书 WP<n>…` — the
 * real conversation's fallback title; 0021 去品牌后 matcher 双臂兼容旧形)
 * and propose the bind.
 *
 * Gates (all client-visible facts, no guessing): a GONE binding session is
 * left alone (rotation is not our call to repair); a live non-blank binding
 * means the real session is already associated; the matched session must not
 * be bound to any package of this record (any purpose — the title names the
 * WP, cross-binding it elsewhere would be a lie).
 */
export function devTitleBindTargets(
  record: WorkbenchRecord,
  face: { ids: readonly string[]; summariesById: Readonly<Record<string, { displayTitle: string; running: boolean; blank: boolean } | undefined>> },
): Array<{ workPackageId: string; sessionId: string }> {
  const bound = new Set(record.workPackages.flatMap((wp) => wp.sessions.map((binding) => binding.sessionId)))
  const matchByWp = new Map<string, string>()
  for (const id of face.ids) {
    const summary = face.summariesById[id]
    if (summary === undefined) continue
    const match = DEV_SOW_TITLE_WP_RE.exec(summary.displayTitle)
    if (match === null || bound.has(id)) continue
    matchByWp.set(match[1]!, id) // ids order = recency order — last match wins (newest delivery)
  }
  const targets: Array<{ workPackageId: string; sessionId: string }> = []
  for (const workPackage of record.workPackages) {
    // 刀一验收二修: association is valid wherever the WP lives (the user
    // delivers dev SOWs before pressing 开始开发); only a dropped WP is out.
    if (workPackage.status === 'dropped') continue
    const latest = [...workPackage.sessions].reverse().find((binding) => binding.purpose === 'dev')
    if (latest !== undefined) {
      const summary = face.summariesById[latest.sessionId]
      // absent summary (gone) or a live/real session — not ours to rebind
      if (summary === undefined || summary.running || !summary.blank) continue
    }
    const matched = matchByWp.get(workPackage.id)
    if (matched !== undefined) targets.push({ workPackageId: workPackage.id, sessionId: matched })
  }
  return targets
}

export interface DevDeclareWatcherDeps {
  readonly fetcher: WorkbenchFetcher
  readonly controller: WorkbenchController
  /** Absent face (jsdom/tests) ⇒ the watcher inert — honest degrade, no timer. */
  readonly sessions: WorkbenchSessionsFace | undefined
  readonly throttleMs?: number
  /** Injection point for tests (fake timers own the clock); default Date.now. */
  readonly now?: () => number
}

export function createDevDeclareWatcher(deps: DevDeclareWatcherDeps): { dispose(): void } {
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
  // (requirementId:workPackageId) → the dev-binding session it was attempted
  // under; a running edge of THAT session re-arms exactly these keys (a
  // rework round deserves a fresh attempt — precise, not a blanket clear).
  const attempted = new Map<string, string>()

  const armKey = (requirementId: string, workPackageId: string): string => `${requirementId}:${workPackageId}`

  const dispose = (): void => {
    disposed = true
    if (trailingTimer !== undefined) clearTimeout(trailingTimer)
    trailingTimer = undefined
  }

  const scheduleSweep = (): void => {
    if (disposed) return
    // lastSweepAt === 0 = never swept — the FIRST sweep bypasses the window
    // (a completion signal should not sit out a cold-start delay).
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
      // 0016 刀一验收修正: the title-addressed BIND pass rides the same sweep —
      // binds the real conversation session to its WP for requirements nobody
      // is watching. fetcher-direct (not the controller face) so the file
      // revision threads through the sweep; the open requirement's view-level
      // pass covers the in-flight window with the patching controller face.
      if (liveRunning !== undefined) {
        for (const record of list.records) {
          for (const target of devTitleBindTargets(record, liveRunning)) {
            const bound = await deps.fetcher.bindSession(record.requirementId, revision, target.workPackageId, target.sessionId, 'dev')
            if (bound.kind === 'ok') revision = bound.revision
          }
        }
      }
      for (const record of list.records) {
        for (const workPackage of record.workPackages) {
          // 刀一验收二修: attempt every non-dropped WP — the endpoint
          // content-addresses the real session itself (shell repair / fresh
          // search), so a missing binding is no longer a client-side skip.
          if (workPackage.status === 'dropped') continue
          const binding = [...workPackage.sessions].reverse().find((row) => row.purpose === 'dev')
          // RUNNING gate (the「关闸永不 mid-run」ruling) — only knowable for a
          // bound session; a running edge re-arms the key so the completion
          // sweep retries.
          if (binding !== undefined && liveRunning !== undefined && liveRunning.summariesById[binding.sessionId]?.running === true) continue
          const key = armKey(record.requirementId, workPackage.id)
          if (attempted.has(key)) continue
          // A binding-less WP has NO arm identity to re-arm on (the real
          // session's id is unknown here) — leave it unattempted so every
          // sweep retries (edge-triggered + throttled; misses are zero-write).
          if (binding !== undefined) attempted.set(key, binding.sessionId)
          const slot = record.devDeclares?.[workPackage.id]
          // Client-visible due dims only: never seeded, or the binding moved.
          // The hash dimension is the endpoint's judgment (zero-write anchor).
          if (slot !== undefined && binding !== undefined && slot.seed.sessionId === binding.sessionId && slot.adjudication === 'pending') continue
          const outcome = await deps.controller.seedDevDeclareDetached(record.requirementId, revision, workPackage.id)
          if (outcome === undefined) continue // 409/network → next flip retries (attempted stays set; the view's mount catch-up covers the open tab)
          if (outcome.revision !== undefined) revision = outcome.revision // a landed write bumped the file revision — thread the fresh value
        }
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
    // Precise re-arm: only the keys attempted under a session that just went
    // RUNNING get their fresh attempt (a rework round); another session's
    // activity never re-arms unrelated packages.
    if (runningEdges.size > 0) {
      for (const [key, session] of attempted) {
        if (runningEdges.has(session)) attempted.delete(key)
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
