/**
 * S1 acceptance-criteria section: criteria rows with coverage chips (the
 * coveredBy projection the host maintains from work-package covers), the
 * hollow warning for uncovered rows, an add/edit modal form (the
 * requirement-form pattern: submit-time validation, inline field error),
 * and a remove confirmation. Read-only while the split is approved —
 * criteria live under hard gate ① like the list itself (the approved
 * contract is "list × coverage", both sides).
 */
import { useState, type ReactNode } from 'react'
import { Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchCriterion } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import { RowMenu } from './row-menu.js'
import styles from './view.module.css'

type Editing = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; criterion: WorkbenchCriterion }

export function CriteriaSection(props: {
  t: WorkbenchT
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  requirementId: string
}): ReactNode {
  const { t, slot, controller, requirementId } = props
  const criteria = slot.record?.criteria ?? []
  const locked = (slot.record?.splitApprovedAt ?? undefined) !== undefined
  const [editing, setEditing] = useState<Editing>({ kind: 'closed' })
  const [pendingRemove, setPendingRemove] = useState<WorkbenchCriterion | null>(null)

  return (
    <div className={styles.criteriaSection}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{t('criteria.sectionTitle')}</div>
        {locked ? null : (
          <button type="button" className={styles.ghostButton} onClick={() => { setEditing({ kind: 'create' }) }}>{t('criteria.add')}</button>
        )}
      </div>
      {criteria.map((criterion) => (
        <div key={criterion.id} className={criterion.coveredBy.length === 0 ? `${styles.criterionRow} ${styles.criterionRowHole}` : styles.criterionRow}>
          <div className={styles.criterionRowMain}>
            <div className={styles.criterionRowTitle}>{criterion.id}　{criterion.text}</div>
            <div className={styles.coverChips}>
              {criterion.coveredBy.length > 0
                ? criterion.coveredBy.map((workPackageId) => <span key={workPackageId} className={styles.coverChip}>← {workPackageId}</span>)
                : <span className={`${styles.coverChip} ${styles.coverChipHole}`}>{t('criteria.uncovered')}</span>}
            </div>
          </div>
          {locked ? null : (
            <RowMenu
              menuLabel={criterion.id}
              items={[
                { id: 'edit', label: t('menu.edit') },
                { id: 'remove', label: t('menu.remove'), danger: true },
              ]}
              onSelect={(id) => {
                if (id === 'edit') setEditing({ kind: 'edit', criterion })
                if (id === 'remove') setPendingRemove(criterion)
              }}
            />
          )}
        </div>
      ))}
      <CriterionFormModal
        key={editing.kind === 'edit' ? editing.criterion.id : editing.kind}
        t={t}
        editing={editing}
        busy={slot.busy}
        onCancel={() => { setEditing({ kind: 'closed' }) }}
        onSubmit={async (input) => {
          const ok = await controller.saveCriterion(requirementId, input)
          if (ok) setEditing({ kind: 'closed' })
          return ok
        }}
      />
      <Modal
        open={pendingRemove !== null}
        onClose={() => { setPendingRemove(null) }}
        title={t('criteria.removeTitle')}
        closeLabel={t('action.cancel')}
        description={pendingRemove !== null ? `${pendingRemove.id} ${pendingRemove.text}` : undefined}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setPendingRemove(null) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={slot.busy}
              onClick={() => {
                const target = pendingRemove
                setPendingRemove(null)
                if (target !== undefined && target !== null) void controller.removeCriterion(requirementId, target.id)
              }}
            >
              {t('action.confirm')}
            </button>
          </>
        }
      >
        {t('criteria.removeDescription')}
      </Modal>
    </div>
  )
}

function CriterionFormModal(props: {
  t: WorkbenchT
  editing: Editing
  busy: boolean
  onCancel: () => void
  onSubmit: (input: { id?: string; text: string; sourceSection?: string }) => Promise<boolean>
}): ReactNode {
  const { t, editing } = props
  const open = editing.kind !== 'closed'
  // The CALL SITE keys this component by editing target, so a fresh mount
  // seeds the form from the target and a close/reopen cycle starts clean.
  const [text, setText] = useState(editing.kind === 'edit' ? editing.criterion.text : '')
  const [source, setSource] = useState(editing.kind === 'edit' ? (editing.criterion.sourceSection ?? '') : '')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = (): void => {
    if (text.trim().length === 0) {
      setFieldError(t('criteria.textLabel'))
      return
    }
    setSubmitting(true)
    void props.onSubmit({
      ...(editing.kind === 'edit' ? { id: editing.criterion.id } : {}),
      text: text.trim(),
      ...(source.trim().length > 0 ? { sourceSection: source.trim() } : {}),
    }).then((ok) => {
      setSubmitting(false)
      if (ok) {
        setText('')
        setSource('')
        setFieldError(null)
      }
    })
  }

  if (!open) return null
  return (
    <Modal
      open
      onClose={() => { props.onCancel() }}
      title={editing.kind === 'edit' ? t('criteria.editTitle') : t('criteria.addTitle')}
      closeLabel={t('action.cancel')}
      footer={
        <>
          <button type="button" className={styles.ghostButton} onClick={() => { props.onCancel() }}>{t('action.cancel')}</button>
          <button type="button" className={styles.primaryButton} disabled={props.busy || submitting} onClick={submit}>{t('action.save')}</button>
        </>
      }
    >
      <div className={styles.modalForm}>
        <label className={styles.formField}>
          <span>{t('criteria.textLabel')}</span>
          <textarea
            rows={2}
            value={text}
            maxLength={2000}
            onChange={(event) => { setText(event.target.value); setFieldError(null) }}
          />
        </label>
        <label className={styles.formField}>
          <span>{t('criteria.sourceLabel')}</span>
          <input value={source} maxLength={256} onChange={(event) => { setSource(event.target.value) }} />
        </label>
        {fieldError !== null ? <div className={styles.fieldError}>{fieldError}</div> : null}
      </div>
    </Modal>
  )
}
