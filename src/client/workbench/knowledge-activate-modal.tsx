/**
 * S6 activate modal: promotes a pending knowledge candidate into an active
 * knowledge row. THREE scopes since P5a — global | workspace | requirement
 * (the P2 two-scope ruling carried the explicit "workspace joins path
 * triggering in P5" rider; both faces land together). Type preselects the
 * candidate's own type; keyword and path triggers each unfold a required
 * value input that disables submit while empty (the keyword precedent);
 * the workspace scope unfolds a required path ownership key.
 *
 * The CALL SITE keys this component by candidate, so a fresh mount seeds the
 * radios (type from the candidate; scope/trigger at their least-surprise
 * defaults) and a close/reopen cycle starts clean — the criteria-form
 * pattern. The payload is the FULL P5a wire face: trigger.value exists only
 * for keyword/path (host-side normalization strips it otherwise), and the
 * workspace path key rides scope==='workspace' only.
 */
import { useState, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { KnowledgeCandidate } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import styles from './view.module.css'

export interface KnowledgeActivateInput {
  readonly scope: 'global' | 'workspace' | 'requirement'
  readonly type: 'business' | 'convention'
  readonly trigger: { readonly mode: 'always' | 'keyword' | 'manual' | 'path'; readonly value?: string }
  readonly path?: string
}

export function KnowledgeActivateModal(props: {
  t: WorkbenchT
  open: boolean
  candidate: KnowledgeCandidate | null
  busy: boolean
  onCancel: () => void
  onSubmit: (knowledge: KnowledgeActivateInput) => void
}): ReactNode {
  const { t, open, candidate } = props
  const [scope, setScope] = useState<'global' | 'workspace' | 'requirement'>('requirement')
  const [type, setType] = useState<'business' | 'convention'>(candidate?.type ?? 'business')
  const [mode, setMode] = useState<'always' | 'keyword' | 'manual' | 'path'>('always')
  const [keyword, setKeyword] = useState('')
  const [pathGlob, setPathGlob] = useState('')
  const [workspacePath, setWorkspacePath] = useState('')
  const keywordMissing = mode === 'keyword' && keyword.trim().length === 0
  const globMissing = mode === 'path' && pathGlob.trim().length === 0
  const pathMissing = scope === 'workspace' && workspacePath.trim().length === 0

  const submit = (): void => {
    props.onSubmit({
      scope,
      type,
      trigger: mode === 'keyword' || mode === 'path'
        ? { mode, value: (mode === 'keyword' ? keyword : pathGlob).trim() }
        : { mode },
      ...(scope === 'workspace' ? { path: workspacePath.trim() } : {}),
    })
  }

  if (!open) return null
  return (
    <Modal
      open
      onClose={() => { props.onCancel() }}
      className={styles.knowledgeDialog}
      title={t('knowledge.activateTitle')}
      closeLabel={t('action.cancel')}
      footer={
        <>
          <button type="button" className={styles.ghostButton} onClick={() => { props.onCancel() }}>{t('action.cancel')}</button>
          <button type="button" className={styles.primaryButton} disabled={props.busy || keywordMissing || globMissing || pathMissing} onClick={submit}>{t('knowledge.activate')}</button>
        </>
      }
    >
      <div className={styles.modalForm}>
        <div className={styles.formField}>
          <span>{t('knowledge.scopeLabel')}</span>
          <RadioRow name="knowledge-activate-scope" checked={scope === 'global'} label={t('knowledge.scopeGlobal')} onSelect={() => { setScope('global') }} />
          <RadioRow name="knowledge-activate-scope" checked={scope === 'workspace'} label={t('knowledge.scopeWorkspace')} onSelect={() => { setScope('workspace') }} />
          <RadioRow name="knowledge-activate-scope" checked={scope === 'requirement'} label={t('knowledge.scopeRequirement')} onSelect={() => { setScope('requirement') }} />
        </div>
        {scope === 'workspace' ? (
          <label className={styles.formField}>
            <span>{t('knowledge.pathLabel')}</span>
            <input value={workspacePath} maxLength={4096} onChange={(event) => { setWorkspacePath(event.target.value) }} />
          </label>
        ) : null}
        <div className={styles.formField}>
          <span>{t('knowledge.typeLabel')}</span>
          <RadioRow name="knowledge-activate-type" checked={type === 'business'} label={t('knowledge.typeBusiness')} onSelect={() => { setType('business') }} />
          <RadioRow name="knowledge-activate-type" checked={type === 'convention'} label={t('knowledge.typeConvention')} onSelect={() => { setType('convention') }} />
        </div>
        <div className={styles.formField}>
          <span>{t('knowledge.triggerLabel')}</span>
          <RadioRow name="knowledge-activate-trigger" checked={mode === 'always'} label={t('knowledge.triggerAlways')} onSelect={() => { setMode('always') }} />
          <RadioRow name="knowledge-activate-trigger" checked={mode === 'keyword'} label={t('knowledge.triggerKeyword')} onSelect={() => { setMode('keyword') }} />
          <RadioRow name="knowledge-activate-trigger" checked={mode === 'path'} label={t('knowledge.triggerPath')} onSelect={() => { setMode('path') }} />
          <RadioRow name="knowledge-activate-trigger" checked={mode === 'manual'} label={t('knowledge.triggerManual')} onSelect={() => { setMode('manual') }} />
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
