/**
 * P2 session strip: the cross-stage chip row joining the ledger's session
 * bindings (every work package — dropped included, since a dropped package's
 * bindings are still ledger facts) against the sessions.list snapshot the
 * parent projects into `summaries`.
 *
 * Pure render: no store subscription, no fetching — the parent owns the
 * snapshot projection and the navigability decision; this component only
 * gates the callback through `navigableIds`. A binding whose session has
 * left the list renders as a non-interactive span with the gone copy and an
 * id-prefix fallback title (honest about the dead reference instead of
 * faking a clickable chip); a session present but not navigable keeps its
 * chip clickable-shaped yet aria-disabled and never calls onNavigate.
 */
import type { ReactNode } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchRecord, WorkbenchSessionBinding } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import styles from './view.module.css'

/** One sessions.list snapshot row (parent-projected; found by id). */
export interface SessionStripSummary {
  id: string
  displayTitle: string
  running: boolean
  blank: boolean
}

const PURPOSE_LABEL_KEY: Record<WorkbenchSessionBinding['purpose'], Parameters<WorkbenchT>[0]> = {
  analysis: 'session.purposeAnalysis',
  dev: 'session.purposeDev',
  review: 'session.purposeReview',
}

export function SessionStrip(props: {
  t: WorkbenchT
  /** Non-null by contract — the parent gates the record-null phase. */
  record: WorkbenchRecord
  /** Requirement context for the empty-strip copy (reserved; the hint is self-contained today). */
  requirement: { id: string; title: string }
  summaries: readonly SessionStripSummary[]
  navigableIds: readonly string[]
  onNavigate: (sessionId: string) => void
}): ReactNode {
  const { t, record, summaries, navigableIds, onNavigate } = props
  // (wpId, sessionId, purpose) is naturally unique per record — the key and
  // the one-chip-per-binding guarantee are the same fact.
  const bindings = record.workPackages.flatMap((workPackage) =>
    workPackage.sessions.map((binding) => ({ ...binding, wpId: workPackage.id, wpTitle: workPackage.title })),
  )

  if (bindings.length === 0) {
    // Honest empty state: one guide line, no zero-count label.
    return (
      <div className={styles.sessionStrip}>
        <span className={styles.stripLabel}>{t('session.stripEmptyHint')}</span>
      </div>
    )
  }

  return (
    <div className={styles.sessionStrip}>
      <span className={styles.stripLabel}>{t('session.stripLabel').replaceAll('{n}', String(bindings.length))}</span>
      {bindings.map((binding) => {
        const key = `${binding.wpId}:${binding.sessionId}:${binding.purpose}`
        const purposeLabel = t(PURPOSE_LABEL_KEY[binding.purpose])
        const summary = summaries.find((candidate) => candidate.id === binding.sessionId)
        if (summary === undefined) {
          // Gone: the session left the list — a span, no dot, no click; the
          // title falls back to the id prefix.
          return (
            <span key={key} className={styles.sessionChipGone} title={`${binding.wpId}　${binding.wpTitle}`}>
              {`${binding.wpId}·${purposeLabel}·${binding.sessionId.slice(0, 8)}`}
              <span className={styles.sessionChipState}>{t('session.stateGone')}</span>
            </span>
          )
        }
        // Three honest states (research 0007: the client "completed" bit is a
        // notification artifact, never trusted here): running / idle / blank.
        const state = summary.running
          ? { dot: 'ongoing' as const, label: t('session.stateRunning') }
          : summary.blank
            ? { dot: 'idle' as const, label: t('session.stateBlank') }
            : { dot: 'done' as const, label: t('session.stateIdle') }
        const navigable = navigableIds.includes(binding.sessionId)
        return (
          <button
            key={key}
            type="button"
            className={styles.sessionChip}
            title={`${binding.wpId}　${binding.wpTitle}`}
            aria-disabled={navigable ? undefined : true}
            onClick={() => { if (navigable) onNavigate(binding.sessionId) }}
          >
            <StateDot state={state.dot} />
            {`${binding.wpId}·${purposeLabel}·${summary.displayTitle}`}
            <span className={styles.sessionChipState}>{state.label}</span>
          </button>
        )
      })}
    </div>
  )
}
