/**
 * S1 findings section (extracted from view.tsx in the second knife): the
 * findings list + the dashed add card / inline form.
 *
 * Rendered whenever the understand stage is viewed, INCLUDING the
 * record-null first-use state — saveFinding is the record-MINTING entry
 * (the host creates the ledger row on the first action), so the empty state
 * must offer it, or a fresh requirement could never enter the workbench.
 * Keyed by requirementId at the render site: form drafts never cross a
 * requirement switch.
 */
import { useState, type ReactNode } from 'react'
import { WORKBENCH_INLINE_MAX_CHARS } from '../../workbench-shared/protocol.js'
import type { SeedMissingReason } from '../../workbench-shared/protocol.js'
import { SEED_MISS_KEY, type WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import styles from './view.module.css'

const FINDING_CATEGORIES = ['feasibility', 'conflict', 'compatibility', 'risk', 'capacity', 'other'] as const
const FINDING_SEVERITIES = ['high', 'medium', 'low'] as const

export function FindingsSection(props: {
  t: WorkbenchT
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  requirementId: string
  /** S1 entry: open the analysis SOW modal (view-owned instance). */
  onOpenSow?: () => void
  /** 回传轮: manual re-arm of the one-shot seed attempt (the waiting hint's retry button). */
  onRetrySeed?: () => void
  /** 回传轮: the last seed attempt's zero-write reason (disclosed under the waiting hint). */
  seedMiss?: SeedMissingReason
  /** 回传轮: the no-declare-block miss's scan fingerprint (raw, language-neutral). */
  seedScan?: string
}): ReactNode {
  const { t, slot, controller, requirementId } = props
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [category, setCategory] = useState<(typeof FINDING_CATEGORIES)[number]>('other')
  const [severity, setSeverity] = useState<(typeof FINDING_SEVERITIES)[number]>('medium')
  const findings = slot.record?.findings ?? []
  // 回传轮: pending analysis proposals — dashed rows awaiting the user's
  // ruling; never counted by badges/stale (they are not findings[] yet).
  const analysis = slot.record?.analysis

  const submit = (): void => {
    if (title.trim().length === 0) return
    void controller.saveFinding(requirementId, {
      category, severity, title: title.trim(), detail, status: 'open',
    }).then((ok) => {
      if (ok) {
        setFormOpen(false)
        setTitle('')
        setDetail('')
      }
    })
  }

  return (
    <div className={styles.findingSection}>
      {props.onOpenSow !== undefined ? (
        <div className={styles.sowEntryRow}>
          <button type="button" className={styles.ghostButton} onClick={() => { props.onOpenSow?.() }}>{t('sow.analysisButton')}</button>
        </div>
      ) : null}
      {analysis !== undefined && (analysis.findings.length > 0 || analysis.seed === undefined) ? (
        <div className={styles.proposalGroup}>
          <div className={styles.sectionTitle}>{t('proposal.findingsTitle')}</div>
          {analysis.findings.length === 0 && analysis.seed === undefined ? (
            <div className={styles.formHint}>
              {t('proposal.waitingHint')}
              {props.onRetrySeed !== undefined ? (
                <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={props.onRetrySeed}>{t('proposal.retry')}</button>
              ) : null}
            </div>
          ) : null}
          {props.seedMiss !== undefined ? (
            <div className={styles.fieldError}>{t(SEED_MISS_KEY[props.seedMiss]).replaceAll('{n}', '?')}</div>
          ) : null}
          {props.seedScan !== undefined ? (
            <div className={styles.findingRowMeta}>{t('proposal.scanPrefix')}{props.seedScan}</div>
          ) : null}
          {analysis.findings.map((row) => (
            <div key={row.id} className={styles.proposalRow}>
              <div className={styles.proposalRowMain}>
                <div className={styles.proposalRowTitle}>[{t(`finding.category.${row.category}`)}·{t(`finding.severity.${row.severity}`)}] {row.title}</div>
                {row.detail !== undefined && row.detail.length > 0 ? <div className={styles.proposalRowDetail}>{row.detail}</div> : null}
                <div className={styles.findingRowMeta}>{t('proposal.sourcePrefix').replaceAll('{id}', (analysis.seed?.sessionId ?? analysis.session.sessionId).slice(0, 8))}</div>
              </div>
              <div className={styles.proposalRowActions}>
                <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { void controller.adoptFindingProposal(requirementId, row.id) }}>{t('proposal.adopt')}</button>
                <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { void controller.dismissFindingProposal(requirementId, row.id) }}>{t('proposal.dismiss')}</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {findings.map((finding) => (
        <div key={finding.id} className={finding.status === 'open' ? styles.findingRow : `${styles.findingRow} ${styles.findingRowMuted}`}>
          <div className={styles.findingRowTitle}>{finding.title}</div>
          <div className={styles.findingRowMeta}>{t(`finding.category.${finding.category}`)} · {t(`finding.severity.${finding.severity}`)}</div>
        </div>
      ))}
      {formOpen ? (
        <div className={styles.findingForm}>
          <div className={styles.findingFormTitle}>{t('finding.addTitle')}</div>
          <label className={styles.findingField}>
            <span>{t('finding.titleLabel')}</span>
            {/* maxLength counts UTF-16 code units — the same unit as the
                host zod caps, so an over-cap input is unconstructible here
                instead of surfacing as a misleading 400 banner. */}
            <input value={title} maxLength={64} onChange={(event) => { setTitle(event.target.value) }} />
          </label>
          <label className={styles.findingField}>
            <span>{t('finding.detailLabel')}</span>
            <textarea rows={3} value={detail} maxLength={WORKBENCH_INLINE_MAX_CHARS} onChange={(event) => { setDetail(event.target.value) }} />
          </label>
          <div className={styles.findingFieldRow}>
            <label className={styles.findingField}>
              <span>{t('finding.categoryLabel')}</span>
              <select value={category} onChange={(event) => { setCategory(event.target.value as (typeof FINDING_CATEGORIES)[number]) }}>
                {FINDING_CATEGORIES.map((value) => <option key={value} value={value}>{t(`finding.category.${value}`)}</option>)}
              </select>
            </label>
            <label className={styles.findingField}>
              <span>{t('finding.severityLabel')}</span>
              <select value={severity} onChange={(event) => { setSeverity(event.target.value as (typeof FINDING_SEVERITIES)[number]) }}>
                {FINDING_SEVERITIES.map((value) => <option key={value} value={value}>{t(`finding.severity.${value}`)}</option>)}
              </select>
            </label>
          </div>
          <div className={styles.findingFormActions}>
            <button type="button" className={styles.ghostButton} onClick={() => { setFormOpen(false) }}>{t('finding.cancel')}</button>
            <button type="button" className={styles.primaryButton} disabled={title.trim().length === 0 || slot.busy} onClick={submit}>{t('finding.submit')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className={styles.addCard} onClick={() => { setFormOpen(true) }}>{t('finding.add')}</button>
      )}
    </div>
  )
}
