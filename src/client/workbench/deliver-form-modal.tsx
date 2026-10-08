/**
 * S5 register/edit release-item modal (P3a, the knowledge-form-modal
 * file-lane precedent): five fields per research 0006 §4.3「上线项登记」+
 * the note field (§7.3 export's 备注 column). The content textarea is
 * monospace (.wpDraftTextarea) — spec calls for 等宽 explicitly; the cap is
 * the shared inline single-source. envs is a comma-separated input (the
 * mockup's own display form is `env prod,pre`; no array-input precedent
 * exists in the repo) parsed to string[] on submit, full-width commas
 * included (zh IME).
 *
 * Field semantics mirror the host edit contract: the six user-editable
 * fields are full-replace (an empty note /「无」work-package actually clears
 * — carry-over would make both unundoable), so the form always submits the
 * complete value set.
 */
import { useState, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { WORKBENCH_INLINE_MAX_CHARS } from '../../workbench-shared/protocol.js'
import type { ReleaseItem, WorkbenchWorkPackage } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import styles from './view.module.css'

export interface ReleaseItemFormInput {
  readonly type: ReleaseItem['type']
  readonly title: string
  readonly content: string
  readonly envs: readonly string[]
  readonly workPackageId?: string
  readonly note?: string
}

const RELEASE_TYPES: readonly ReleaseItem['type'][] = ['sql', 'config', 'flag', 'mq', 'other']

const TYPE_GROUP_KEY: Record<ReleaseItem['type'], Parameters<WorkbenchT>[0]> = {
  sql: 'release.group.sql',
  config: 'release.group.config',
  flag: 'release.group.flag',
  mq: 'release.group.mq',
  other: 'release.group.other',
}

/** Split a comma-separated env input into trimmed parts (zh full-width commas included). */
export function parseEnvs(raw: string): readonly string[] {
  return raw.split(/[,，]/).map((part) => part.trim()).filter((part) => part.length > 0)
}

export function ReleaseItemFormModal(props: {
  t: WorkbenchT
  /** 'new' = register; an item = edit (seeded, pending-only by host contract). */
  target: 'new' | ReleaseItem
  workPackages: readonly WorkbenchWorkPackage[]
  busy: boolean
  onCancel: () => void
  onSubmit: (input: ReleaseItemFormInput) => void
}): ReactNode {
  const { t, target } = props
  const [type, setType] = useState<ReleaseItem['type']>(target === 'new' ? 'sql' : target.type)
  const [title, setTitle] = useState(target === 'new' ? '' : target.title)
  const [content, setContent] = useState(target === 'new' ? '' : target.content)
  const [envsRaw, setEnvsRaw] = useState(target === 'new' ? '' : target.envs.join(','))
  const [workPackageId, setWorkPackageId] = useState<string>(target === 'new' ? '' : target.workPackageId ?? '')
  const [note, setNote] = useState(target === 'new' ? '' : target.note ?? '')
  const [fieldError, setFieldError] = useState<string | null>(null)

  const submit = (): void => {
    const trimmedTitle = title.trim()
    if (trimmedTitle.length === 0) {
      setFieldError(t('release.titleRequired'))
      return
    }
    if (content.trim().length === 0) {
      setFieldError(t('release.contentRequired'))
      return
    }
    const envs = parseEnvs(envsRaw)
    if (envs.some((env) => env.length > 64)) {
      setFieldError(t('release.envsInvalid'))
      return
    }
    const trimmedNote = note.trim()
    props.onSubmit({
      type,
      title: trimmedTitle,
      content,
      envs,
      ...(workPackageId !== '' ? { workPackageId } : {}),
      ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}),
    })
  }

  return (
    <Modal
      open
      onClose={() => { props.onCancel() }}
      className={styles.knowledgeDialog}
      title={t(target === 'new' ? 'release.formTitleNew' : 'release.formTitleEdit')}
      closeLabel={t('action.cancel')}
      footer={
        <>
          <button type="button" className={styles.ghostButton} onClick={() => { props.onCancel() }}>{t('action.cancel')}</button>
          <button type="button" className={styles.primaryButton} disabled={props.busy} onClick={submit}>{t('action.save')}</button>
        </>
      }
    >
      <div className={styles.modalForm}>
        <div className={styles.formField}>
          <span>{t('release.typeLabel')}</span>
          {RELEASE_TYPES.map((releaseType) => (
            <label key={releaseType} className={styles.checkRow}>
              <input
                type="radio"
                name="release-item-type"
                checked={type === releaseType}
                onChange={() => { setType(releaseType); setFieldError(null) }}
              />
              <span>{t(TYPE_GROUP_KEY[releaseType])}</span>
            </label>
          ))}
        </div>
        <label className={styles.formField}>
          <span>{t('release.titleLabel')}</span>
          <input
            value={title}
            maxLength={64}
            onChange={(event) => { setTitle(event.target.value); setFieldError(null) }}
          />
        </label>
        <label className={styles.formField}>
          <span>{t('release.contentLabel')}</span>
          <textarea
            rows={6}
            className={styles.wpDraftTextarea}
            value={content}
            maxLength={WORKBENCH_INLINE_MAX_CHARS}
            onChange={(event) => { setContent(event.target.value); setFieldError(null) }}
          />
        </label>
        <label className={styles.formField}>
          <span>{t('release.envsLabel')}</span>
          <input
            value={envsRaw}
            maxLength={512}
            placeholder="prod,pre"
            onChange={(event) => { setEnvsRaw(event.target.value); setFieldError(null) }}
          />
        </label>
        <label className={styles.formField}>
          <span>{t('release.workPackageLabel')}</span>
          <select
            value={workPackageId}
            onChange={(event) => { setWorkPackageId(event.target.value) }}
          >
            <option value="">{t('release.workPackageNone')}</option>
            {props.workPackages.map((workPackage) => (
              <option key={workPackage.id} value={workPackage.id}>{workPackage.id}　{workPackage.title}</option>
            ))}
          </select>
        </label>
        <label className={styles.formField}>
          <span>{t('release.noteLabel')}</span>
          <textarea
            rows={2}
            value={note}
            maxLength={2000}
            onChange={(event) => { setNote(event.target.value) }}
          />
        </label>
        {fieldError !== null ? <div className={styles.fieldError}>{fieldError}</div> : null}
      </div>
    </Modal>
  )
}
