/**
 * Requirements add/edit form: Modal + host Input atom + a token-styled
 * textarea (the host ships no textarea primitive). The flow is deliberately
 * flat — local title-required validation, then save directly (the repos-pool
 * validation/gate machinery has no counterpart here).
 *
 * Form-internal state lives here on purpose — short-lived, no outside
 * readers (see store.ts).
 */
import { useState, type ReactNode } from 'react'
import { Button, IconPlusOutline16, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RequirementRecord, SaveRequestBody } from '../../requirements-shared/protocol.js'
import type { RequirementsController } from './controller.js'
import type { RequirementsT } from './dictionary.js'
import styles from './view.module.css'

type Editing = { kind: 'create' } | { kind: 'edit'; requirement: RequirementRecord }

type Phase = { kind: 'idle' } | { kind: 'submitting' }

export function RequirementForm(props: {
  t: RequirementsT
  editing: Editing
  revision: number
  controller: RequirementsController
}): ReactNode {
  const { t, editing, revision, controller } = props
  const [title, setTitle] = useState(editing.kind === 'edit' ? editing.requirement.title : '')
  const [description, setDescription] = useState(editing.kind === 'edit' ? editing.requirement.description : '')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [fieldError, setFieldError] = useState<string | null>(null)
  const busy = phase.kind === 'submitting'

  const doSave = async (): Promise<void> => {
    setPhase({ kind: 'submitting' })
    const body: SaveRequestBody = {
      expectedRevision: revision,
      requirement: {
        ...(editing.kind === 'edit' ? { id: editing.requirement.id } : {}),
        title: title.trim(),
        description: description.trim(),
      },
    }
    await controller.save(body)
    // Controller closes the form on success; failures surface through the
    // page banner and leave the form mounted — return to idle so the user
    // can retry.
    setPhase({ kind: 'idle' })
  }

  const handleSubmit = async (): Promise<void> => {
    if (title.trim().length === 0) {
      setFieldError(t('error.titleRequired'))
      return
    }
    setFieldError(null)
    await doSave()
  }

  return (
    <Modal
      open
      onClose={() => controller.closeForm()}
      title={editing.kind === 'edit' ? t('form.titleEdit') : t('form.titleCreate')}
      closeLabel={t('form.closeLabel')}
      footer={(
        <>
          <Button variant="ghost" onClick={() => controller.closeForm()}>{t('form.cancel')}</Button>
          <Button
            variant="primary"
            icon={<IconPlusOutline16 size={16} />}
            disabled={busy}
            onClick={() => void handleSubmit()}
          >
            {phase.kind === 'submitting' ? t('form.submitting') : t('form.submit')}
          </Button>
        </>
      )}
    >
      <div className={styles.formBody}>
        <label className={styles.fieldLabel}>
          {t('form.title')}
          <Input
            value={title}
            placeholder={t('form.titlePlaceholder')}
            maxLength={64}
            onChange={(event) => {
              setTitle(event.target.value)
              setFieldError(null)
            }}
          />
        </label>
        <label className={styles.fieldLabel}>
          {t('form.description')}
          <textarea
            className={styles.textarea}
            value={description}
            placeholder={t('form.descriptionPlaceholder')}
            maxLength={2000}
            rows={3}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {fieldError ? <div className={styles.fieldError}>{fieldError}</div> : null}
      </div>
    </Modal>
  )
}
