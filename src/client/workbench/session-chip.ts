/**
 * The unified session chip-state derivation (P2b; ex session-strip.tsx — the
 * strip surface retired 2026-10-19 by user ruling, the pure function moved
 * here verbatim for its three remaining consumers: session-picker,
 * work-package-dialog, execution-section).
 *
 * waiting > running > blank > idle. Waiting outranks running because the
 * waterfall face is the MORE precise fact — an approval wait keeps
 * running=true (research 0007 §1.1); the pendingInteractions projection is
 * keyed by exactly the same sessionId.
 */
import type { WorkbenchT } from './dictionary.js'

export function sessionChipState(
  waiting: boolean,
  running: boolean,
  blank: boolean,
): { dot: 'warning' | 'ongoing' | 'idle' | 'done'; labelKey: 'session.stateWaiting' | 'session.stateRunning' | 'session.stateBlank' | 'session.stateIdle' } {
  if (waiting) return { dot: 'warning', labelKey: 'session.stateWaiting' }
  if (running) return { dot: 'ongoing', labelKey: 'session.stateRunning' }
  if (blank) return { dot: 'idle', labelKey: 'session.stateBlank' }
  return { dot: 'done', labelKey: 'session.stateIdle' }
}

/** Dictionary keys consumed above (register union membership proof). */
export type SessionChipLabelKey = Parameters<WorkbenchT>[0]
