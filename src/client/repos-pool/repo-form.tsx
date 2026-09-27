/**
 * Repos-pool add/edit form: Modal + host Input atoms + a token-styled
 * textarea (the host ships no textarea primitive), the per-address
 * validation flow, and RiskConfirmation gates for network/auth outcomes
 * (decision 0003 D2/D3/D4 as amended by 0004 D1-D4).
 *
 * P3 two-box form — each box IS its slot (SSH box → urlSsh, HTTP box →
 * urlHttp); clearing a box removes that address (field presence is the
 * intent, decision 0004 / D2). The P1 one-box passthrough/blocking guards
 * are gone by design. Load-bearing flow properties (P3 adversarial review):
 *  - Verdicts are cached BY VALUE: re-submitting only re-probes slots whose
 *    value has no fresh outcome; unchanged slots skip probing entirely.
 *  - Stale-response guard: a probe returning after its box was edited is
 *    dropped (valuesRef comparison) — never a verdict for one value saved
 *    onto another (fixes the P1-era hole).
 *  - Partial probe failure: each slot settles independently (failure → back
 *    to idle + that box's network error; successes keep their outcomes).
 *  - Single canSave derivation: busy, any box error, or any unacknowledged
 *    gate disables BOTH the footer submit and every gate confirm — a blocked
 *    sibling can never be saved through a gate's own confirm path.
 *  - Save failures keep verdicts and acks (they describe address
 *    reachability, not pool state); conflict self-heal re-aligns revision,
 *    so an immediate retry needs no re-probing.
 *  - Server 422 duplicate-url carries no field: the form attributes it by
 *    scanning the (refreshed) pool for the offending value, falling back to
 *    a form-level error.
 *
 * Form-internal state lives here on purpose — short-lived, no outside
 * readers (see store.ts).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconPlusOutline16, Input, Modal, RiskConfirmation, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AddressSlot, SaveRequestBody, SaveVerdict, UrlRejection, ValidateOutcome } from '../../repos-pool-shared/protocol.js'
import type { RepoRecord } from '../../repos-pool-shared/protocol.js'
import { checkUrlSyntax } from '../../repos-pool-shared/url-syntax.js'
import { slotOfKind } from '../../repos-pool-shared/address.js'
import type { ReposPoolController, SaveOutcome } from './controller.js'
import type { ReposPoolT } from './dictionary.js'
import type { ReposFetcher } from './fetcher.js'
import { REJECTION_KEY } from './rejection-keys.js'
import { repoNameFromUrl } from './url-name.js'
import styles from './view.module.css'

type Editing = { kind: 'create' } | { kind: 'edit'; repo: import('../../repos-pool-shared/protocol.js').RepoRecord }

/** Environmental save failures → in-dialog general error copy (field-fixable ones use the box slot). */
const GENERAL_ERROR_KEY = {
  'network': 'error.network',
  'conflict': 'error.conflict',
  'not-found': 'error.notFound',
  'unreadable-file': 'error.unreadableFile',
  'bad-request': 'error.internal',
  'internal': 'error.internal',
} as const

const SLOTS: readonly AddressSlot[] = ['ssh', 'http']
const SLOT_LABEL_KEY: Record<AddressSlot, Parameters<ReposPoolT>[0]> = { ssh: 'form.slotSsh', http: 'form.slotHttp' }
const SLOT_PLACEHOLDER_KEY: Record<AddressSlot, Parameters<ReposPoolT>[0]> = { ssh: 'form.urlSshPlaceholder', http: 'form.urlHttpPlaceholder' }
const SLOT_FIELD_KEY: Record<AddressSlot, Parameters<ReposPoolT>[0]> = { ssh: 'form.urlSsh', http: 'form.urlHttp' }

/** A slot's validation state. 'outcome' carries its value — the verdict cache key. */
type SlotPhase =
  | { kind: 'idle' }
  | { kind: 'validating'; value: string }
  | { kind: 'outcome'; value: string; outcome: ValidateOutcome }
  | { kind: 'skipped-unchanged' }

