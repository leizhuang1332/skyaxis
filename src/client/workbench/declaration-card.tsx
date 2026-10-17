/**
 * Dev-declare collection card (0016 P1a) — the S3-面 home of a WP's collected
 * declaration batch. Three honest states off the ledger slot:
 *
 *  - pending  → the收取卡: seed provenance + [导入声明] (the DeclareImportModal
 *    with the slot's devDeclare key + preselected seed session — the commit
 *    stamps slot imported + receipt atomically) + [忽略] (adjudicate dismiss)
 *    + [重新收取] (a quiet re-seed; a zero-write miss is disclosed inline,
 *    the proposal.waitingHint observability discipline).
 *  - imported → a collapsed receipt line (第 n 轮 · at — wp.declarations tail).
 *  - dismissed→ a collapsed line (adjudicatedAt).
 *
 * No slot ⇒ no card (the P1b「完成待读」board badge is the other projector;
 * this component never fabricates absence). The card is view-only off the
 * slot snapshot — every action goes through the controller faces.
 */
import { useState, type ReactNode } from 'react'
import type { DevDeclareSeedMissing, WorkbenchWorkPackage } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import { DeclareImportModal } from './declare-import-modal.js'
import styles from './view.module.css'

/** Miss reason → dictionary key. Exhaustive Record — a new enum member is a type error here (the SKIP_REASON_KEY discipline). */
const DEV_SEED_MISS_KEY: Record<DevDeclareSeedMissing, Parameters<WorkbenchT>[0]> = {
  'no-service': 'declare.miss.noService',
  'not-found': 'declare.miss.notFound',
  'unreadable': 'declare.miss.unreadable',
  'no-declare-block': 'declare.miss.noDeclareBlock',
  'no-binding': 'declare.miss.noBinding',
  'wp-not-in-dev': 'declare.miss.wpNotInDev',
  'wp-mismatch': 'declare.miss.wpMismatch',
}

export function DeclarationCard(props: {
  t: WorkbenchT
  requirementId: string
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  workPackage: WorkbenchWorkPackage
  /** Session snapshot (the dialog's plain shape) — feeds the embedded import modal's fetch dropdown. */
  sessions?: { ids: readonly string[]; summariesById: Readonly<Record<string, { id: string; displayTitle: string; running: boolean; blank: boolean } | undefined>> }
}): ReactNode {
  const { t, controller, requirementId, slot } = props
  const record = slot.record
  const slotRow = record?.devDeclares?.[props.workPackage.id]
  const [importOpen, setImportOpen] = useState(false)
  const [retryMiss, setRetryMiss] = useState<DevDeclareSeedMissing | undefined>(undefined)
  const [retrying, setRetrying] = useState(false)
  // Static face over the dialog's snapshot: the import modal only reads
  // summariesById off its face (presence gates the fetch dropdown), so a
  // non-subscribing adapter is honest here.
  const modalSessions = props.sessions !== undefined
    ? { ids: props.sessions.ids, summariesById: props.sessions.summariesById, subscribe: (): (() => void) => () => {}, navigate: (): void => {} }
    : undefined

  if (record === null || slotRow === undefined) return null

  if (slotRow.adjudication === 'imported') {
    const receipt = (props.workPackage.declarations ?? []).at(-1)
    return (
      <div className={styles.formHint}>
        {t('declareCard.importedLine')
          .replaceAll('{n}', String(receipt?.seq ?? 0))
          .replaceAll('{at}', (receipt?.at ?? slotRow.adjudicatedAt ?? '').slice(0, 16).replace('T', ' '))}
      </div>
    )
  }
  if (slotRow.adjudication === 'dismissed') {
    return (
      <div className={styles.formHint}>
        {t('declareCard.dismissedLine').replaceAll('{at}', (slotRow.adjudicatedAt ?? '').slice(0, 16).replace('T', ' '))}
      </div>
    )
  }

  const onRetry = (): void => {
    if (retrying) return
    setRetrying(true)
    void controller.seedDevDeclareQuiet(requirementId, props.workPackage.id).then((outcome) => {
      setRetrying(false)
      // Landed ⇒ the slot flips and this re-render as the pending card with
      // the NEW seed (miss cleared); a miss stays disclosed until the next try.
      setRetryMiss(outcome !== undefined && !outcome.landed ? outcome.miss : undefined)
    })
  }

  return (
    <div className={styles.formField}>
      <span>{t('declareCard.sectionTitle')}</span>
      <div className={styles.findingFieldRow}>
        <div className={styles.declareCardBody}>
          <div>
            {t('declareCard.pendingTitle')
              .replaceAll('{s}', slotRow.seed.sessionId.slice(0, 8))
              .replaceAll('{at}', slotRow.seed.seededAt.slice(0, 16).replace('T', ' '))}
          </div>
          {retryMiss !== undefined ? <div className={styles.fieldError}>{t(DEV_SEED_MISS_KEY[retryMiss])}</div> : null}
        </div>
        <button type="button" className={styles.primaryButton} disabled={slot.busy} onClick={() => { setImportOpen(true) }}>
          {t('declareCard.importButton')}
        </button>
        <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { void controller.adjudicateDevDeclare(requirementId, props.workPackage.id) }}>
          {t('declareCard.dismissButton')}
        </button>
        <button type="button" className={styles.ghostButton} disabled={slot.busy || retrying} onClick={onRetry}>
          {t('declareCard.retryButton')}
        </button>
      </div>
      <DeclareImportModal
        t={t}
        open={importOpen}
        requirementId={requirementId}
        slot={slot}
        controller={controller}
        sessions={modalSessions}
        devDeclare={{ workPackageId: props.workPackage.id }}
        preselectSessionId={slotRow.seed.sessionId}
        onClose={() => { setImportOpen(false) }}
      />
    </div>
  )
}
