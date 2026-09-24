/**
 * Repos-pool add/edit form: Modal + host Input atoms + a token-styled
 * textarea (the host ships no textarea primitive), the validation flow, and
 * the RiskConfirmation gate for network/auth outcomes (decision D2/D3/D4:
 * illegitimate and unknown outcomes have no save path; unverified saves
 * without a gate; network/auth save only behind the acknowledge checkbox).
 *
 * Form-internal state lives here on purpose — short-lived, no outside
 * readers (see store.ts).
 */
import { useState, type ReactNode } from 'react'
import { Button, IconPlusOutline16, Input, Modal, RiskConfirmation, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SaveRequestBody, UrlRejection, ValidateOutcome } from '../../repos-pool-shared/protocol.js'
import type { ReposPoolController } from './controller.js'
import type { ReposPoolT } from './dictionary.js'
import type { ReposFetcher } from './fetcher.js'
import styles from './view.module.css'

type Editing = { kind: 'create' } | { kind: 'edit'; repo: import('../../repos-pool-shared/protocol.js').RepoRecord }

const REJECTION_KEY: Record<UrlRejection, Parameters<ReposPoolT>[0]> = {
  'empty': 'error.urlEmpty',
  'too-long': 'error.urlTooLong',
  'scheme-forbidden': 'error.urlSchemeForbidden',
  'no-scheme-local-path': 'error.urlLocalPath',
  'scp-ambiguous': 'error.urlScpAmbiguous',
  'embedded-credentials': 'error.urlCredentials',
  'malformed-url': 'error.urlMalformed',
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'outcome'; outcome: ValidateOutcome }
  | { kind: 'skipped-unchanged' }
  | { kind: 'submitting' }

export function RepoForm(props: {
  t: ReposPoolT
  editing: Editing
  revision: number
  fetcher: ReposFetcher
  controller: ReposPoolController
}): ReactNode {
  const { t, editing, revision, fetcher, controller } = props
  const [name, setName] = useState(editing.kind === 'edit' ? editing.repo.name : '')
  const [url, setUrl] = useState(editing.kind === 'edit' ? editing.repo.url : '')
  const [description, setDescription] = useState(editing.kind === 'edit' ? editing.repo.description : '')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  const urlUnchanged = editing.kind === 'edit' && editing.repo.url === url.trim()
  const outcome = phase.kind === 'outcome' ? phase.outcome : undefined
  const reachability = outcome?.reachability
  const gated = reachability?.classification === 'auth' || reachability?.classification === 'network'
  const blocked = (outcome !== undefined && !outcome.syntax.acceptable) || reachability?.classification === 'unknown'
  const busy = phase.kind === 'validating' || phase.kind === 'submitting'

  const buildBody = (validation: SaveRequestBody['validation']): SaveRequestBody => ({
    expectedRevision: revision,
    repo: {
      ...(editing.kind === 'edit' ? { id: editing.repo.id } : {}),
      name: name.trim(),
      url: url.trim(),
      description: description.trim(),
    },
    validation,
  })

  const doSave = async (validation: SaveRequestBody['validation']): Promise<void> => {
    setPhase({ kind: 'submitting' })
    await controller.save(buildBody(validation))
    // Controller closes the form on success; failures surface through the
    // page banner and leave the form mounted — return to idle so the user
    // can retry.
    setPhase({ kind: 'idle' })
  }

  const handleSubmit = async (): Promise<void> => {
    setAcknowledged(false)
    if (name.trim().length === 0) {
      setFieldError(t('error.nameRequired'))
      return
    }
    if (url.trim().length === 0) {
      setFieldError(t('error.urlRequired'))
      return
    }
    setFieldError(null)

    // Edit with an unchanged URL: skip reachability, keep the stored status.
    if (urlUnchanged) {
      setPhase({ kind: 'skipped-unchanged' })
      await doSave({ kind: 'unchanged' })
      return
    }

    setPhase({ kind: 'validating' })
    const result = await fetcher.validate(url.trim())
    if (result.kind !== 'ok') {
      setPhase({ kind: 'idle' })
      setFieldError(t('error.network'))
      return
    }
    setPhase({ kind: 'outcome', outcome: result.outcome })
    if (!result.outcome.syntax.acceptable) return // field error renders; no save path
    switch (result.outcome.reachability?.classification) {
      case undefined: // syntax-only rejection already returned above
        return
      case 'reachable':
        await doSave({ kind: 'verified' })
        return
      case 'unverified':
        await doSave({ kind: 'unverified' })
        return
      case 'auth':
      case 'network':
        return // the RiskConfirmation gate below takes over
      case 'unknown':
        return // hard reject: no save path (decision D4)
    }
  }

  const gate = gated && !blocked
    ? (
      <RiskConfirmation
        open
        title={reachability?.classification === 'auth' ? t('risk.titleAuth') : t('risk.titleNetwork')}
        description={reachability?.classification === 'auth' ? t('risk.descriptionAuth') : t('risk.descriptionNetwork')}
        acknowledgeLabel={t('risk.acknowledge')}
        cancelLabel={t('risk.cancel')}
        closeLabel={t('risk.closeLabel')}
        confirmLabel={t('risk.confirm')}
        acknowledged={acknowledged}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => {
          setPhase({ kind: 'idle' })
          setAcknowledged(false)
        }}
        onConfirm={() => {
          void doSave({ kind: 'forced', from: reachability?.classification === 'auth' ? 'auth' : 'network' })
        }}
      />
    )
    : null

  const verdict = (() => {
    if (phase.kind === 'validating') return <span className={styles.fieldHint}>{t('form.validating')}</span>
    if (phase.kind === 'skipped-unchanged') return <span className={styles.fieldHint}>{t('form.validateSkipped')}</span>
    if (!outcome) return null
    if (!outcome.syntax.acceptable) {
      return <span className={styles.fieldError}>{t(REJECTION_KEY[outcome.syntax.reason])}</span>
    }
    switch (reachability?.classification) {
      case 'reachable':
        return <span className={styles.fieldOk}><Tag tone="success">{t('form.validateOk')}</Tag></span>
      case 'unverified':
        return <span className={styles.fieldHint}>{t('form.validateUnverified')}</span>
      case 'unknown':
        return (
          <span className={styles.fieldError}>
            {t('error.invalidUrl')}
            {reachability?.detail ? ` — ${reachability.detail}` : ''}
          </span>
        )
      default:
        return null
    }
  })()

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
            disabled={busy || blocked || (gate !== null && !acknowledged)}
            onClick={() => void handleSubmit()}
          >
            {phase.kind === 'submitting' ? t('form.submitting') : t('form.submit')}
          </Button>
        </>
      )}
    >
      <div className={styles.formBody}>
        <label className={styles.fieldLabel}>
          {t('form.name')}
          <Input
            value={name}
            placeholder={t('form.namePlaceholder')}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={styles.fieldLabel}>
          {t('form.url')}
          <Input
            value={url}
            placeholder={t('form.urlPlaceholder')}
            maxLength={2048}
            spellCheck={false}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <div className={styles.fieldVerdict}>{verdict}</div>
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
        {gate}
      </div>
    </Modal>
  )
}