export function RepoForm(props: {
  t: ReposPoolT
  editing: Editing
  revision: number
  repos: readonly RepoRecord[]
  fetcher: ReposFetcher
  controller: ReposPoolController
}): ReactNode {
  const { t, editing, revision, repos, fetcher, controller } = props
  const [name, setName] = useState(editing.kind === 'edit' ? editing.repo.name : '')
  const [urlSsh, setUrlSsh] = useState(editing.kind === 'edit' ? (editing.repo.urlSsh ?? '') : '')
  const [urlHttp, setUrlHttp] = useState(editing.kind === 'edit' ? (editing.repo.urlHttp ?? '') : '')
  const [description, setDescription] = useState(editing.kind === 'edit' ? editing.repo.description : '')
  const [phase, setPhase] = useState<{ ssh: SlotPhase; http: SlotPhase }>({ ssh: { kind: 'idle' }, http: { kind: 'idle' } })
  const [boxError, setBoxError] = useState<{ ssh: string | null; http: string | null }>({ ssh: null, http: null })
  /** Form-level failures (name/environmental/duplicate-unattributed). */
  const [formError, setFormError] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState<{ ssh: boolean; http: boolean }>({ ssh: false, http: false })
  const [submitting, setSubmitting] = useState(false)
  /** Name auto-fill (create mode only): derive from the first non-empty box until the user types a name. */
  const [nameAuto, setNameAuto] = useState(editing.kind === 'create')
  /** Latest box values for post-await staleness checks (closures go stale across renders). */
  const valuesRef = useRef({ ssh: urlSsh, http: urlHttp })
  /** Aborts in-flight probes when the form unmounts (modal closed mid-validation). */
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const trimmed = { ssh: urlSsh.trim(), http: urlHttp.trim() }
  const provided: readonly AddressSlot[] = SLOTS.filter((slot) => trimmed[slot].length > 0)
  const stored = (slot: AddressSlot): string | undefined => (editing.kind === 'edit' ? (slot === 'ssh' ? editing.repo.urlSsh : editing.repo.urlHttp) : undefined)
  const unchangedSlot = (slot: AddressSlot): boolean => editing.kind === 'edit' && stored(slot) === trimmed[slot]

  /** A slot has a fresh verdict when its outcome phase matches the current value. */
  const freshOutcome = (slot: AddressSlot): ValidateOutcome | undefined => {
    const p = phase[slot]
    return p.kind === 'outcome' && p.value === trimmed[slot] ? p.outcome : undefined
  }

  const classificationOf = (outcome: ValidateOutcome | undefined): string | undefined =>
    outcome !== undefined && outcome.syntax.acceptable ? outcome.reachability?.classification : undefined
  const gatedSlot = (slot: AddressSlot): 'auth' | 'network' | 'unknown' | undefined => {
    const cls = classificationOf(freshOutcome(slot))
    return cls === 'auth' || cls === 'network' || cls === 'unknown' ? cls : undefined
  }
  const busy = submitting || SLOTS.some((slot) => phase[slot].kind === 'validating')
  const anyBoxError = SLOTS.some((slot) => boxError[slot] !== null)
  const gatedSlots = provided.filter((slot) => gatedSlot(slot) !== undefined)
  const anyGateUnacked = gatedSlots.some((slot) => !acknowledged[slot])
  /** Single save gate: every confirm path (footer + each gate) consults this. */
  const canSave = !busy && !anyBoxError && !anyGateUnacked

  const deriveName = (ssh: string, http: string): string => repoNameFromUrl(ssh.trim().length > 0 ? ssh : http)

  const handleUrlChange = (slot: AddressSlot, value: string): void => {
    if (slot === 'ssh') setUrlSsh(value)
    else setUrlHttp(value)
    valuesRef.current[slot] = value
    // Editing a box invalidates that slot's verdict, ack, and error; the
    // other slot keeps everything (independent slots by design).
    setPhase((p) => ({ ...p, [slot]: { kind: 'idle' } }))
    setAcknowledged((p) => ({ ...p, [slot]: false }))
    setBoxError((p) => ({ ...p, [slot]: null }))
    setFormError(null)
    if (nameAuto) setName(slot === 'ssh' ? deriveName(value, urlHttp) : deriveName(urlSsh, value))
  }

  const handleNameChange = (value: string): void => {
    setName(value)
    setNameAuto(false)
    setFormError(null)
  }

  /**
   * Collects save verdicts from current state; gated slots forced only when
   * includeForced. `landed` carries probe results that resolved inside the
   * CURRENT handleSubmit closure — render state (`phase`) is stale there
   * because setPhase never updates the running closure, so the just-probed
   * verdicts must be read from the local map first.
   */
  const collectVerdicts = (includeForced: boolean, landed?: Partial<Record<AddressSlot, ValidateOutcome>>): Partial<Record<AddressSlot, SaveVerdict>> => {
    const verdicts: Partial<Record<AddressSlot, SaveVerdict>> = {}
    for (const slot of provided) {
      if (unchangedSlot(slot)) {
        verdicts[slot] = { kind: 'unchanged' }
        continue
      }
      const outcome = landed?.[slot] ?? freshOutcome(slot)
      if (outcome === undefined || !outcome.syntax.acceptable) continue
      switch (outcome.reachability?.classification) {
        case 'reachable':
          verdicts[slot] = { kind: 'verified' }
          break
        case 'unverified':
          verdicts[slot] = { kind: 'unverified' }
          break
        case 'auth':
        case 'network':
        case 'unknown':
          if (includeForced) verdicts[slot] = { kind: 'forced', from: outcome.reachability.classification }
          break
      }
    }
    return verdicts
  }

  const buildBody = (validation: SaveRequestBody['validation']): SaveRequestBody => ({
    expectedRevision: revision,
    repo: {
      ...(editing.kind === 'edit' ? { id: editing.repo.id } : {}),
      name: name.trim(),
      description: description.trim(),
      ...(trimmed.ssh.length > 0 ? { urlSsh: trimmed.ssh } : {}),
      ...(trimmed.http.length > 0 ? { urlHttp: trimmed.http } : {}),
    },
    validation,
  })

  /** Server duplicate 422 carries no field — attribute by scanning the pool for the offending value. */
  const attributeDuplicate = (): void => {
    for (const slot of provided) {
      const hit = repos.some(
        (repo) => (editing.kind !== 'edit' || repo.id !== editing.repo.id)
          && (repo.urlSsh === trimmed[slot] || repo.urlHttp === trimmed[slot]),
      )
      if (hit) {
        setBoxError((p) => ({ ...p, [slot]: t('error.duplicateUrl') }))
        return
      }
    }
    setFormError(t('error.duplicateUrl'))
  }

  const doSave = async (validation: SaveRequestBody['validation']): Promise<void> => {
    setSubmitting(true)
    const outcome: SaveOutcome = await controller.save(buildBody(validation))
    setSubmitting(false)
    if (outcome.kind === 'ok') return // controller closed the form
    // Verdicts and acks are deliberately KEPT: they describe address
    // reachability, not pool state; conflict/not-found already self-healed
    // the revision, so an immediate retry needs no re-probing.
    if (outcome.code === 'invalid-url') {
      const key = REJECTION_KEY[outcome.reason ?? 'malformed-url']
      if (outcome.field !== undefined) setBoxError((p) => ({ ...p, [outcome.field as AddressSlot]: t(key) }))
      else setFormError(t(key))
      return
    }
    if (outcome.code === 'duplicate-url') {
      attributeDuplicate()
      return
    }
    setFormError(t(GENERAL_ERROR_KEY[outcome.code]))
  }

  const handleSubmit = async (): Promise<void> => {
    if (name.trim().length === 0) {
      setFormError(t('error.nameRequired'))
      return
    }
    if (provided.length === 0) {
      setFormError(t('error.urlRequired'))
      return
    }
    // Local per-box checks at submit time (never onChange — mid-typing would
    // be a red-flash carousel): syntax whitelist, then family match (a box
    // accepts only its own family; the other box is the intent, not silent
    // re-slotting), then same-value boxes.
    const nextBoxError: { ssh: string | null; http: string | null } = { ssh: null, http: null }
    for (const slot of provided) {
      const syntax = checkUrlSyntax(trimmed[slot])
      if (!syntax.acceptable) {
        nextBoxError[slot] = t(REJECTION_KEY[syntax.reason])
        continue
      }
      if (slotOfKind(syntax.kind) !== slot) {
        nextBoxError[slot] = t('error.slotFamily')
      }
    }
    if (provided.length === 2 && trimmed.ssh === trimmed.http && nextBoxError.ssh === null) {
      nextBoxError.http = t('error.sameAddress')
    }
    if (nextBoxError.ssh !== null || nextBoxError.http !== null) {
      setBoxError(nextBoxError)
      setFormError(null)
      return
    }
    // Local duplicate precheck (instant; per box against BOTH slots of every
    // record, excluding self). The server re-checks regardless.
    for (const slot of provided) {
      const duplicate = repos.some(
        (repo) => (repo.urlSsh === trimmed[slot] || repo.urlHttp === trimmed[slot])
          && (editing.kind !== 'edit' || repo.id !== editing.repo.id),
      )
      if (duplicate) {
        setBoxError((p) => ({ ...p, [slot]: t('error.duplicateUrl') }))
        return
      }
    }
    setBoxError({ ssh: null, http: null })
    setFormError(null)

    // Probe only slots without a fresh outcome (value-keyed verdict cache:
    // retries and re-clicks never re-probe concluded slots).
    const toProbe = provided.filter((slot) => !unchangedSlot(slot) && freshOutcome(slot) === undefined)
    /** Verdicts that land inside THIS closure — `phase` here is a stale render snapshot. */
    const landed: Partial<Record<AddressSlot, ValidateOutcome>> = {}
    if (toProbe.length > 0) {
      for (const slot of toProbe) setPhase((p) => ({ ...p, [slot]: { kind: 'validating', value: trimmed[slot] } }))
      abortRef.current?.abort()
      const abort = new AbortController()
      abortRef.current = abort
      // Parallel probes, per-slot settle: a failure resets only its slot.
      const results = await Promise.all(
        toProbe.map(async (slot) => ({ slot, result: await fetcher.validate(trimmed[slot], abort.signal) })),
      )
      abortRef.current = null
      for (const { slot, result } of results) {
        // Stale guard: the box changed while probing — drop the verdict.
        if (valuesRef.current[slot] !== trimmed[slot]) continue
        if (result.kind !== 'ok') {
          setPhase((p) => ({ ...p, [slot]: { kind: 'idle' } }))
          setBoxError((p) => ({ ...p, [slot]: t('error.network') }))
          continue
        }
        landed[slot] = result.outcome
        setPhase((p) => {
          const cur = p[slot]
          if (cur.kind !== 'validating' || cur.value !== trimmed[slot]) return p
          if (slot === 'ssh') return { ...p, ssh: { kind: 'outcome', value: trimmed.ssh, outcome: result.outcome } }
          return { ...p, http: { kind: 'outcome', value: trimmed.http, outcome: result.outcome } }
        })
      }
    }

    // Gate on gated slots (verdicts now fresh for everything probed). The
    // auto-save paths run when nothing needs a gate.
    const outcomeNow = (slot: AddressSlot): ValidateOutcome | undefined => landed[slot] ?? freshOutcome(slot)
    const hasMissing = provided.some((slot) => !unchangedSlot(slot) && outcomeNow(slot) === undefined)
    if (hasMissing) return // a network-failed slot left its box error in place
    const verdicts = collectVerdicts(false, landed)
    const allDecided = provided.every((slot) => verdicts[slot] !== undefined)
    if (allDecided) {
      await doSave(verdicts as SaveRequestBody['validation'])
      return
    }
    // Some slot is gated: gates render below; submit button unlocks when all
    // are acknowledged (canSave). Set the unchanged marker for display.
    for (const slot of provided) {
      if (unchangedSlot(slot) && phase[slot].kind === 'idle') setPhase((p) => ({ ...p, [slot]: { kind: 'skipped-unchanged' } }))
    }
  }

  const submit = (): void => {
    // Footer path: with gates open this saves through them (all acked);
    // without gates it runs the probe/collect flow.
    if (gatedSlots.length > 0) {
      if (!canSave) return
      if (name.trim().length === 0) {
        setFormError(t('error.nameRequired'))
        return
      }
      void doSave(collectVerdicts(true) as SaveRequestBody['validation'])
      return
    }
    void handleSubmit()
  }

  const gate = (slot: AddressSlot): ReactNode => {
    const cls = gatedSlot(slot)
    if (cls === undefined) return null
    const slotLabel = t(SLOT_LABEL_KEY[slot])
    const titleKey = cls === 'auth' ? 'risk.titleAuth' : cls === 'unknown' ? 'risk.titleUnknown' : 'risk.titleNetwork'
    const descKey = cls === 'auth' ? 'risk.descriptionAuth' : cls === 'unknown' ? 'risk.descriptionUnknown' : 'risk.descriptionNetwork'
    return (
      <RiskConfirmation
        key={slot}
        open
        title={`${t(titleKey)}（${slotLabel}）`}
        description={t(descKey)}
        acknowledgeLabel={t('risk.acknowledge')}
        cancelLabel={t('risk.cancel')}
        closeLabel={t('risk.closeLabel')}
        confirmLabel={t('risk.confirm')}
        acknowledged={acknowledged[slot]}
        // NOT the full canSave: the primitive disables the ack CHECKBOX with
        // the same flag, and canSave is false while any gate is unacked —
        // passing it would deadlock acknowledgement. So the box errors/busy
        // disable the whole gate here, while the "every gate acked" rule is
        // enforced by the footer button's disabled state plus the canSave
        // guard inside onConfirm (a lone acked gate's confirm no-ops).
        disabled={busy || anyBoxError}
        onAcknowledgedChange={(value) => setAcknowledged((p) => ({ ...p, [slot]: value }))}
        onCancel={() => {
          setPhase((p) => ({ ...p, [slot]: { kind: 'idle' } }))
          setAcknowledged((p) => ({ ...p, [slot]: false }))
        }}
        onConfirm={() => {
          // Same gate as the footer submit: a blocked sibling or an
          // unacknowledged other gate must never save through here.
          if (!canSave) return
          void doSave(collectVerdicts(true) as SaveRequestBody['validation'])
        }}
      />
    )
  }

  const boxVerdict = (slot: AddressSlot): ReactNode => {
    const p = phase[slot]
    if (p.kind === 'validating') return <span className={styles.fieldHint}>{t('form.validating')}</span>
    if (p.kind === 'skipped-unchanged') return <span className={styles.fieldHint}>{t('form.validateSkipped')}</span>
    if (p.kind !== 'outcome' || p.value !== trimmed[slot]) return null
    const outcome = p.outcome
    if (!outcome.syntax.acceptable) {
      return <span className={styles.fieldError}>{t(REJECTION_KEY[outcome.syntax.reason])}</span>
    }
    switch (outcome.reachability?.classification) {
      case 'reachable':
        return <span className={styles.fieldOk}><Tag tone="success">{t('form.validateOk')}</Tag></span>
      case 'unverified':
        return <span className={styles.fieldHint}>{t('form.validateUnverified')}</span>
      case 'unknown':
        return (
          <span className={styles.fieldError}>
            {t('error.unknownReachability')}
            {outcome.reachability?.detail ? ` — ${outcome.reachability.detail}` : ''}
          </span>
        )
      default:
        return null
    }
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
            disabled={!canSave}
            onClick={submit}
          >
            {submitting ? t('form.submitting') : t('form.submit')}
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
            onChange={(event) => handleNameChange(event.target.value)}
          />
        </label>
        {SLOTS.map((slot) => (
          <div key={slot}>
            <label className={styles.fieldLabel}>
              {t(SLOT_FIELD_KEY[slot])}
              <Input
                value={slot === 'ssh' ? urlSsh : urlHttp}
                placeholder={t(SLOT_PLACEHOLDER_KEY[slot])}
                maxLength={2048}
                spellCheck={false}
                onChange={(event) => handleUrlChange(slot, event.target.value)}
              />
            </label>
            <div className={styles.fieldVerdict}>{boxVerdict(slot)}</div>
            {boxError[slot] !== null ? <div className={styles.fieldError}>{boxError[slot]}</div> : null}
          </div>
        ))}
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
        {formError ? <div className={styles.fieldError}>{formError}</div> : null}
        {gatedSlots.map((slot) => gate(slot))}
      </div>
    </Modal>
  )
}
