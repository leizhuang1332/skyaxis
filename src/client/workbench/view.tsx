/**
 * AI workbench seat body (0006 P1b): the six-stage rail over the REAL ledger,
 * delegating each stage's view to its section component (S1 findings +
 * criteria / S2 breakdown / S3 board — second knife). The rail keeps the
 * honesty guard: badge counts render FROM THE DATA (zero/empty renders
 * nothing), the advance control renders for any non-closed record, and with
 * NO record the empty state guides the first action (the findings add-card
 * is the record-minting entry).
 *
 * Structure: WorkbenchTabBody takes the resolved slot snapshot + controller
 * (tests inject both directly); the seat wrapper subscribes to the store and
 * pulls the controller on mount (the P1a factory-owner contract, grown up).
 */
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchStage } from '../../workbench-shared/protocol.js'
import { WORKBENCH_STAGES } from '../../workbench-shared/protocol.js'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { WaitingFace } from '../waiting-tracker.js'
import type { KnowledgeSliceState, RequirementWorkbenchState, WorkbenchStore } from './store.js'
import { knowledgeFor, slotFor } from './store.js'
import { FindingsSection } from './findings-section.js'
import { CriteriaSection } from './criteria-section.js'
import { SplitSection } from './split-section.js'
import { BoardSection } from './board-section.js'
import { DeliverSection } from './deliver-section.js'
import { ReviewSection } from './review-section.js'
import { SessionStrip } from './session-strip.js'
import { KnowledgeSection } from './knowledge-section.js'
import { SowModal } from './sow-modal.js'
import type { DeliverFace } from './delivery.js'
import type { WorkbenchWorkPackage } from '../../workbench-shared/protocol.js'
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

/** Badge anchors: which count rides which chip (zero/empty → no badge). The
 *  plan chip upgrades to ✓ once the split is approved (research §4.1 rail
 *  badge spec: 拆分批准态 + 工作包数). */
function badgeCounts(slot: RequirementWorkbenchState): Partial<Record<WorkbenchStage, string | null>> {
  const record = slot.record
  if (record === null) return {}
  const findingsOpen = record.findings.filter((finding) => finding.status === 'open').length
  const active = record.workPackages.filter((workPackage) => workPackage.status !== 'dropped')
  const accepted = active.filter((workPackage) => workPackage.status === 'accepted').length
  // P4 semantic fix: "open" = confirmed AND undisposed — a rejected verdict
  // IS its own resolution (the pre-P4 count included them; zero producers
  // existed then, so no live behavior changed).
  const reviewOpen = record.reviewReports.reduce(
    (sum, report) => sum + report.verdicts.filter((verdict) => verdict.verdict === 'confirmed' && verdict.disposition === undefined).length,
    0,
  )
  const candidatesPending = record.knowledgeCandidates.filter((candidate) => candidate.status === 'pending').length
  return {
    understand: findingsOpen > 0 ? String(findingsOpen) : null,
    plan: record.workPackages.length > 0
      ? `${record.splitApprovedAt !== undefined ? '✓ ' : ''}${record.workPackages.length}`
      : null,
    implement: active.length > 0 ? `${accepted}/${active.length}` : null,
    review: reviewOpen > 0 ? String(reviewOpen) : null,
    deliver: record.releaseItems.length > 0 ? String(record.releaseItems.length) : null,
    retro: candidatesPending > 0 ? String(candidatesPending) : null,
  }
}

