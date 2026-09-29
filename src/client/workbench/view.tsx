/**
 * AI workbench seat body (0006 P1b): the six-stage rail over the REAL ledger.
 *
 * The P1a honesty guard is rewritten bidirectionally: with a record present,
 * badge counts render FROM THE DATA (zero/empty still renders nothing — zero
 * reads as missing, hidden not placeholder), the stage-advance control
 * renders whenever a non-closed record exists (stage advance is a pure user
 * prerogative and a plain data-plane write — the two hard-gate modals are a
 * later round), and with NO record the empty state guides the first action
 * instead of faking progress.
 *
 * Structure: WorkbenchTabBody takes the resolved slot snapshot + controller
 * (tests inject both directly); the seat wrapper subscribes to the store and
 * pulls the controller on mount (the P1a factory-owner contract, grown up).
 */
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchStage } from '../../workbench-shared/protocol.js'
import { WORKBENCH_INLINE_MAX_CHARS, WORKBENCH_STAGES } from '../../workbench-shared/protocol.js'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState, WorkbenchStore } from './store.js'
import { slotFor } from './store.js'
import styles from './view.module.css'

const STAGE_LABEL_KEY: Record<WorkbenchStage, Parameters<WorkbenchT>[0]> = {
  understand: 'workbench.stage.understand',
  plan: 'workbench.stage.plan',
  implement: 'workbench.stage.implement',
  review: 'workbench.stage.review',
  deliver: 'workbench.stage.deliver',
  retro: 'workbench.stage.retro',
}

const STAGE_HINT_KEY: Record<WorkbenchStage, Parameters<WorkbenchT>[0]> = {
  understand: 'workbench.stageHint.understand',
  plan: 'workbench.stageHint.plan',
  implement: 'workbench.stageHint.implement',
  review: 'workbench.stageHint.review',
  deliver: 'workbench.stageHint.deliver',
  retro: 'workbench.stageHint.retro',
}

/** Badge anchors: which count rides which chip (zero/empty → no badge). */
function badgeCounts(slot: RequirementWorkbenchState): Partial<Record<WorkbenchStage, string | null>> {
  const record = slot.record
  if (record === null) return {}
  const findingsOpen = record.findings.filter((finding) => finding.status === 'open').length
  const accepted = record.modules.filter((module) => module.status === 'accepted').length
  const reviewOpen = record.reviewReports.reduce(
    (sum, report) => sum + report.verdicts.filter((verdict) => verdict.disposition === undefined).length,
    0,
  )
  const candidatesPending = record.knowledgeCandidates.filter((candidate) => candidate.status === 'pending').length
  return {
    understand: findingsOpen > 0 ? String(findingsOpen) : null,
    plan: record.modules.length > 0 ? String(record.modules.length) : null,
    implement: record.modules.length > 0 ? `${accepted}/${record.modules.length}` : null,
    review: reviewOpen > 0 ? String(reviewOpen) : null,
    deliver: record.releaseItems.length > 0 ? String(record.releaseItems.length) : null,
    retro: candidatesPending > 0 ? String(candidatesPending) : null,
  }
}

const BADGE_LABEL_KEY: Record<WorkbenchStage, Parameters<WorkbenchT>[0]> = {
  understand: 'badge.findingsOpen',
  plan: 'badge.modules',
  implement: 'badge.progress',
  review: 'badge.reviewOpen',
  deliver: 'badge.releaseItems',
  retro: 'badge.candidates',
}

/** The stage the advance button moves to; null = no control (no record / closed). */
function nextStageOf(stage: WorkbenchStage | 'closed'): WorkbenchStage | 'closed' | null {
  if (stage === 'closed') return null
  const index = WORKBENCH_STAGES.indexOf(stage)
  return index === WORKBENCH_STAGES.length - 1 ? 'closed' : WORKBENCH_STAGES[index + 1]!
}

