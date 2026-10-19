/**
 * Inbox engine (0016 P1c) — the pure-function eight-group「球在哪」projection.
 * Answers the Persona-B question「现在该我做什么」at a glance: every group
 * is derived from ledger facts + the live sessions face, never from guessed
 * or fabricated state (zero-fake-waiting — the zero-fake-progress extension).
 *
 * The S3 section renders ONLY groups 2 (卡哪·存疑) and 1 (等你·待发送) —
 * the other six are already surfaced by board columns, card badges, the
 * session strip, or the declaration card; duplicating them here would be the
 *「第三个事实投影」the over-engineering attacker rejected (修订 #3).
 *
 * Full order (research/0016 §10):
 *   等你·应答 > 等你·待发送 > 等你·待批计划 > 完成待验收 > 卡哪·存疑 > 跑着 > 等你·点火 > 完成
 *
 * split-stale.ts discipline: pure function, zero IO, zero React, fully
 * matrix-testable. All inputs are already-verified truth sources (the ledger
 * record, the sessions face snapshot, the waitingIds set).
 */
import type { WorkbenchRecord } from '../../workbench-shared/protocol.js'

/** The minimal session-summary face the engine consumes (register-injected; absent in tests). */
export interface InboxSessionFace {
  readonly ids: readonly string[]
  readonly summariesById: Readonly<Record<string, { id: string; displayTitle: string; running: boolean; blank: boolean } | undefined>>
}

export type InboxGroupKey =
  | 'waiting-answer'
  | 'waiting-send'
  | 'waiting-plan'
  | 'ready-review'
  | 'stuck'
  | 'running'
  | 'ready-ignite'
  | 'done'

export type InboxRowAction = 'jump-session' | 'open-work-package' | 'start-work-package' | 'import-declare' | 'accept-work-package'

export interface InboxRow {
  readonly workPackageId: string
  readonly label: string
  readonly reason: 'waiting' | 'blank' | 'plan-draft' | 'no-binding' | 'gone' | 'idle-no-slot' | 'pending-declare' | 'built' | 'dep-ready' | 'running' | 'accepted' | 'dropped'
  readonly action: InboxRowAction
  readonly sessionId?: string
}

export interface InboxGroup {
  readonly key: InboxGroupKey
  readonly rows: readonly InboxRow[]
}

/** Ordered group keys — the display/priority order (research/0016 §10). */
export const INBOX_GROUP_ORDER: readonly InboxGroupKey[] = [
  'waiting-answer',
  'waiting-send',
  'waiting-plan',
  'ready-review',
  'stuck',
  'running',
  'ready-ignite',
  'done',
]

/**
 * Project the eight groups from the ledger + live session face + waitingIds.
 * Every WP lands in AT MOST ONE group (first-match by the priority order) —
 * a package waiting for BOTH answer AND plan-approval shows as 等你·应答
 * (the more urgent blocker).
 */
export function inboxGroups(
  record: WorkbenchRecord,
  face: InboxSessionFace | undefined,
  waitingIds: ReadonlySet<string>,
): InboxGroup[] {
  const groups = new Map<InboxGroupKey, InboxRow[]>(INBOX_GROUP_ORDER.map((key) => [key, []]))

  for (const wp of record.workPackages) {
    const row = classifyWorkPackage(wp, record, face, waitingIds)
    if (row !== null) groups.get(row.group)!.push(row.row)
  }

  return INBOX_GROUP_ORDER.map((key) => ({ key, rows: groups.get(key)! }))
}

