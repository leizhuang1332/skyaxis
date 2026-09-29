/**
 * S6 activate modal: promotes a pending knowledge candidate into an active
 * knowledge row. TWO scopes only — global | requirement (the user-ratified
 * P2 ruling; workspace joins path triggering in P5, so there is no third
 * radio). Type preselects the candidate's own type; the keyword trigger
 * unfolds a required value input that disables submit while empty.
 *
 * The CALL SITE keys this component by candidate, so a fresh mount seeds the
 * radios (type from the candidate; scope/trigger at their least-surprise
 * defaults) and a close/reopen cycle starts clean — the criteria-form
 * pattern. The payload is the narrow P2 face of the wire's wider knowledge
 * shape (no workspace/path: those faces stay P5) and is normalized here —
 * trigger.value exists only for the keyword mode.
 */
import { useState, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { KnowledgeCandidate } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import styles from './view.module.css'

export interface KnowledgeActivateInput {
  readonly scope: 'global' | 'requirement'
  readonly type: 'business' | 'convention'
  readonly trigger: { readonly mode: 'always' | 'keyword' | 'manual'; readonly value?: string }
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
  const [scope, setScope] = useState<'global' | 'requirement'>('requirement')
  const [type, setType] = useState<'business' | 'convention'>(candidate?.type ?? 'business')
  const [mode, setMode] = useState<'always' | 'keyword' | 'manual'>('always')
  const [keyword, setKeyword] = useState('')
  const keywordMissing = mode === 'keyword' && keyword.trim().length === 0

  const submit = (): void => {
    props.onSubmit({
      scope,
      type,
      trigger: mode === 'keyword' ? { mode, value: keyword.trim() } : { mode },
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
          <button type="button" className={styles.primaryButton} disabled={props.busy || keywordMissing} onClick={submit}>{t('knowledge.activate')}</button>
        </>
      }
    >
      <div className={styles.modalForm}>
        <div className={styles.formField}>
          <span>{t('knowledge.scopeLabel')}</span>
          <RadioRow name="knowledge-activate-scope" checked={scope === 'global'} label={t('knowledge.scopeGlobal')} onSelect={() => { setScope('global') }} />
          <RadioRow name="knowledge-activate-scope" checked={scope === 'requirement'} label={t('knowledge.scopeRequirement')} onSelect={() => { setScope('requirement') }} />
        </div>
        <div className={styles.formField}>
          <span>{t('knowledge.typeLabel')}</span>
          <RadioRow name="knowledge-activate-type" checked={type === 'business'} label={t('knowledge.typeBusiness')} onSelect={() => { setType('business') }} />
          <RadioRow name="knowledge-activate-type" checked={type === 'convention'} label={t('knowledge.typeConvention')} onSelect={() => { setType('convention') }} />
        </div>
        <div className={styles.formField}>
          <span>{t('knowledge.triggerLabel')}</span>
          <RadioRow name="knowledge-activate-trigger" checked={mode === 'always'} label={t('knowledge.triggerAlways')} onSelect={() => { setMode('always') }} />
          <RadioRow name="knowledge-activate-trigger" checked={mode === 'keyword'} label={t('knowledge.triggerKeyword')} onSelect={() => { setMode('keyword') }} />
          <RadioRow name="knowledge-activate-trigger" checked={mode === 'manual'} label={t('knowledge.triggerManual')} onSelect={() => { setMode('manual') }} />
        </div>
        {mode === 'keyword' ? (
          <label className={styles.formField}>
            <span>{t('knowledge.keywordLabel')}</span>
            <input value={keyword} maxLength={64} onChange={(event) => { setKeyword(event.target.value) }} />
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
