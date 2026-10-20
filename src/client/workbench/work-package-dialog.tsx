/**
 * S3 work-package detail modal (860px wide, the prdWideDialog precedent):
 * the plan section is hard gate ② — version chain rows + MarkdownText body
 * + the tail-draft editor (writes through the tail-draft pipeline; the
 * version number is host-assigned) + footer [退回修改][批准计划]. The
 * lifecycle action row and the acceptance section carry the state machine
 * (start / mark built / accept / reject-with-required-reason / reopen /
 * drop). Sessions and commits render read-only this round (binding is P2).
 *
 * Plan bodies cache per version in COMPONENT state (lazy fetch + abort;
 * never the store — 512K-class transient payloads die with the dialog).
 * Missing and tampered plan files render their honest states (D4-④): the
 * tail draft offers retry-write (idempotent convergence repairs the disk);
 * approved/archived versions only disclose.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MarkdownText, Modal, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionPicker } from './session-picker.js'
import { sessionChipState } from './session-chip.js'
import { DeclarationCard } from './declaration-card.js'
import { CopyTextButton } from './copy-text-button.js'
import { WORKBENCH_ARTIFACT_MAX_CHARS } from '../../workbench-shared/protocol.js'
import type { WorkbenchWorkPackage } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import styles from './view.module.css'

export const STATUS_TAG_TONE: Record<WorkbenchWorkPackage['status'], 'neutral' | 'warning' | 'info' | 'success' | 'quiet'> = {
  planned: 'neutral',
  'plan-draft': 'warning',
  'plan-approved': 'info',
  'in-dev': 'info',
  built: 'warning',
  accepted: 'success',
  dropped: 'quiet',
}

export const STATUS_LABEL_KEY: Record<WorkbenchWorkPackage['status'], Parameters<WorkbenchT>[0]> = {
  planned: 'detail.statusPlanned',
  'plan-draft': 'detail.statusPlanDraft',
  'plan-approved': 'detail.statusPlanApproved',
  'in-dev': 'detail.statusInDev',
  built: 'detail.statusBuilt',
  accepted: 'detail.statusAccepted',
  dropped: 'detail.statusDropped',
}

type PlanBody =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'missing' }
  | { phase: 'ready'; content: string; tampered: boolean }

export function WorkPackageDialog(props: {
  t: WorkbenchT
  workPackage: WorkbenchWorkPackage
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  requirementId: string
  sessions?: { ids: readonly string[]; summariesById: Readonly<Record<string, { id: string; displayTitle: string; running: boolean; blank: boolean } | undefined>> }
  /** SessionIds with a pending approval/question (P2b fourth state). */
  waitingIds?: ReadonlySet<string>
  /** 0017 修订：会话条退役后 WP 详情是会话入口——行点击跳 DSH 会话页（register.navigate：open+selectPanel 官方尾巴）。 */
  onNavigateSession?: (sessionId: string) => void
  /** 0018: purpose-parameterized — 'wp-plan' opens the planning SOW (the
   * 刀一 raw entry; 刀二 reshapes into status-driven layering), 'dev' the
   * development SOW (the pre-0018 button). */
  onOpenSow?: (workPackage: WorkbenchWorkPackage, purpose: 'dev' | 'wp-plan') => void
  onClose: () => void
}): ReactNode {
  const { t, workPackage, slot, controller, requirementId } = props
  const [pickerOpen, setPickerOpen] = useState(false)
  const [devAckOpen, setDevAckOpen] = useState(false)
  const plans = [...workPackage.plans].sort((a, b) => b.version - a.version)
  const tailDraftVersion = plans.find((plan) => plan.approvedAt === undefined)?.version ?? null
  // 0018 刀二: the layering key — an approved plan makes dev the leading
  // verb; without one the wp-plan verb leads and dev pays the ack toll.
  const hasApprovedPlan = workPackage.plans.some((plan) => plan.approvedAt !== undefined)
  const [selectedVersion, setSelectedVersion] = useState<number | null>(plans[0]?.version ?? null)
  const [bodies, setBodies] = useState<ReadonlyMap<number, PlanBody>>(new Map())
  const [draftText, setDraftText] = useState('')
  const [draftSeeded, setDraftSeeded] = useState(false)
  // Bumping after a draft save invalidates the per-version cache AND
  // re-triggers the fetch effect (bodies is deliberately outside its deps
  // to avoid refetch loops — the nonce is the explicit invalidation signal).
  const [refetchNonce, setRefetchNonce] = useState(0)
  const [savingDraft, setSavingDraft] = useState(false)
  const [dropOpen, setDropOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [rejectError, setRejectError] = useState<string | null>(null)
  const seqRef = useRef(0)

  const fileExists = (version: number): boolean | undefined =>
    slot.planFileExists.find((row) => row.workPackageId === workPackage.id && row.version === version)?.exists

  const cache = (version: number, body: PlanBody): void => {
    setBodies((current) => new Map(current).set(version, body))
  }

  // Fetch the selected version on demand (abort on switch/unmount; a late
  // older response must not overwrite a newer selection).
  useEffect(() => {
    if (selectedVersion === null) return
    if (bodies.get(selectedVersion) !== undefined) return
    const seq = ++seqRef.current
    cache(selectedVersion, { phase: 'loading' })
    let cancelled = false
    void controller.planContent(requirementId, workPackage.id, selectedVersion).then((result) => {
      if (cancelled || seq !== seqRef.current) return
      if (result === undefined) {
        cache(selectedVersion, { phase: 'error' })
        return
      }
      if (result.kind === 'ok') {
        cache(selectedVersion, { phase: 'ready', content: result.content, tampered: result.contentTampered })
        return
      }
      cache(selectedVersion, result.kind === 'http-error' && result.status === 404 ? { phase: 'missing' } : { phase: 'error' })
    })
    return () => {
      cancelled = true
    }
    // bodies intentionally excluded: a cached version skips the fetch; the
    // cache is invalidated explicitly after a draft save via refetchNonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersion, requirementId, workPackage.id, refetchNonce])

  // Seed the draft editor once from the tail draft's body.
  useEffect(() => {
    if (draftSeeded || tailDraftVersion === null) return
    const body = bodies.get(tailDraftVersion)
    if (body?.phase === 'ready') {
      setDraftText(body.content)
      setDraftSeeded(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tailDraftVersion, bodies])

  // Stable identity — MarkdownText's memo drops its render cache otherwise
  // (the prd-section labels-memo precedent).
  const markdownLabels = useMemo(() => ({
    code: { copyLabel: t('md.copyCode'), copiedLabel: t('md.copiedCode') },
    footnotes: t('md.footnotes'),
  }), [t])

  const selectedBody = selectedVersion === null ? null : (bodies.get(selectedVersion) ?? null)

  const saveDraft = (): void => {
    setSavingDraft(true)
    void controller.writePlan(requirementId, workPackage.id, draftText).then((ok) => {
      setSavingDraft(false)
      if (ok) {
        // Invalidate every cached version (the tail may have been re-versioned
        // or re-hashed) and refetch the selection; reseed the editor.
        setBodies(new Map())
        setDraftSeeded(false)
        setRefetchNonce((nonce) => nonce + 1)
      }
    })
  }

  const versionTag = (version: number): { label: string; tone: 'neutral' | 'warning' | 'success' } => {
    const entry = workPackage.plans.find((plan) => plan.version === version)
    if (entry === undefined) return { label: '', tone: 'neutral' }
    if (entry.approvedAt !== undefined) return { label: t('detail.versionApproved'), tone: 'success' }
    if (version === tailDraftVersion) return { label: t('detail.versionDraft'), tone: 'warning' }
    return { label: t('detail.versionArchived'), tone: 'neutral' }
  }

  return (
    <Modal
      open
      onClose={() => { props.onClose() }}
      title={`${workPackage.id}　${workPackage.title}`}
      closeLabel={t('action.cancel')}
      className={styles.wpDialog}
      contentClassName={styles.wpDialogBody}
      footer={
        <div className={styles.wpFooterStack}>
          <div className={styles.wpFooterAside}>
            {workPackage.status === 'plan-approved' ? (
              <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { void controller.startWorkPackage(requirementId, workPackage.id) }}>{t('detail.startWork')}</button>
            ) : null}
            {workPackage.status === 'in-dev' ? (
              <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { void controller.markWorkPackageBuilt(requirementId, workPackage.id) }}>{t('detail.markBuilt')}</button>
            ) : null}
            {workPackage.status === 'accepted' ? (
              <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { void controller.reopenWorkPackage(requirementId, workPackage.id) }}>{t('detail.reopen')}</button>
            ) : null}
            {workPackage.status === 'planned' || workPackage.status === 'plan-draft' || workPackage.status === 'plan-approved' ? (
              <button type="button" className={`${styles.ghostButton} ${styles.dangerButton}`} disabled={slot.busy} onClick={() => { setDropOpen(true) }}>{t('detail.drop')}</button>
            ) : null}
          </div>
          <div className={styles.wpFooterMain}>
            <button type="button" className={styles.ghostButton} onClick={() => { props.onClose() }}>{t('detail.returnForEdit')}</button>
            {tailDraftVersion !== null ? (
              <button
                type="button"
                className={styles.primaryButton}
                disabled={slot.busy}
                onClick={() => { void controller.approvePlan(requirementId, workPackage.id) }}
              >
                {t('detail.approvePlan')}
              </button>
            ) : null}
          </div>
        </div>
      }
    >
      <div className={styles.wpDialogSection}>
        <div className={styles.sectionTitle}>
          {t('detail.planSection')}
          <Tag tone={STATUS_TAG_TONE[workPackage.status]}>{t(STATUS_LABEL_KEY[workPackage.status])}</Tag>
          {/* 0018 刀二 状态驱动分层：按钮顺序随 hasApprovedPlan 对调（规划先行
              vs 开发先行）；无已批准计划时开发入口走 ack 确认（软门——跳过
              显式化，不阻断）。 */}
          {props.onOpenSow !== undefined ? (
            hasApprovedPlan ? (
              <>
                <button type="button" className={styles.ghostButton} onClick={() => { props.onOpenSow?.(workPackage, 'dev') }}>{t('sow.workPackageButton')}</button>
                <button type="button" className={styles.ghostButton} onClick={() => { props.onOpenSow?.(workPackage, 'wp-plan') }}>{t('sow.wpPlanButton')}</button>
              </>
            ) : (
              <>
                <button type="button" className={styles.ghostButton} onClick={() => { props.onOpenSow?.(workPackage, 'wp-plan') }}>{t('sow.wpPlanButton')}</button>
                <button type="button" className={styles.ghostButton} onClick={() => { setDevAckOpen(true) }}>{t('sow.workPackageButton')}</button>
              </>
            )
          ) : null}
        </div>
        {plans.length === 0 ? <div className={styles.formHint}>{t('detail.noPlans')}</div> : (
          <>
            <div className={styles.wpVersionRow}>
              {plans.map((plan, index) => {
                const tag = versionTag(plan.version)
                const missing = fileExists(plan.version) === false
                return (
                  <button
                    key={plan.version}
                    type="button"
                    className={plan.version === selectedVersion ? `${styles.wpVersionChip} ${styles.wpVersionCurrent}` : styles.wpVersionChip}
                    onClick={() => { setSelectedVersion(plan.version) }}
                  >
                    v{plan.version}
                    {index === 0 ? ` · ${t('detail.versionCurrent')}` : ''}
                    {` · ${tag.label}`}
                    {missing ? ` · ${t('board.planMissing')}` : ''}
                  </button>
                )
              })}
            </div>
            {/* 0018 刀二: the wp-plan collection's provenance row (the
                proposal.sourcePrefix form) — names the planning delivery's
                conversation when the planSeed pointer exists. */}
            {workPackage.planSeed?.session !== undefined ? (
              <div className={styles.formHint}>
                {t('detail.planSeedSource').replaceAll('{id}', workPackage.planSeed.session.sessionId.slice(0, 8))}
              </div>
            ) : null}
            {selectedBody === null || selectedBody.phase === 'loading' ? <div className={styles.formHint}>{t('page.loading')}</div> : null}
            {selectedBody?.phase === 'error' ? <div className={styles.fieldError}>{t('detail.planLoadFailed')}</div> : null}
            {selectedBody?.phase === 'missing' ? (
              <div className={styles.wpMissing}>
                <span>{t('detail.planMissing')}</span>
                {selectedVersion === tailDraftVersion ? (
                  <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={saveDraft}>{t('detail.planRewrite')}</button>
                ) : null}
              </div>
            ) : null}
            {selectedBody?.phase === 'ready' ? (
              <>
                {selectedBody.tampered ? <div className={styles.wpWarnStrip}>{t('detail.tampered')}</div> : null}
                <div className={styles.wpDraftActions}>
                  <CopyTextButton t={t} text={selectedBody.content} />
                </div>
                <div className={styles.wpDocBody}>
                  <MarkdownText text={selectedBody.content} labels={markdownLabels} />
                </div>
              </>
            ) : null}
            <label className={styles.formField}>
              <span>{t('detail.draftLabel')}</span>
              <textarea
                rows={6}
                className={styles.wpDraftTextarea}
                value={draftText}
                maxLength={WORKBENCH_ARTIFACT_MAX_CHARS}
                placeholder={t('detail.draftPlaceholder')}
                onChange={(event) => { setDraftText(event.target.value) }}
              />
            </label>
            <div className={styles.wpDraftActions}>
              <button type="button" className={styles.primaryButton} disabled={savingDraft || slot.busy} onClick={saveDraft}>{t('detail.draftSave')}</button>
            </div>
          </>
        )}
      </div>

      <div className={styles.wpDialogSection}>
        <div className={styles.sectionTitle}>
          {t('detail.sessionsSection')}
          {workPackage.commits.length > 0 ? <span className={styles.formHint}>{t('board.commits').replaceAll('{n}', String(workPackage.commits.length))}</span> : null}
          <button type='button' className={styles.ghostButton} onClick={() => { setPickerOpen(true) }}>{t('session.bindButton')}</button>
        </div>
        {workPackage.sessions.length === 0 ? <div className={styles.formHint}>{t('session.pickerHint')}</div> : null}
        {workPackage.sessions.map((binding) => {
          const summary = props.sessions?.summariesById[binding.sessionId]
          const chip = summary === undefined ? null : sessionChipState(props.waitingIds?.has(binding.sessionId) ?? false, summary.running, summary.blank)
          const title = (
            <>
              {binding.sessionId.slice(0, 8)} {summary !== undefined ? summary.displayTitle : t('session.stateGone')}
            </>
          )
          const meta = (
            <div className={styles.findingRowMeta}>
              {binding.purpose === 'analysis' ? t('session.purposeAnalysis') : binding.purpose === 'dev' ? t('session.purposeDev') : t('session.purposeReview')}
              {' · '}
              {chip === null ? t('session.stateGone') : t(chip.labelKey)}
              {' · '}
              {t('session.boundAtPrefix')} {binding.boundAt}
            </div>
          )
          // 0017 修订：在场会话行=可点入按钮（跳 DSH 会话页）；消亡绑定（会话已
          // 离开列表）保持只读行——诚实于死引用，不做假可点。
          if (summary !== undefined && props.onNavigateSession !== undefined) {
            return (
              <button
                key={binding.sessionId + binding.purpose}
                type="button"
                className={`${styles.findingRow} ${styles.sessionRowButton}`}
                onClick={() => { props.onNavigateSession?.(binding.sessionId) }}
              >
                <div className={styles.findingRowTitle}>
                  <StateDot state={chip?.dot ?? 'idle'} />
                  {title}
                </div>
                {meta}
              </button>
            )
          }
          return (
            <div key={binding.sessionId + binding.purpose} className={styles.findingRow}>
              <div className={styles.findingRowTitle}>{title}</div>
              {meta}
            </div>
          )
        })}
        {props.sessions !== undefined ? (
          <SessionPicker
            t={t}
            open={pickerOpen}
            rows={props.sessions.ids.flatMap((id) => {
              const summary = props.sessions?.summariesById[id]
              return summary === undefined ? [] : [{ id, displayTitle: summary.displayTitle, running: summary.running, blank: summary.blank, waiting: props.waitingIds?.has(id) ?? false }]
            })}
            boundSessionIds={workPackage.sessions.map((binding) => binding.sessionId)}
            busy={slot.busy}
            onClose={() => { setPickerOpen(false) }}
            onBind={(sessionId, purpose) => {
              void controller.bindSession(requirementId, workPackage.id, sessionId, purpose).then((ok) => { if (ok) setPickerOpen(false) })
            }}
          />
        ) : null}
      </div>

      <div className={styles.wpDialogSection}>
        <div className={styles.sectionTitle}>{t('detail.acceptanceSection')}</div>
        {/* 0016 P1a: the collected dev-declare batch's收取卡 — pending feeds
            the import flow (slot stamped + receipt, atomically); imported/
            dismissed collapse to receipt lines. No slot ⇒ no card. */}
        <DeclarationCard
          t={t}
          requirementId={requirementId}
          slot={slot}
          controller={controller}
          workPackage={workPackage}
          sessions={props.sessions}
        />
        {workPackage.status === 'built' ? (
          <div className={styles.formHint}>{t('detail.builtSourceManual')}</div>
        ) : null}
        {workPackage.acceptances.length === 0 ? <div className={styles.formHint}>{t('detail.acceptanceEmpty')}</div> : (
          workPackage.acceptances.map((acceptance, index) => (
            <div key={index} className={styles.wpAcceptanceRow}>
              <Tag tone={acceptance.result === 'pass' ? 'success' : 'danger'}>
                {acceptance.result === 'pass' ? t('detail.acceptancePass') : t('detail.acceptanceFail')}
              </Tag>
              <span className={styles.wpAcceptanceNote}>{acceptance.note ?? ''}</span>
              <span className={styles.wpAcceptanceAt}>{acceptance.at}</span>
            </div>
          ))
        )}
        {workPackage.status === 'built' ? (
          <div className={styles.wpFooterMain}>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={slot.busy}
              onClick={() => { void controller.acceptWorkPackage(requirementId, workPackage.id, 'pass') }}
            >
              {t('board.accept')}
            </button>
            <button
              type="button"
              className={`${styles.ghostButton} ${styles.dangerButton}`}
              disabled={slot.busy}
              onClick={() => { setRejectOpen(true); setRejectNote(''); setRejectError(null) }}
            >
              {t('board.reject')}
            </button>
          </div>
        ) : null}
      </div>

      {/* 0018 刀二：dev 直投 ack——无已批准计划的软门确认（警示不阻断，0013
          采纳 ack 形制；跳过路径显式化）。 */}
      <Modal
        open={devAckOpen}
        onClose={() => { setDevAckOpen(false) }}
        title={t('detail.devNoPlanAckTitle')}
        closeLabel={t('action.cancel')}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setDevAckOpen(false) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                setDevAckOpen(false)
                props.onOpenSow?.(workPackage, 'dev')
              }}
            >
              {t('detail.devNoPlanAckConfirm')}
            </button>
          </>
        }
      >
        {t('detail.devNoPlanAckBody')}
      </Modal>

      <Modal
        open={dropOpen}
        onClose={() => { setDropOpen(false) }}
        title={t('detail.dropTitle')}
        closeLabel={t('action.cancel')}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setDropOpen(false) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={slot.busy}
              onClick={() => {
                setDropOpen(false)
                void controller.dropWorkPackage(requirementId, workPackage.id)
              }}
            >
              {t('detail.drop')}
            </button>
          </>
        }
      >
        {t('detail.dropDescription')}
      </Modal>

      <Modal
        open={rejectOpen}
        onClose={() => { setRejectOpen(false) }}
        title={t('board.rejectTitle')}
        closeLabel={t('action.cancel')}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setRejectOpen(false) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={slot.busy}
              onClick={() => {
                if (rejectNote.trim().length === 0) {
                  setRejectError(t('board.rejectReasonRequired'))
                  return
                }
                setRejectOpen(false)
                void controller.acceptWorkPackage(requirementId, workPackage.id, 'fail', rejectNote.trim())
              }}
            >
              {t('board.rejectSubmit')}
            </button>
          </>
        }
      >
        <label className={styles.formField}>
          <span>{t('board.rejectReasonLabel')}</span>
          <textarea
            rows={3}
            value={rejectNote}
            maxLength={2000}
            onChange={(event) => { setRejectNote(event.target.value); setRejectError(null) }}
          />
        </label>
        {rejectError !== null ? <div className={styles.fieldError}>{rejectError}</div> : null}
      </Modal>
    </Modal>
  )
}
