/**
 * P2 session picker: the bind-a-session modal (opened from the S3 detail
 * dialog). Pure selection state — the parent owns the row projection (ids
 * order, blank sessions included), the already-bound disable list, and the
 * bind write. A successful onBind does NOT close the dialog here: the
 * parent closes on success only, so a failed write keeps the picker up for
 * retry. Sessions already bound to THIS work package render disabled —
 * binding is append-only and (wpId, sessionId, purpose) must stay unique.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { sessionChipState } from './session-strip.js'
import type { WorkbenchSessionBinding } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import styles from './view.module.css'

type SessionPurpose = WorkbenchSessionBinding['purpose']

const PURPOSE_LABEL_KEY: Record<SessionPurpose, Parameters<WorkbenchT>[0]> = {
  analysis: 'session.purposeAnalysis',
  dev: 'session.purposeDev',
  review: 'session.purposeReview',
}

export function SessionPicker(props: {
  t: WorkbenchT
  open: boolean
  /** Parent-projected rows (ids order, blank sessions included). */
  rows: readonly { id: string; displayTitle: string; running: boolean; blank: boolean; waiting?: boolean }[]
  /** Sessions already bound to this work package — their rows are disabled. */
  boundSessionIds: readonly string[]
  busy: boolean
  onClose: () => void
  onBind: (sessionId: string, purpose: SessionPurpose) => void
}): ReactNode {
  const { t, open, rows, boundSessionIds, busy, onClose, onBind } = props
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 'dev' preselected — S3 is the dominant bind context; 'analysis' serves
  // the S1/S2 statement-of-work flow.
  const [purpose, setPurpose] = useState<SessionPurpose>('dev')

  // The picker may stay mounted while closed (the Modal renders null):
  // drop the stale selection each reopen — a highlighted row from last
  // time must never bleed into the next bind.
  useEffect(() => {
    if (open) {
      setSelectedId(null)
      setPurpose('dev')
    }
  }, [open])

  // 0016 刀一验收二修: blank sessions are delivery shells / never-started
  // empties — they can never carry a conversation, so offering them as bind
  // choices only invites wrong picks (the shells accumulate one per delivery
  // and pollute the list — the acceptance report's「非 DSH 会话」finding).
  const selectableRows = rows.filter((row) => !row.blank)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('session.bindTitle')}
      closeLabel={t('action.cancel')}
      footer={
        <>
          <button type="button" className={styles.ghostButton} onClick={onClose}>{t('action.cancel')}</button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={selectedId === null || busy}
            onClick={() => { if (selectedId !== null) onBind(selectedId, purpose) }}
          >
            {t('session.pickerSubmit')}
          </button>
        </>
      }
    >
      <div className={styles.modalForm}>
        <div className={styles.formHint}>{t('session.pickerHint')}</div>
        {selectableRows.length === 0 ? (
          <div className={styles.formHint}>{t('session.pickerEmpty')}</div>
        ) : (
          <>
            <div className={styles.pickerList}>
              {selectableRows.map((row) => {
                const bound = boundSessionIds.includes(row.id)
                return (
                  <label key={row.id} className={bound ? styles.pickerRowDisabled : styles.pickerRow}>
                    <input
                      type="radio"
                      name="sessionId"
                      value={row.id}
                      checked={selectedId === row.id}
                      disabled={bound}
                      onChange={() => { setSelectedId(row.id) }}
                    />
                    <StateDot state={sessionChipState(row.waiting ?? false, row.running, row.blank).dot} />
                    <span className={styles.pickerRowTitle}>{row.displayTitle}</span>
                  </label>
                )
              })}
            </div>
            <div role="radiogroup" aria-label={t('session.pickerPurposeLabel')}>
              <span className={styles.formHint}>{t('session.pickerPurposeLabel')}</span>
              {(['analysis', 'dev', 'review'] as const).map((candidate) => (
                <label key={candidate}>
                  <input
                    type="radio"
                    name="purpose"
                    checked={purpose === candidate}
                    onChange={() => { setPurpose(candidate) }}
                  />
                  {' '}
                  {t(PURPOSE_LABEL_KEY[candidate])}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