/** Classify one WP into its highest-priority group; null = not in any actionable group. */
function classifyWorkPackage(
  wp: WorkbenchRecord['workPackages'][number],
  record: WorkbenchRecord,
  face: InboxSessionFace | undefined,
  waitingIds: ReadonlySet<string>,
): { group: InboxGroupKey; row: InboxRow } | null {
  const latestDev = [...wp.sessions].reverse().find((s) => s.purpose === 'dev')
  const summary = latestDev !== undefined ? face?.summariesById[latestDev.sessionId] : undefined

  // 等你·应答: the dev-bound session has a pending interaction
  if (latestDev !== undefined && waitingIds.has(latestDev.sessionId)) {
    return {
      group: 'waiting-answer',
      row: { workPackageId: wp.id, label: wp.title, reason: 'waiting', action: 'jump-session', sessionId: latestDev.sessionId },
    }
  }

  // 等你·待发送: the dev-bound session is blank (delivery shell not yet sent)
  if (latestDev !== undefined && summary !== undefined && summary.blank && !summary.running) {
    return {
      group: 'waiting-send',
      row: { workPackageId: wp.id, label: wp.title, reason: 'blank', action: 'jump-session', sessionId: latestDev.sessionId },
    }
  }

  // 等你·待批计划: an unapproved tail draft exists (any WP status)
  const tailDraft = [...wp.plans].reverse().find((p) => p.approvedAt === undefined)
  if (tailDraft !== undefined) {
    return {
      group: 'waiting-plan',
      row: { workPackageId: wp.id, label: wp.title, reason: 'plan-draft', action: 'open-work-package' },
    }
  }

  // 完成待验收: devDeclares slot pending OR WP built
  if (record.devDeclares?.[wp.id]?.adjudication === 'pending') {
    return {
      group: 'ready-review',
      row: { workPackageId: wp.id, label: wp.title, reason: 'pending-declare', action: 'import-declare' },
    }
  }
  if (wp.status === 'built') {
    return {
      group: 'ready-review',
      row: { workPackageId: wp.id, label: wp.title, reason: 'built', action: 'accept-work-package' },
    }
  }

  // 卡哪·存疑: in-dev with no binding, gone binding, or idle with no slot and no declarations
  if (wp.status === 'in-dev') {
    if (latestDev === undefined) {
      return {
        group: 'stuck',
        row: { workPackageId: wp.id, label: wp.title, reason: 'no-binding', action: 'open-work-package' },
      }
    }
    if (summary === undefined) {
      return {
        group: 'stuck',
        row: { workPackageId: wp.id, label: wp.title, reason: 'gone', action: 'open-work-package' },
      }
    }
    // idle with no pending slot and no declarations anchor — the session may have died
    if (!summary.running && !summary.blank && summary.displayTitle.length > 0) {
      const hasSlot = record.devDeclares?.[wp.id] !== undefined
      const hasAnchor = (wp.declarations ?? []).length > 0
      if (!hasSlot && !hasAnchor) {
        return {
          group: 'stuck',
          row: { workPackageId: wp.id, label: wp.title, reason: 'idle-no-slot', action: 'jump-session', sessionId: latestDev.sessionId },
        }
      }
    }
  }

  // 跑着: running and not waiting
  if (summary?.running === true) {
    return {
      group: 'running',
      row: { workPackageId: wp.id, label: wp.title, reason: 'running', action: 'jump-session', sessionId: latestDev!.sessionId },
    }
  }

  // 等你·点火: plan-approved, not started, dependencies ready (advisory)
  if (wp.status === 'plan-approved') {
    const depsReady = wp.dependsOn.every((dep) => {
      const depWp = record.workPackages.find((w) => w.id === dep)
      return depWp === undefined || depWp.status === 'built' || depWp.status === 'accepted'
    })
    if (depsReady) {
      return {
        group: 'ready-ignite',
        row: { workPackageId: wp.id, label: wp.title, reason: 'dep-ready', action: 'start-work-package' },
      }
    }
  }

  // 完成: accepted or dropped
  if (wp.status === 'accepted' || wp.status === 'dropped') {
    return {
      group: 'done',
      row: { workPackageId: wp.id, label: wp.title, reason: wp.status === 'accepted' ? 'accepted' : 'dropped', action: 'open-work-package' },
    }
  }

  return null // planned with no draft, not in any actionable state
}