const BADGE_LABEL_KEY: Record<WorkbenchStage, Parameters<WorkbenchT>[0]> = {
  understand: 'badge.findingsOpen',
  plan: 'badge.workPackages',
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

/** The live-session summary face the strip/picker consume (register.tsx owns the real impl; tests inject). */
export interface SessionStripSummary {
  readonly id: string
  readonly displayTitle: string
  readonly running: boolean
  readonly blank: boolean
}

export interface WorkbenchSessionsFace {
  readonly ids: readonly string[]
  readonly summariesById: Readonly<Record<string, SessionStripSummary | undefined>>
  subscribe(listener: () => void): () => void
  navigate(sessionId: string): void
}

/** Module-level stable empty face (an inline literal would break getSnapshot identity). */
const EMPTY_SESSIONS: WorkbenchSessionsFace = { ids: [], summariesById: {}, subscribe: () => () => {}, navigate: () => {} }
const EMPTY_WAITING: ReadonlySet<string> = new Set<string>()
const EMPTY_WAITING_SUB = { subscribe: (): (() => void) => () => {} }

export function WorkbenchTabBody(props: {
  t: WorkbenchT
  requirement: RequirementRecord
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  /** Knowledge slice (requirement ∪ global view) for the S6 section + SOW modal. */
  knowledge: KnowledgeSliceState
  /** Optional live-session face — absent (jsdom / tests) ⇒ strip degrades honestly. */
  sessions?: WorkbenchSessionsFace
  /** Optional waiting-input face (P2b) — the fourth chip state. */
  waiting?: WaitingFace
  /** Optional SOW delivery face (P5a) — absent ⇒ the modal hides the delivery button. */
  deliver?: DeliverFace
}): ReactNode {
  const { t, slot, controller, knowledge } = props
  const requirementId = props.requirement.id
  // Live session summaries (zero-polling: the face's own subscribe drives
  // re-renders; absent face ⇒ stable empty snapshot, hooks never conditional).
  const sessionsFace = useSyncExternalStore(
    (listener) => (props.sessions ?? EMPTY_SESSIONS).subscribe(listener),
    () => props.sessions ?? EMPTY_SESSIONS,
  )
  const waitingIds = useSyncExternalStore(
    (listener) => (props.waiting ?? EMPTY_WAITING_SUB).subscribe(listener),
    () => props.waiting?.getSnapshot() ?? EMPTY_WAITING,
  )
  const [viewing, setViewing] = useState<WorkbenchStage>('understand')
  // SOW modal state — view-owned so every section entry shares one instance.
  const [sow, setSow] = useState<{ purpose: 'analysis' | 'split' | 'dev'; workPackage?: WorkbenchWorkPackage } | null>(null)
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
          {record !== null ? (
            <SessionStrip
              t={t}
              record={record}
              requirement={{ id: requirementId, title: props.requirement.title }}
              summaries={sessionsFace.ids.flatMap((id) => {
                const summary = sessionsFace.summariesById[id]
                return summary === undefined ? [] : [summary]
              })}
              waitingIds={waitingIds}
              navigableIds={sessionsFace.ids}
              onNavigate={(sessionId) => { sessionsFace.navigate(sessionId) }}
            />
          ) : null}
          <div className={styles.stageView} role="tabpanel" aria-label={t(STAGE_LABEL_KEY[viewing])}>
            {record === null ? (
              <div className={styles.guideSection}>
                <div className={styles.guideTitle}>{t(STAGE_LABEL_KEY[viewing])}</div>
                <div className={styles.guideHint}>{t(STAGE_HINT_KEY[viewing])}</div>
                {viewing === 'understand' ? <div className={styles.guideHint}>{t('empty.firstUseHint')}</div> : null}
              </div>
            ) : null}
            {viewing === 'understand' ? (
              <FindingsSection key={`findings-${requirementId}`} t={t} slot={slot} controller={controller} requirementId={requirementId} onOpenSow={() => { setSow({ purpose: 'analysis' }) }} />
            ) : null}
            {record !== null && viewing === 'understand' ? (
              <CriteriaSection key={`criteria-${requirementId}`} t={t} slot={slot} controller={controller} requirementId={requirementId} />
            ) : null}
            {record !== null && viewing === 'plan' ? (
              <SplitSection key={`split-${requirementId}`} t={t} slot={slot} controller={controller} requirementId={requirementId} onOpenSow={() => { setSow({ purpose: 'split' }) }} />
            ) : null}
            {record !== null && viewing === 'implement' ? (
              <BoardSection key={`board-${requirementId}`} t={t} slot={slot} controller={controller} requirementId={requirementId} sessions={sessionsFace} waitingIds={waitingIds} onOpenSow={(workPackage) => { setSow({ purpose: 'dev', workPackage }) }} />
            ) : null}
            {record !== null && viewing === 'retro' ? (
              <KnowledgeSection
                key={`knowledge-${requirementId}`}
                t={t}
                requirement={props.requirement}
                slot={slot}
                knowledge={knowledge}
                controller={controller}
                requirementId={requirementId}
              />
            ) : null}
            {record !== null && viewing === 'deliver' ? (
              <DeliverSection
                key={`deliver-${requirementId}`}
                t={t}
                requirement={props.requirement}
                slot={slot}
                controller={controller}
                requirementId={requirementId}
                sessions={sessionsFace}
              />
            ) : null}
            {record !== null && viewing === 'review' ? (
              <ReviewSection
                key={`review-${requirementId}`}
                t={t}
                slot={slot}
                controller={controller}
                requirementId={requirementId}
              />
            ) : null}
          </div>
          {nextStage !== null ? (
            <div className={styles.advanceRow}>
              <button type="button" className={styles.advanceButton} disabled={slot.busy} onClick={advance}>
                {nextStage === 'closed' ? t('advance.close') : `${t('advance.stage')} ${t(STAGE_LABEL_KEY[nextStage])}`}
              </button>
            </div>
          ) : null}
          <SowModal
            t={t}
            open={sow !== null}
            purpose={sow?.purpose ?? 'analysis'}
            requirement={props.requirement}
            record={record}
            knowledgeRecords={knowledge.records}
            revision={slot.revision}
            busy={slot.busy}
            workPackage={sow?.workPackage}
            deliver={props.deliver}
            onClose={() => { setSow(null) }}
          />
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
function bannerCodeToKey(code: 'conflict' | 'network' | 'unreadable-file' | 'not-found' | 'bad-request' | 'internal' | 'locked-split' | 'locked-version'): Parameters<WorkbenchT>[0] {
  switch (code) {
    case 'conflict': return 'error.conflict'
    case 'network': return 'error.network'
    case 'unreadable-file': return 'error.unreadableFile'
    case 'not-found': return 'error.notFound'
    case 'bad-request': return 'error.internal'
    case 'internal': return 'error.internal'
    case 'locked-split': return 'error.lockedSplit'
    case 'locked-version': return 'error.lockedVersion'
  }
}

/** Seat wiring: subscribes the store, pulls the controller on mount (P1a contract, grown to real data). */
export function createWorkbenchTabSeat(options: {
  t: WorkbenchT
  store: WorkbenchStore
  controller: WorkbenchController
  /** Live-session face from register.tsx (optional — absent in jsdom/tests). */
  sessions?: WorkbenchSessionsFace
  /** Waiting-input face (P2b, optional). */
  waiting?: WaitingFace
  /** SOW delivery face (P5a, optional — absent without the conversation shell). */
  deliver?: DeliverFace
}): (props: PropsRuntime<'requirements.detail.view'>) => ReactNode {
  const { t, store, controller, sessions, waiting, deliver } = options
  return (props) => <WorkbenchSeat t={t} store={store} controller={controller} requirement={props.requirement} sessions={sessions} waiting={waiting} deliver={deliver} />
}

function WorkbenchSeat(props: {
  t: WorkbenchT
  store: WorkbenchStore
  controller: WorkbenchController
  requirement: RequirementRecord
  sessions?: WorkbenchSessionsFace
  waiting?: WaitingFace
  deliver?: DeliverFace
}): ReactNode {
  const state = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  useEffect(() => {
    void props.controller.open(props.requirement.id)
    void props.controller.openKnowledge(props.requirement.id, props.requirement.workspacePath)
  }, [props.controller, props.requirement.id, props.requirement.workspacePath])
  return (
    <WorkbenchTabBody
      t={props.t}
      requirement={props.requirement}
      slot={slotFor(state, props.requirement.id)}
      controller={props.controller}
      knowledge={knowledgeFor(state, props.requirement.id)}
      sessions={props.sessions}
      waiting={props.waiting}
      deliver={props.deliver}
    />
  )
}
