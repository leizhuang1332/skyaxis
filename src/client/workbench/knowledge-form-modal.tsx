/**
 * S6 knowledge create/edit modal (the manual-entry path and the active-row
 * RowMenu edit share it): `editing === null` creates, non-null seeds every
 * field and its id rides the payload (full-row replace server-side).
 *
 * The modal OWNS the scope join keys: a requirement-scope payload carries
 * `requirementId` (from props), a workspace-scope payload carries `path` —
 * the host requires either, the caller never passes them. P5a: the workspace
 * scope and the path trigger join (the same deferred faces as the activate
 * modal); editing a workspace row seeds its path key and glob.
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
  readonly scope: 'global' | 'workspace' | 'requirement'
  readonly type: 'business' | 'convention'
  readonly title: string
  readonly content: string
  readonly requirementId?: string
  readonly path?: string
  readonly trigger: { readonly mode: 'always' | 'keyword' | 'manual' | 'path'; readonly value?: string }
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
  const [scope, setScope] = useState<'global' | 'workspace' | 'requirement'>(editing?.scope === 'global' ? 'global' : editing?.scope === 'workspace' ? 'workspace' : 'requirement')
  const [type, setType] = useState<'business' | 'convention'>(editing?.type ?? 'business')
  const editingMode = editing?.trigger.mode
  const [mode, setMode] = useState<'always' | 'keyword' | 'manual' | 'path'>(
    editingMode === 'keyword' || editingMode === 'manual' || editingMode === 'path' ? editingMode : 'always')
  const [keyword, setKeyword] = useState(editingMode === 'keyword' ? (editing?.trigger.value ?? '') : '')
  const [pathGlob, setPathGlob] = useState(editingMode === 'path' ? (editing?.trigger.value ?? '') : '')
  const [workspacePath, setWorkspacePath] = useState(editing?.scope === 'workspace' ? (editing.path ?? '') : '')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const keywordMissing = mode === 'keyword' && keyword.trim().length === 0
  const globMissing = mode === 'path' && pathGlob.trim().length === 0
  const pathMissing = scope === 'workspace' && workspacePath.trim().length === 0

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
      ...(scope === 'workspace' ? { path: workspacePath.trim() } : {}),
      trigger: mode === 'keyword' || mode === 'path'
        ? { mode, value: (mode === 'keyword' ? keyword : pathGlob).trim() }
        : { mode },
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
          <button type="button" className={styles.primaryButton} disabled={props.busy || keywordMissing || globMissing || pathMissing} onClick={submit}>{t('action.save')}</button>
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
          <RadioRow name="knowledge-form-scope" checked={scope === 'workspace'} label={t('knowledge.scopeWorkspace')} onSelect={() => { setScope('workspace') }} />
          <RadioRow name="knowledge-form-scope" checked={scope === 'requirement'} label={t('knowledge.scopeRequirement')} onSelect={() => { setScope('requirement') }} />
        </div>
        {scope === 'workspace' ? (
          <label className={styles.formField}>
            <span>{t('knowledge.pathLabel')}</span>
            <input value={workspacePath} maxLength={4096} onChange={(event) => { setWorkspacePath(event.target.value) }} />
          </label>
        ) : null}
        <div className={styles.formField}>
          <span>{t('knowledge.typeLabel')}</span>
          <RadioRow name="knowledge-form-type" checked={type === 'business'} label={t('knowledge.typeBusiness')} onSelect={() => { setType('business') }} />
          <RadioRow name="knowledge-form-type" checked={type === 'convention'} label={t('knowledge.typeConvention')} onSelect={() => { setType('convention') }} />
        </div>
        <div className={styles.formField}>
          <span>{t('knowledge.triggerLabel')}</span>
          <RadioRow name="knowledge-form-trigger" checked={mode === 'always'} label={t('knowledge.triggerAlways')} onSelect={() => { setMode('always') }} />
          <RadioRow name="knowledge-form-trigger" checked={mode === 'keyword'} label={t('knowledge.triggerKeyword')} onSelect={() => { setMode('keyword') }} />
          <RadioRow name="knowledge-form-trigger" checked={mode === 'path'} label={t('knowledge.triggerPath')} onSelect={() => { setMode('path') }} />
          <RadioRow name="knowledge-form-trigger" checked={mode === 'manual'} label={t('knowledge.triggerManual')} onSelect={() => { setMode('manual') }} />
        </div>
        {mode === 'keyword' ? (
          <label className={styles.formField}>
            <span>{t('knowledge.keywordLabel')}</span>
            <input value={keyword} maxLength={64} onChange={(event) => { setKeyword(event.target.value) }} />
          </label>
        ) : null}
        {mode === 'path' ? (
          <label className={styles.formField}>
            <span>{t('knowledge.globLabel')}</span>
            <input value={pathGlob} maxLength={256} placeholder="src/**" onChange={(event) => { setPathGlob(event.target.value) }} />
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