export function WorkbenchTabBody(props: {
  t: WorkbenchT
  requirement: RequirementRecord
  slot: RequirementWorkbenchState
  controller: WorkbenchController
}): ReactNode {
  const { t, slot, controller } = props
  const requirementId = props.requirement.id
  const [viewing, setViewing] = useState<WorkbenchStage>('understand')
  // Follow the record's stage on first ready (and re-arm on requirement
  // switches); later refreshes never move the user's viewing choice.
  const syncedRef = useRef(false)
  useEffect(() => {
    syncedRef.current = false
    setViewing('understand')
  }, [requirementId])
  useEffect(() => {
    if (syncedRef.current || slot.phase !== 'ready') return
    syncedRef.current = true
    const stage = slot.record?.stage
    if (stage !== undefined && stage !== 'closed') setViewing(stage)
  }, [slot.phase, slot.record])

  const record = slot.record
  const stage: WorkbenchStage | 'closed' = record?.stage ?? 'understand'
  const badges = badgeCounts(slot)
  const nextStage = record === null ? null : nextStageOf(stage)

  const advance = (): void => {
    if (nextStage === null) return
    void controller.advanceStage(requirementId, nextStage).then((ok) => {
      if (ok && nextStage !== 'closed') setViewing(nextStage)
    })
  }

  return (
    <div className={styles.workbenchTab}>
      <div className={styles.stageRail} role="tablist" aria-label={t('workbench.railLabel')}>
        {WORKBENCH_STAGES.map((railStage, index) => (
          <Fragment key={railStage}>
            {index > 0 ? <span className={styles.stageConnector} aria-hidden="true" /> : null}
            <button
              type="button"
              role="tab"
              aria-selected={railStage === viewing}
              className={railStage === viewing ? `${styles.stageChip} ${styles.stageChipCurrent}` : styles.stageChip}
              onClick={() => { setViewing(railStage) }}
            >
              {t(STAGE_LABEL_KEY[railStage])}
              {badges[railStage] != null ? (
                <span className={styles.stageBadge}>{badges[railStage]} {t(BADGE_LABEL_KEY[railStage])}</span>
              ) : null}
            </button>
          </Fragment>
        ))}
      </div>

      {slot.phase === 'loading' ? <div className={styles.guideSection}><div className={styles.guideHint}>{t('page.loading')}</div></div> : null}
      {slot.phase === 'degraded' ? (
        <div className={styles.guideSection}>
          <div className={styles.guideTitle}>{t('page.degraded')}</div>
          <div className={styles.guideHint}>{t('page.degradedBackupHint')}</div>
        </div>
      ) : null}
      {slot.phase === 'load-error' ? <div className={styles.guideSection}><div className={styles.guideHint}>{t('page.loadError')}</div></div> : null}

      {slot.phase === 'ready' ? (
        <>
          {slot.banner !== undefined ? (
            <div className={styles.banner}>
              <div className={styles.bannerBody}>{t(bannerCodeToKey(slot.banner.code))}</div>
              <button type="button" className={styles.bannerDismiss} aria-label={t('finding.cancel')} onClick={() => { controller.dismissBanner(requirementId) }}>×</button>
            </div>
          ) : null}
          {stage === 'closed' ? <div className={styles.closedNotice}>{t('advance.closed')}</div> : null}
          <div className={styles.stageView} role="tabpanel" aria-label={t(STAGE_LABEL_KEY[viewing])}>
            {record === null ? (
              <div className={styles.guideSection}>
                <div className={styles.guideTitle}>{t(STAGE_LABEL_KEY[viewing])}</div>
                <div className={styles.guideHint}>{t(STAGE_HINT_KEY[viewing])}</div>
                {viewing === 'understand' ? <div className={styles.guideHint}>{t('empty.firstUseHint')}</div> : null}
              </div>
            ) : null}
            {viewing === 'understand' ? (
              <FindingsSection key={requirementId} t={t} slot={slot} controller={controller} requirementId={requirementId} />
            ) : null}
            {record !== null && viewing !== 'understand' ? (
              <div className={styles.guideSection}>
                <div className={styles.guideTitle}>{t(STAGE_LABEL_KEY[viewing])}</div>
                <div className={styles.guideHint}>{t(STAGE_HINT_KEY[viewing])}</div>
              </div>
            ) : null}
          </div>
          {nextStage !== null ? (
            <div className={styles.advanceRow}>
              <button type="button" className={styles.advanceButton} disabled={slot.busy} onClick={advance}>
                {nextStage === 'closed' ? t('advance.close') : `${t('advance.stage')} ${t(STAGE_LABEL_KEY[nextStage])}`}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/**
 * error.code → dictionary key. Exhaustive switch, no string synthesis — the
 * wire codes ('unreadable-file', 'not-found') and the camelCase dictionary
 * keys differ, and a template would silently mint nonexistent keys.
 */
function bannerCodeToKey(code: 'conflict' | 'network' | 'unreadable-file' | 'not-found' | 'bad-request' | 'internal'): Parameters<WorkbenchT>[0] {
  switch (code) {
    case 'conflict': return 'error.conflict'
    case 'network': return 'error.network'
    case 'unreadable-file': return 'error.unreadableFile'
    case 'not-found': return 'error.notFound'
    case 'bad-request': return 'error.internal'
    case 'internal': return 'error.internal'
  }
}

const FINDING_CATEGORIES = ['feasibility', 'conflict', 'compatibility', 'risk', 'capacity', 'other'] as const
const FINDING_SEVERITIES = ['high', 'medium', 'low'] as const

/**
 * S1 minimal manual loop: the findings list + the dashed add card / inline
 * form. Rendered whenever the understand stage is viewed, INCLUDING the
 * record-null first-use state — saveFinding is the record-MINTING entry
 * (the host creates the ledger row on the first action), so the empty state
 * must offer it, or a fresh requirement could never enter the workbench.
 * Keyed by requirementId at the render site: form drafts never cross a
 * requirement switch.
 */
function FindingsSection(props: {
  t: WorkbenchT
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  requirementId: string
}): ReactNode {
  const { t, slot, controller, requirementId } = props
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [category, setCategory] = useState<(typeof FINDING_CATEGORIES)[number]>('other')
  const [severity, setSeverity] = useState<(typeof FINDING_SEVERITIES)[number]>('medium')
  const findings = slot.record?.findings ?? []

  const submit = (): void => {
    if (title.trim().length === 0) return
    void controller.saveFinding(requirementId, {
      category, severity, title: title.trim(), detail, status: 'open',
    }).then((ok) => {
      if (ok) {
        setFormOpen(false)
        setTitle('')
        setDetail('')
      }
    })
  }

  return (
    <div className={styles.findingSection}>
      {findings.map((finding) => (
        <div key={finding.id} className={finding.status === 'open' ? styles.findingRow : `${styles.findingRow} ${styles.findingRowMuted}`}>
          <div className={styles.findingRowTitle}>{finding.title}</div>
          <div className={styles.findingRowMeta}>{t(`finding.category.${finding.category}`)} · {t(`finding.severity.${finding.severity}`)}</div>
        </div>
      ))}
      {formOpen ? (
        <div className={styles.findingForm}>
          <div className={styles.findingFormTitle}>{t('finding.addTitle')}</div>
          <label className={styles.findingField}>
            <span>{t('finding.titleLabel')}</span>
            {/* maxLength counts UTF-16 code units — the same unit as the
                host zod caps, so an over-cap input is unconstructible here
                instead of surfacing as a misleading 400 banner. */}
            <input value={title} maxLength={64} onChange={(event) => { setTitle(event.target.value) }} />
          </label>
          <label className={styles.findingField}>
            <span>{t('finding.detailLabel')}</span>
            <textarea rows={3} value={detail} maxLength={WORKBENCH_INLINE_MAX_CHARS} onChange={(event) => { setDetail(event.target.value) }} />
          </label>
          <div className={styles.findingFieldRow}>
            <label className={styles.findingField}>
              <span>{t('finding.categoryLabel')}</span>
              <select value={category} onChange={(event) => { setCategory(event.target.value as (typeof FINDING_CATEGORIES)[number]) }}>
                {FINDING_CATEGORIES.map((value) => <option key={value} value={value}>{t(`finding.category.${value}`)}</option>)}
              </select>
            </label>
            <label className={styles.findingField}>
              <span>{t('finding.severityLabel')}</span>
              <select value={severity} onChange={(event) => { setSeverity(event.target.value as (typeof FINDING_SEVERITIES)[number]) }}>
                {FINDING_SEVERITIES.map((value) => <option key={value} value={value}>{t(`finding.severity.${value}`)}</option>)}
              </select>
            </label>
          </div>
          <div className={styles.findingFormActions}>
            <button type="button" className={styles.ghostButton} onClick={() => { setFormOpen(false) }}>{t('finding.cancel')}</button>
            <button type="button" className={styles.primaryButton} disabled={title.trim().length === 0 || slot.busy} onClick={submit}>{t('finding.submit')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className={styles.addCard} onClick={() => { setFormOpen(true) }}>{t('finding.add')}</button>
      )}
    </div>
  )
}

/** Seat wiring: subscribes the store, pulls the controller on mount (P1a contract, grown to real data). */
export function createWorkbenchTabSeat(options: {
  t: WorkbenchT
  store: WorkbenchStore
  controller: WorkbenchController
}): (props: PropsRuntime<'requirements.detail.view'>) => ReactNode {
  const { t, store, controller } = options
  return (props) => <WorkbenchSeat t={t} store={store} controller={controller} requirement={props.requirement} />
}

function WorkbenchSeat(props: {
  t: WorkbenchT
  store: WorkbenchStore
  controller: WorkbenchController
  requirement: RequirementRecord
}): ReactNode {
  const state = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  useEffect(() => {
    void props.controller.open(props.requirement.id)
  }, [props.controller, props.requirement.id])
  return (
    <WorkbenchTabBody
      t={props.t}
      requirement={props.requirement}
      slot={slotFor(state, props.requirement.id)}
      controller={props.controller}
    />
  )
}
