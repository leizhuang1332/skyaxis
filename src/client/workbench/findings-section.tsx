/**
 * S1 findings ledger (布局重塑轮 slim-down): the formal findings[] rows +
 * the dashed add card / inline form. The SOW entry and the pending
 * proposal group moved out — the entry rides the triptych bar / the
 * record-null guide row, the proposals live in proposals-triptych.tsx.
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
import type { WorkbenchT } from './dictionary.js'
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
}): ReactNode {
  const { t, slot, controller, requirementId } = props
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [category, setCategory] = useState<(typeof FINDING_CATEGORIES)[number]>('other')
  const [severity, setSeverity] = useState<(typeof FINDING_SEVERITIES)[number]>('medium')
  const findings = slot.record?.findings ?? []

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
      {/* 布局重塑轮: the ledger pair is two titled columns now — the head
          mirrors criteria.sectionTitle (the old "no title head" asymmetry
          existed only to right-align the retired sowEntryRow). The
          open-count signal stays on the rail badge (one home per number). */}
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{t('finding.sectionTitle')}</div>
      </div>
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
