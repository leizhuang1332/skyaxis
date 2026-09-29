/**
 * S6 knowledge create/edit modal (the manual-entry path and the active-row
 * RowMenu edit share it): `editing === null` creates, non-null seeds every
 * field and its id rides the payload (full-row replace server-side).
 *
 * The modal OWNS the requirement-scope join: a requirement-scope payload
 * carries `requirementId` (from props) because the host requires it — the
 * caller never passes it. Path trigger / workspace scope stay P5 (the same
 * deferred face as the activate modal), so the radios offer two scopes and
 * three trigger modes; the payload type keeps the wire's wide trigger union.
 *
 * The CALL SITE keys this component by editing target (criteria-form
 * pattern): a fresh mount seeds from the target and a close/reopen cycle
 * starts clean.
 */
import { useState, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { WORKBENCH_INLINE_MAX_CHARS, type WorkbenchKnowledgeRecord } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import styles from './view.module.css'

export interface KnowledgeFormInput {
  readonly id?: string
  readonly scope: 'global' | 'requirement'
  readonly type: 'business' | 'convention'
  readonly title: string
  readonly content: string
  readonly requirementId?: string
  readonly trigger: { readonly mode: 'always' | 'keyword' | 'manual'; readonly value?: string }
}

export function KnowledgeFormModal(props: {
  t: WorkbenchT
  open: boolean
  editing: WorkbenchKnowledgeRecord | null
  requirementId: string
  busy: boolean
  onCancel: () => void
  onSubmit: (knowledge: KnowledgeFormInput) => void
}): ReactNode {
  const { t, open, editing } = props
  const [title, setTitle] = useState(editing?.title ?? '')
  const [content, setContent] = useState(editing?.content ?? '')
  // Anything but 'global' seeds requirement: the P2 client view never holds
  // workspace rows, so this is a defensive default, not a silent downgrade.
  const [scope, setScope] = useState<'global' | 'requirement'>(editing?.scope === 'global' ? 'global' : 'requirement')
  const [type, setType] = useState<'business' | 'convention'>(editing?.type ?? 'business')
  const [mode, setMode] = useState<'always' | 'keyword' | 'manual'>(editing?.trigger.mode === 'keyword' || editing?.trigger.mode === 'manual' ? editing.trigger.mode : 'always')
  const [keyword, setKeyword] = useState(editing?.trigger.mode === 'keyword' ? (editing.trigger.value ?? '') : '')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const keywordMissing = mode === 'keyword' && keyword.trim().length === 0

  const submit = (): void => {
    if (title.trim().length === 0) {
      setFieldError(t('knowledge.titleLabel'))
      return
    }
    props.onSubmit({
      ...(editing !== null ? { id: editing.id } : {}),
      scope,
      type,
      title: title.trim(),
      content,
      ...(scope === 'requirement' ? { requirementId: props.requirementId } : {}),
      trigger: mode === 'keyword' ? { mode, value: keyword.trim() } : { mode },
    })
  }

  if (!open) return null
  return (
    <Modal
      open
      onClose={() => { props.onCancel() }}
      className={styles.knowledgeDialog}
      title={editing !== null ? t('knowledge.formTitleEdit') : t('knowledge.formTitleNew')}
      closeLabel={t('action.cancel')}
      footer={
        <>
          <button type="button" className={styles.ghostButton} onClick={() => { props.onCancel() }}>{t('action.cancel')}</button>
          <button type="button" className={styles.primaryButton} disabled={props.busy || keywordMissing} onClick={submit}>{t('action.save')}</button>
        </>
      }
    >
      <div className={styles.modalForm}>
        <label className={styles.formField}>
          <span>{t('knowledge.titleLabel')}</span>
          <input value={title} maxLength={64} onChange={(event) => { setTitle(event.target.value); setFieldError(null) }} />
        </label>
        <label className={styles.formField}>
          <span>{t('knowledge.contentLabel')}</span>
          <textarea rows={5} value={content} maxLength={WORKBENCH_INLINE_MAX_CHARS} onChange={(event) => { setContent(event.target.value) }} />
        </label>
        <div className={styles.formField}>
          <span>{t('knowledge.scopeLabel')}</span>
          <RadioRow name="knowledge-form-scope" checked={scope === 'global'} label={t('knowledge.scopeGlobal')} onSelect={() => { setScope('global') }} />
          <RadioRow name="knowledge-form-scope" checked={scope === 'requirement'} label={t('knowledge.scopeRequirement')} onSelect={() => { setScope('requirement') }} />
        </div>
        <div className={styles.formField}>
          <span>{t('knowledge.typeLabel')}</span>
          <RadioRow name="knowledge-form-type" checked={type === 'business'} label={t('knowledge.typeBusiness')} onSelect={() => { setType('business') }} />
          <RadioRow name="knowledge-form-type" checked={type === 'convention'} label={t('knowledge.typeConvention')} onSelect={() => { setType('convention') }} />
        </div>
        <div className={styles.formField}>
          <span>{t('knowledge.triggerLabel')}</span>
          <RadioRow name="knowledge-form-trigger" checked={mode === 'always'} label={t('knowledge.triggerAlways')} onSelect={() => { setMode('always') }} />
          <RadioRow name="knowledge-form-trigger" checked={mode === 'keyword'} label={t('knowledge.triggerKeyword')} onSelect={() => { setMode('keyword') }} />
          <RadioRow name="knowledge-form-trigger" checked={mode === 'manual'} label={t('knowledge.triggerManual')} onSelect={() => { setMode('manual') }} />
        </div>
        {mode === 'keyword' ? (
          <label className={styles.formField}>
            <span>{t('knowledge.keywordLabel')}</span>
            <input value={keyword} maxLength={64} onChange={(event) => { setKeyword(event.target.value) }} />
          </label>
        ) : null}
        {fieldError !== null ? <div className={styles.fieldError}>{fieldError}</div> : null}
      </div>
    </Modal>
  )
}

function RadioRow(props: { name: string; checked: boolean; label: string; onSelect: () => void }): ReactNode {
  return (
    <label className={styles.checkRow}>
      <input type="radio" name={props.name} checked={props.checked} onChange={props.onSelect} />
      <span>{props.label}</span>
    </label>
  )
}
