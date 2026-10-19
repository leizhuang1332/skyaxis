/**
 * Inbox section (0016 P1c) — the S3 top「需要你」bar rendering ONLY the two
 * exception groups (卡哪·存疑 + 等你·待发送) from the eight-group engine.
 * The other six groups are already surfaced by board columns, card badges,
 * the session strip, or the declaration card — duplicating them here would
 * be the「第三个事实投影」the over-engineering attacker rejected.
 *
 * Empty state = zero footprint (both groups empty ⇒ component returns null).
 * Each row carries a verb button that routes through the view layer's
 * callbacks (jump-session / open-work-package / start-work-package).
 */
import type { ReactNode } from 'react'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchRecord } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import { inboxGroups, type InboxRow } from './inbox-engine.js'
import styles from './view.module.css'

const STUCK_REASON_KEY: Record<string, Parameters<WorkbenchT>[0]> = {
  'no-binding': 'inbox.stuckNoBinding',
  'gone': 'inbox.stuckGone',
  'idle-no-slot': 'inbox.stuckIdle',
}

export function InboxSection(props: {
  t: WorkbenchT
  record: WorkbenchRecord
  sessions?: { ids: readonly string[]; summariesById: Readonly<Record<string, { id: string; displayTitle: string; running: boolean; blank: boolean } | undefined>> }
  waitingIds?: ReadonlySet<string>
  onNavigateSession: (sessionId: string) => void
  onOpenWorkPackage: (workPackageId: string) => void
  onStartWorkPackage: (workPackageId: string) => void
}): ReactNode {
  const { t } = props
  const groups = inboxGroups(props.record, props.sessions, props.waitingIds ?? new Set())
  const stuck = groups.find((g) => g.key === 'stuck')!
  const pending = groups.find((g) => g.key === 'waiting-send')!
  const allRows = [...stuck.rows, ...pending.rows]

  if (allRows.length === 0) return null

  const renderRow = (row: InboxRow): ReactNode => {
    return (
      <div key={row.workPackageId + row.reason} className={styles.inboxRow}>
        <Tag tone={row.reason === 'blank' ? 'warning' : 'danger'}>{row.reason === 'blank' ? t('inbox.pendingSend') : t(STUCK_REASON_KEY[row.reason] ?? 'inbox.stuckIdle')}</Tag>
        <span className={styles.inboxRowLabel}>{row.workPackageId} {row.label}</span>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => {
            if (row.action === 'jump-session' && row.sessionId !== undefined) props.onNavigateSession(row.sessionId)
            else if (row.action === 'start-work-package') props.onStartWorkPackage(row.workPackageId)
            else props.onOpenWorkPackage(row.workPackageId)
          }}
        >
          {row.action === 'jump-session' ? t('inbox.jumpToSession') : row.action === 'start-work-package' ? t('detail.startWork') : t('inbox.openDetail')}
        </button>
      </div>
    )
  }

  return (
    <div className={styles.inboxSection}>
      <div className={styles.sectionTitle}>{t('inbox.sectionTitle')}</div>
      {stuck.rows.length > 0 ? (
        <div className={styles.inboxGroup}>
          <span className={styles.inboxGroupLabel}>{t('inbox.groupStuck')}</span>
          {stuck.rows.map(renderRow)}
        </div>
      ) : null}
      {pending.rows.length > 0 ? (
        <div className={styles.inboxGroup}>
          <span className={styles.inboxGroupLabel}>{t('inbox.groupPending')}</span>
          {pending.rows.map(renderRow)}
        </div>
      ) : null}
    </div>
  )
}
