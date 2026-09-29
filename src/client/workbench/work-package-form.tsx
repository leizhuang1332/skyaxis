/**
 * Work-package create/edit modal form (the requirement-form pattern:
 * submit-time validation with an inline field error, busy-gated submit).
 * The call site keys this component by editing target, so state seeds from
 * the target and resets across close/reopen cycles.
 *
 * Depends-on and covers ride checkbox lists over the live siblings /
 * criteria — the only sources of legal references (the host rejects
 * anything else with 400; the form makes illegal input unconstructible).
 */
import { useState, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchCriterion, WorkbenchWorkPackage } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import styles from './view.module.css'

export interface WorkPackageFormInput {
  readonly id?: string
  readonly title: string
  readonly boundary: string
  readonly dependsOn: readonly string[]
  readonly parallel?: boolean
  readonly covers: readonly string[]
}

export function WorkPackageFormModal(props: {
  t: WorkbenchT
  editing: 'create' | WorkbenchWorkPackage
  siblings: readonly WorkbenchWorkPackage[]
  criteria: readonly WorkbenchCriterion[]
  busy: boolean
  onCancel: () => void
  onSubmit: (input: WorkPackageFormInput) => Promise<boolean>
}): ReactNode {
  const { t, editing, siblings, criteria } = props
  const isEdit = editing !== 'create'
  const options = isEdit ? siblings.filter((candidate) => candidate.id !== editing.id) : siblings
  const [title, setTitle] = useState(isEdit ? editing.title : '')
  const [boundary, setBoundary] = useState(isEdit ? editing.boundary : '')
  const [dependsOn, setDependsOn] = useState<readonly string[]>(isEdit ? editing.dependsOn : [])
  const [covers, setCovers] = useState<readonly string[]>(isEdit ? editing.covers : [])
  const [parallel, setParallel] = useState<boolean>(isEdit ? (editing.parallel ?? false) : false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const toggle = (list: readonly string[], id: string): readonly string[] =>
    list.includes(id) ? list.filter((candidate) => candidate !== id) : [...list, id]

  const submit = (): void => {
    if (title.trim().length === 0) {
      setFieldError(t('wp.titleLabel'))
      return
    }
    setSubmitting(true)
    void props.onSubmit({
      ...(isEdit ? { id: editing.id } : {}),
      title: title.trim(),
      boundary,
      dependsOn,
      ...(parallel ? { parallel: true } : {}),
      covers,
    }).then((ok) => {
      setSubmitting(false)
      if (ok) setFieldError(null)
    })
  }

  return (
    <Modal
      open
      onClose={() => { props.onCancel() }}
      title={isEdit ? `${t('wp.editTitle')} · ${editing.id}` : t('wp.addTitle')}
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
          <span>{t('wp.titleLabel')}</span>
          <input value={title} maxLength={64} onChange={(event) => { setTitle(event.target.value); setFieldError(null) }} />
        </label>
        <label className={styles.formField}>
          <span>{t('wp.boundaryLabel')}</span>
          <textarea rows={3} value={boundary} maxLength={2000} onChange={(event) => { setBoundary(event.target.value) }} />
        </label>
        <div className={styles.formField}>
          <span>{t('wp.dependsLabel')}</span>
          {options.length === 0 ? <div className={styles.formHint}>{t('wp.noneMark')}</div> : (
            <div className={styles.checkList}>
              {options.map((candidate) => (
                <label key={candidate.id} className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={dependsOn.includes(candidate.id)}
                    onChange={() => { setDependsOn(toggle(dependsOn, candidate.id)) }}
                  />
                  <span>{candidate.id}　{candidate.title}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className={styles.formField}>
          <span>{t('wp.coversLabel')}</span>
          {criteria.length === 0 ? <div className={styles.formHint}>{t('wp.noneMark')}</div> : (
            <div className={styles.checkList}>
              {criteria.map((criterion) => (
                <label key={criterion.id} className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={covers.includes(criterion.id)}
                    onChange={() => { setCovers(toggle(covers, criterion.id)) }}
                  />
                  <span>{criterion.id}　{criterion.text}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={parallel} onChange={() => { setParallel(!parallel) }} />
          <span>{t('wp.parallelLabel')}</span>
        </label>
        {fieldError !== null ? <div className={styles.fieldError}>{fieldError}</div> : null}
      </div>
    </Modal>
  )
}
