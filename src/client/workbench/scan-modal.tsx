/**
 * Artifact reconciliation modal (挂账轮, the P1b scan endpoint's first UI
 * consumer): three ALWAYS-ON faces — orphans (on disk, unreferenced by the
 * ledger), missing (referenced, absent on disk), .trash (deleted
 * requirements) — with zero values shown as zero (对账读数非徽章, the P3a
 * gonogo 恒显零值 precedent). Read-only disclosure, zero destructive
 * actions: deleting orphans would be a new write-action face with its own
 * four-powers argument, deliberately not this round (P4 裁决⑤'s design
 * intent was「留盘成孤儿、scan 可见」in the first place).
 *
 * Rows filter client-side by the CURRENT requirementId: the endpoint is
 * deliberately global and never joins requirements.yaml (the orphan-scan
 * file-header boundary) — the join stays here, matching the seat context.
 * Pure read through the controller (the reviewFetch precedent — no store
 * slot, no busy); pulled on open and on [刷新] (a nonce bump re-fires the
 * effect); loading/failed are dialog-local states.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchScanResponseOk, WorkbenchScanRow } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import styles from './view.module.css'

type ScanPhase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok'; readonly response: WorkbenchScanResponseOk }
  | { readonly kind: 'failed' }

/** The row's reference key: WP id + version / review id / raw file name. */
function rowLabel(row: WorkbenchScanRow): string {
  if (row.kind === 'plan') return `${row.workPackageId ?? '?'} · v${row.version ?? '?'}`
  if (row.kind === 'review') return row.reviewId ?? '?'
  return row.name ?? '?'
}

function kindTag(t: WorkbenchT, row: WorkbenchScanRow): ReactNode {
  if (row.kind === 'plan') return <Tag tone="info">{t('scan.kindPlan')}</Tag>
  if (row.kind === 'review') return <Tag tone="quiet">{t('scan.kindReview')}</Tag>
  return <Tag tone="warning">{t('scan.kindUnknown')}</Tag>
}

export function ScanModal(props: {
  t: WorkbenchT
  open: boolean
  requirementId: string
  controller: WorkbenchController
  onClose: () => void
}): ReactNode {
  const { t } = props
  const [phase, setPhase] = useState<ScanPhase>({ kind: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!props.open) return
    let cancelled = false
    setPhase({ kind: 'loading' })
    void props.controller.scan().then((result) => {
      if (cancelled) return
      setPhase(result.kind === 'ok' ? { kind: 'ok', response: result.response } : { kind: 'failed' })
    })
    return () => { cancelled = true }
  }, [props.open, props.controller, nonce])

  const refresh = (): void => { setNonce(nonce + 1) }

  const rid = props.requirementId
  const orphans = phase.kind === 'ok' ? phase.response.orphans.filter((row) => row.requirementId === rid) : []
  const missing = phase.kind === 'ok' ? phase.response.missing.filter((row) => row.requirementId === rid) : []
  const trash = phase.kind === 'ok' ? phase.response.trash.filter((row) => row.requirementId === rid) : []

  const face = (
    label: string,
    rows: readonly WorkbenchScanRow[],
    prefix: string,
  ): ReactNode => (
    <>
      <div className={styles.scanSectionHead}>{label}（{rows.length}）</div>
      {rows.length === 0
        ? <div className={styles.formHint}>{t('scan.empty')}</div>
        : rows.map((row, index) => (
          <div key={`${prefix}-${row.kind}-${index}`} className={styles.scanRow}>
            {kindTag(t, row)}
            <span>{rowLabel(row)}</span>
          </div>
        ))}
    </>
  )

  return (
    <Modal
      open={props.open}
      onClose={() => { props.onClose() }}
      title={t('scan.title')}
      closeLabel={t('action.cancel')}
      className={styles.sheetDialog}
      contentClassName={styles.wpDialogBody}
      footer={
        <div className={styles.wpFooterMain}>
          <button type="button" className={styles.ghostButton} disabled={phase.kind === 'loading'} onClick={refresh}>
            {t('scan.refresh')}
          </button>
          <button type="button" className={styles.primaryButton} onClick={() => { props.onClose() }}>
            {t('action.cancel')}
          </button>
        </div>
      }
    >
      {phase.kind === 'loading' ? <div className={styles.formHint}>{t('scan.loading')}</div> : null}
      {phase.kind === 'failed' ? <div className={styles.sowWarn} role="alert">{t('scan.failed')}</div> : null}
      {phase.kind === 'ok' ? (
        <>
          {face(t('scan.orphans'), orphans, 'o')}
          {face(t('scan.missing'), missing, 'm')}
          <div className={styles.scanSectionHead}>{t('scan.trash')}（{trash.length}）</div>
          {trash.length === 0
            ? <div className={styles.formHint}>{t('scan.empty')}</div>
            : trash.map((row, index) => (
              <div key={`t-${index}`} className={styles.scanRow}>
                <Tag tone="quiet">.trash</Tag>
                <span>{row.deletedAt}</span>
              </div>
            ))}
        </>
      ) : null}
    </Modal>
  )
}
