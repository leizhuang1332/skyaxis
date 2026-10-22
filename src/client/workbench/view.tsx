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
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchRecord, WorkbenchStage } from '../../workbench-shared/protocol.js'
import type { SeedMissingReason } from '../../workbench-shared/protocol.js'
import { WORKBENCH_STAGES } from '../../workbench-shared/protocol.js'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { WaitingFace } from '../waiting-tracker.js'
import type { KnowledgeSliceState, RequirementWorkbenchState, WorkbenchStore } from './store.js'
import { knowledgeFor, slotFor } from './store.js'
import { FindingsSection } from './findings-section.js'
import { CriteriaSection } from './criteria-section.js'
import { ProposalsTriptych } from './proposals-triptych.js'
import { ReportSection } from './report-section.js'
import { RequirementDocSection } from './requirement-doc-section.js'
import { SplitSection, splitCoverageStats } from './split-section.js'
import { SplitProposals } from './split-proposals.js'
import { WorkspaceDocSection } from './doc-section.js'
import { planningDocRelPath, splitResultRelPath } from '../../workbench-shared/protocol.js'
import { BoardSection } from './board-section.js'
import { ExecutionSection } from './execution-section.js'
import { InboxSection } from './inbox-section.js'
import { DeliverSection } from './deliver-section.js'
import { ReviewSection } from './review-section.js'
import { KnowledgeSection } from './knowledge-section.js'
import { SowModal } from './sow-modal.js'
import { ReworkModal } from './rework-modal.js'
import { devTitleBindTargets } from './dev-watcher.js'
import { ScanModal } from './scan-modal.js'
import { SheetExportModal } from './sheet-export-modal.js'
import { buildUnderstandingSheet } from './understanding-sheet.js'
import type { DeliverFace, SendMessageFace } from './delivery.js'
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
  // P4 semantic fix + P5b: "open" = a proposed row (AI finding awaiting the
  // user's ruling) OR a confirmed-and-undisposed row. A rejected verdict IS
  // its own resolution, and a confirmed+disposed row is done. Before P5b
  // proposed rows didn't exist, so the count was confirmed-undisposed only;
  // the AI-seeded rows are exactly the ones the user most needs surfaced on
  // the rail (§4.1「④未处置评审发现数」).
  const reviewOpen = record.reviewReports.reduce(
    (sum, report) => sum + report.verdicts.filter((verdict) =>
      verdict.verdict === 'proposed' || (verdict.verdict === 'confirmed' && verdict.disposition === undefined)).length,
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

/**
 * 0007 定稿软门: S1 readiness derivations — render-time, all from the LIVE
 * ledger (the credential snapshot is an anchor for stale compare, never the
 * content source). The finalize itself stays a pure pointer-independent
 * content event: advancing the stage neither requires nor triggers it.
 */
function understandReadiness(record: WorkbenchRecord): {
  pending: number
  unanswered: number
  openFindings: number
  stageReady: boolean
  finalized: boolean
  changedSinceFinalize: boolean
  exportable: boolean
} {
  const analysis = record.analysis
  const clarifications = analysis?.clarifications ?? []
  const unanswered = clarifications.filter((row) => row.answer === undefined).length
  const openFindings = record.findings.filter((finding) => finding.status === 'open').length
  const finalized = record.understandApprovedAt !== undefined
  // Post-finalize drift hint — COUNT-level compare only: a text edit to a
  // criterion stays undetected (the honest lower bound; the contract-grade
  // compare lives in the S2 stale arms). A NEWER seed (a re-analysis landed
  // after finalizing) is upstream change too.
  const baseline = record.understandBaseline
  const changedSinceFinalize = finalized && baseline !== undefined && (
    baseline.criteria.length !== record.criteria.length
    || baseline.findings.filter((finding) => finding.status !== 'open').length !== record.findings.length - openFindings
    || baseline.clarifications.length !== clarifications.length - unanswered
    || (analysis?.seed !== undefined && analysis.seed.seededAt > (record.understandApprovedAt ?? ''))
  )
  return {
    pending: (analysis?.findings.length ?? 0) + (analysis?.criteria.length ?? 0),
    unanswered,
    openFindings,
    stageReady: analysis?.seed?.stageReady === true,
    finalized,
    changedSinceFinalize,
    exportable: record.criteria.length > 0 || record.findings.length > 0 || clarifications.length > 0,
  }
}

/**
 * 布局重塑轮: the S1 next-move derivation — exactly one primary action per
 * state, in reading order = operation order (sow → adjudicate → finalize →
 * advance). Advisory only: the soft gate never blocks, so 'adjudicate'
 * shapes the primary, it does not hide 定稿 (a human may rule "proceed with
 * known risks" — 0007's standing contract).
 */
function understandNextAction(analysis: WorkbenchRecord['analysis'] | undefined, readiness: { pending: number; unanswered: number; finalized: boolean }): 'sow' | 'adjudicate' | 'finalize' | 'advance' {
  if (analysis === undefined) return 'sow'
  if (readiness.pending + readiness.unanswered > 0) return 'adjudicate'
  if (!readiness.finalized) return 'finalize'
  return 'advance'
}

/**
 * 布局轮: the S2 next-move derivation — the understandNextAction pattern on
 * S2's two-flow lifecycle (planning adopt → split adjudicate → approve →
 * advance). Advisory only, same as S1: neither hard gate blocks anything
 * here, the tier just shapes which button fills. 采纳规划 never fills —
 * whether the planning doc has landed is IO state the record cannot express
 * (the ack modal's probe owns that disclosure).
 */
function planNextAction(record: WorkbenchRecord): 'sowPlan' | 'sowSplit' | 'adjudicate' | 'approve' | 'advance' {
  if (record.planAdoptedAt === undefined) return 'sowPlan'
  if (record.splitApprovedAt !== undefined) return 'advance'
  if ((record.splitProposals?.workPackages.length ?? 0) > 0) return 'adjudicate'
  if (record.workPackages.length > 0) return 'approve'
  return 'sowSplit'
}

/** The live-session summary face the dialog/picker/inbox/execution consume (register.tsx owns the real impl; tests inject; ex SessionStripSummary — strip retired 0017). */
export interface WorkbenchSessionSummary {
  readonly id: string
  readonly displayTitle: string
  readonly running: boolean
  readonly blank: boolean
  /** 0024 修订#2: the session's working directory (host list rows carry it —
   *  cold rows without one are dropped host-side). Powers the review-import
   *  candidate scoping to the requirement's workspace. */
  readonly cwd?: string
}

export interface WorkbenchSessionsFace {
  readonly ids: readonly string[]
  readonly summariesById: Readonly<Record<string, WorkbenchSessionSummary | undefined>>
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
  /** 0019 rework-note send face — absent ⇒ the rework modal hides its send button. */
  sendToSession?: SendMessageFace
}): ReactNode {
  const { t, slot, controller, knowledge } = props
  const requirementId = props.requirement.id
  // Live session summaries (zero-polling: the face's own subscribe drives
  // re-renders). The face OBJECT is identity-stable (register builds it once
  // and its getters read live data), so it cannot serve as the store snapshot
  // directly — React bails out on an unchanged getSnapshot. The snapshot is
  // therefore a derived VALUE: the serialized summaries map, stable while
  // nothing changed and a fresh string on every running/blank flip (the
  // 回传轮 watcher depends on those flips). Absent face ⇒ constant ''.
  const sessionsFace = props.sessions ?? EMPTY_SESSIONS
  const summariesTick = useSyncExternalStore(
    (listener) => sessionsFace.subscribe(listener),
    () => (props.sessions === undefined ? '' : JSON.stringify(sessionsFace.summariesById)),
  )
  const sessionSummaries = useMemo(
    () => summariesTick === ''
      ? { ids: [] as readonly string[], byId: {} as WorkbenchSessionsFace['summariesById'] }
      : { ids: sessionsFace.ids, byId: sessionsFace.summariesById },
    [summariesTick, sessionsFace],
  )
  const waitingIds = useSyncExternalStore(
    (listener) => (props.waiting ?? EMPTY_WAITING_SUB).subscribe(listener),
    () => props.waiting?.getSnapshot() ?? EMPTY_WAITING,
  )
  const [viewing, setViewing] = useState<WorkbenchStage>('understand')
  // 0016 P1b: the execution-view WP (null = board visible; non-null = exec view)
  const [executionView, setExecutionView] = useState<WorkbenchWorkPackage | null>(null)
  // SOW modal state — view-owned so every section entry shares one instance.
  const [sow, setSow] = useState<{ purpose: 'analysis' | 'plan' | 'split' | 'consolidate' | 'dev' | 'review' | 'wp-plan'; workPackage?: WorkbenchWorkPackage } | null>(null)
  // 0019: rework-note modal target (wpId — resolved against the LIVE record
  // at render, so the board's await-ok followup opens it with the just-
  // recorded fail acceptance already in place).
  const [reworkId, setReworkId] = useState<string | null>(null)
  // 挂账轮: artifact-reconciliation modal — view-owned like the SOW instance;
  // phase-independent entry (the scan's data source is the endpoint, not the
  // slot — honesty means surfacing its own failures, not hiding the button).
  const [scanOpen, setScanOpen] = useState(false)
  // 0007 定稿软门 — S1 收口面 state (view-owned like the sow/scan instances).
  const [understandApproveOpen, setUnderstandApproveOpen] = useState(false)
  const [understandApproveAck, setUnderstandApproveAck] = useState(false)
  const [understandRevokeOpen, setUnderstandRevokeOpen] = useState(false)
  const [understandRevokeAck, setUnderstandRevokeAck] = useState(false)
  const [understandExportOpen, setUnderstandExportOpen] = useState(false)
  // 0008: the ack modal's doc-presence disclosure. docHash is minted AT
  // finalize, so it cannot be read off the baseline (empty on first
  // finalize) — the modal probes the file itself on open (the report-section
  // existence-fetch precedent; probing ⇒ row not rendered yet).
  const [understandAckDoc, setUnderstandAckDoc] = useState<'probing' | 'doc' | 'no-doc'>('probing')
  useEffect(() => {
    if (!understandApproveOpen) {
      setUnderstandAckDoc('probing')
      return undefined
    }
    const abort = new AbortController()
    setUnderstandAckDoc('probing')
    void controller.requirementDocContent(requirementId, abort.signal).then((result) => {
      if (abort.signal.aborted) return
      setUnderstandAckDoc(result !== undefined && result.kind === 'ok' ? 'doc' : 'no-doc')
    })
    return () => { abort.abort() }
  }, [understandApproveOpen, controller, requirementId])
  // 布局轮（S2 溶解 PlanningSection 上提）: the planning adopt-ack's
  // doc-presence probe — the understand probe's twin (probing ⇒ row not
  // rendered; no-workspace arm answers no-doc without fetching).
  const [planAdoptOpen, setPlanAdoptOpen] = useState(false)
  const [planAdoptAck, setPlanAdoptAck] = useState(false)
  const [planRevokeOpen, setPlanRevokeOpen] = useState(false)
  const [planRevokeAck, setPlanRevokeAck] = useState(false)
  const [splitRevokeOpen, setSplitRevokeOpen] = useState(false)
  const [splitRevokeAck, setSplitRevokeAck] = useState(false)
  const [planAckDoc, setPlanAckDoc] = useState<'probing' | 'doc' | 'no-doc'>('probing')
  const planWorkspacePath = props.requirement.workspacePath.trim()
  useEffect(() => {
    if (!planAdoptOpen || planWorkspacePath === '') {
      setPlanAckDoc('probing')
      return undefined
    }
    const abort = new AbortController()
    setPlanAckDoc('probing')
    void controller.planningDocContent(requirementId, abort.signal).then((result) => {
      if (abort.signal.aborted) return
      setPlanAckDoc(result !== undefined && result.kind === 'ok' ? 'doc' : 'no-doc')
    })
    return () => { abort.abort() }
  }, [planAdoptOpen, controller, requirementId, planWorkspacePath])
  // Follow the record's stage on first ready (and re-arm on requirement
  // switches); later refreshes never move the user's viewing choice.
  const syncedRef = useRef(false)
  useEffect(() => {
    syncedRef.current = false
    setViewing('understand')
    setExecutionView(null)
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
  // 0007 定稿软门 derivations (render-time; null = no record — honest absence).
  const readiness = record === null ? null : understandReadiness(record)
  // 布局重塑轮: the S1 primary-action tier — null off-stage (other stages
  // keep the shared advanceButton look).
  const understandNext = readiness === null || record === null || viewing !== 'understand' ? null : understandNextAction(record.analysis, readiness)
  // 布局轮: the S2 primary-action tier (null off-stage).
  const planNext = record === null || viewing !== 'plan' ? null : planNextAction(record)
  const understandAckStats = readiness === null || record === null ? '' : [
    t('understand.statCriteria').replaceAll('{n}', String(record.criteria.length)),
    t('understand.statFindings')
      .replaceAll('{d}', String(record.findings.length - readiness.openFindings))
      .replaceAll('{o}', String(readiness.openFindings)),
    t('understand.statClarifications')
      .replaceAll('{a}', String((record.analysis?.clarifications?.length ?? 0) - readiness.unanswered))
      .replaceAll('{u}', String(readiness.unanswered)),
    t('understand.statProposals').replaceAll('{n}', String(readiness.pending)),
  ].join(' · ')

  // 回传轮 watcher: the bound analysis session's report lands on S1 without
  // any manual import step. Derivations are RENDER-time (the sessions face is
  // a stable object — its flips reach this component as re-renders, so the
  // booleans below are the honest deps). `due` = the anchor does not yet name
  // the bound session (never seeded, or a re-delivery swapped the pointer);
  // `gateOpen` = read now — an absent summary (face gone / pre-list) allows a
  // mount catch-up, a present one requires !running && !blank (a blank
  // session has nothing to read; the waiting state stays running=true by the
  // sessionChipState contract, so effect B re-arms naturally).
  const analysis = record?.analysis
  const analysisSessionId = analysis?.session.sessionId
  const analysisSummary = analysisSessionId !== undefined ? sessionSummaries.byId[analysisSessionId] : undefined
  const analysisRunning = analysisSummary?.running === true
  const analysisDue = analysis !== undefined && analysis.seed?.sessionId !== analysisSessionId
  // 文件交付轮 deadlock kill: with a bound workspace the report FILE is the
  // collection source — the seed read is a cheap, zero-write disk stat that
  // does not care whether the bound session is blank (the blank-shell gate
  // could stay closed forever, the a8f5142 挂账 suspicion). RUNNING still
  // closes the gate on BOTH channels (never seed mid-run); the idle flip
  // re-opens it and re-runs the watcher effect (analysisRunning is a dep).
  const fileChannelArmed = props.requirement.workspacePath.trim() !== ''
  const analysisGateOpen = !analysisRunning
    && (fileChannelArmed || analysisSummary === undefined || !analysisSummary.blank)
  const seedAttemptedRef = useRef(false)
  // 回传轮 observability: the LAST seed attempt's zero-write reason (+ scan
  // fingerprint) — shown on the waiting row so「not written yet」and「written
  // but unreadable」are distinguishable (the silent path was the blind spot).
  const [seedMiss, setSeedMiss] = useState<SeedMissingReason | undefined>(undefined)
  const [seedScan, setSeedScan] = useState<string | undefined>(undefined)
  const runSeed = (): void => {
    if (analysisSessionId === undefined) return
    void controller.seedAnalysisQuiet(requirementId, analysisSessionId).then((outcome) => {
      setSeedMiss(outcome?.miss)
      setSeedScan(outcome?.scan)
      // 回传轮 legacy shell repair: anchor-less binds (pre-repair deliveries)
      // hit the shell with no server-side content address. The delivered SOW
      // becomes the conversation session's auto-TITLE (first user message) —
      // so a title-prefix match over the live list rebinds to the real
      // session; the pointer swap re-arms the watcher, which re-seeds. Guard:
      // only when the candidate differs (terminates after one hop).
      if (outcome?.miss === 'no-declare-block' && outcome.shell === true
        && record?.analysis?.session.anchor === undefined) {
        // 0021 渲染轮: 标题去品牌——新形为主，legacy 前缀臂保住在途旧标题会话。
        const prefixes = ['# 分析任务书', '# skyaxis 分析任务书']
        const candidates = sessionSummaries.ids
          .map((id) => sessionSummaries.byId[id])
          .filter((summary): summary is NonNullable<typeof summary> => summary !== undefined && prefixes.some((prefix) => summary.displayTitle.startsWith(prefix)))
        const preferred = candidates.find((summary) => summary.displayTitle.includes(props.requirement.title)) ?? candidates.at(-1)
        if (preferred !== undefined && preferred.id !== analysisSessionId) {
          void controller.bindAnalysisSession(requirementId, preferred.id)
        }
      }
    })
  }
  useEffect(() => {
    // A new requirement view or a re-delivery (pointer swap) re-arms the
    // one-shot attempt flag.
    seedAttemptedRef.current = false
    setSeedMiss(undefined)
    setSeedScan(undefined)
  }, [requirementId, analysisSessionId])
  useEffect(() => {
    // Observed running=true ⇒ a later idle flip means a FRESH report may
    // exist — give this session a second seed attempt even in one mount.
    if (analysisRunning) seedAttemptedRef.current = false
  }, [analysisRunning])
  useEffect(() => {
    if (!analysisDue || !analysisGateOpen || analysisSessionId === undefined) return
    if (seedAttemptedRef.current) return
    seedAttemptedRef.current = true
    runSeed()
    // analysisRunning rides the deps for the FILE channel: its gate no longer
    // transitions on idle flips (armed workspaces keep it open), so the
    // running→idle edge itself must re-run this effect (the running=true
    // effect above has re-armed the one-shot flag by then).
  }, [requirementId, analysisSessionId, analysisDue, analysisGateOpen, analysisRunning, controller])
  /** Manual re-arm (回传轮 diagnosis ②): a failed read consumes the one-shot
   *  flag and a FINISHED session never flips running again — the waiting hint
   *  doubles as the retry entry (reset the flag, re-fire the quiet seed). */
  const retryAnalysisSeed = (): void => {
    seedAttemptedRef.current = false
    runSeed()
  }

  // 0012 拆分结果 watcher — the analysis watcher's LEAN twin: the result FILE
  // is the only channel (no session-log fallback, hence no shell repair and
  // no title-prefix rebind); RUNNING still closes the gate (never seed
  // mid-run), the idle flip re-arms, and the miss advisory rides the same
  // waiting row (the observability discipline).
  const splitProposals = record?.splitProposals
  const splitSessionId = splitProposals?.session.sessionId
  const splitSummary = splitSessionId !== undefined ? sessionSummaries.byId[splitSessionId] : undefined
  const splitRunning = splitSummary?.running === true
  const splitDue = splitProposals !== undefined && splitProposals.seed?.sessionId !== splitSessionId
  const [splitSeedMiss, setSplitSeedMiss] = useState<SeedMissingReason | undefined>(undefined)
  const splitSeedAttemptedRef = useRef(false)
  const runSplitSeed = (): void => {
    if (splitSessionId === undefined) return
    void controller.seedSplitQuiet(requirementId, splitSessionId).then((outcome) => {
      setSplitSeedMiss(outcome?.miss)
    })
  }
  useEffect(() => {
    splitSeedAttemptedRef.current = false
    setSplitSeedMiss(undefined)
  }, [requirementId, splitSessionId])
  useEffect(() => {
    if (splitRunning) splitSeedAttemptedRef.current = false
  }, [splitRunning])
  useEffect(() => {
    if (!splitDue || splitRunning || splitSessionId === undefined) return
    if (splitSeedAttemptedRef.current) return
    splitSeedAttemptedRef.current = true
    runSplitSeed()
  }, [requirementId, splitSessionId, splitDue, splitRunning, controller])
  const retrySplitSeed = (): void => {
    splitSeedAttemptedRef.current = false
    runSplitSeed()
  }

  // 0018 wp-plan watcher — the split watcher's per-WP twin: the plan FILE is
  // the only channel; the planSeed.session pointer (the delivery callback's
  // record) arms it and the hash stamp disarms it. RUNNING of the delivery
  // session closes the gate (never seed mid-run), the idle flip re-arms the
  // one-shot (the fresh-plan case); mount catch-up covers the
  // finished-before-open case. 刀一 keeps the miss silent (a zero-write 200,
  // safe to drop) — the disclosure row is 刀二's source-session line.
  const wpPlanSeedAttemptedRef = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    wpPlanSeedAttemptedRef.current = new Set()
  }, [requirementId])
  useEffect(() => {
    if (slot.phase !== 'ready' || record === null) return
    for (const workPackage of record.workPackages) {
      if (workPackage.status === 'dropped') continue
      const seed = workPackage.planSeed
      if (seed?.session === undefined || seed.contentHash !== undefined) continue
      if (sessionSummaries.byId[seed.session.sessionId]?.running === true) {
        // Observed running ⇒ re-arm this WP's one-shot (an idle flip may
        // carry the fresh plan file).
        if (wpPlanSeedAttemptedRef.current.has(workPackage.id)) {
          const next = new Set(wpPlanSeedAttemptedRef.current)
          next.delete(workPackage.id)
          wpPlanSeedAttemptedRef.current = next
        }
        continue
      }
      if (wpPlanSeedAttemptedRef.current.has(workPackage.id)) continue
      const next = new Set(wpPlanSeedAttemptedRef.current)
      next.add(workPackage.id)
      wpPlanSeedAttemptedRef.current = next
      void controller.seedWpPlanQuiet(requirementId, workPackage.id)
    }
  }, [slot.phase, record, requirementId, controller, sessionSummaries])

  // 0016 刀一验收修正: title-addressed dev-session binding — fires on every
  // sessions flip (the real session's fallback title lands a beat after the
  // user sends; the flip re-runs this pass). Pure join (devTitleBindTargets)
  // + one bounded bind per (WP, session); the register watcher's sweep runs
  // the same join for requirements nobody is watching.
  const devBindAttemptedRef = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    devBindAttemptedRef.current = new Set()
  }, [requirementId])
  useEffect(() => {
    if (slot.phase !== 'ready' || record === null) return
    for (const target of devTitleBindTargets(record, { ids: sessionSummaries.ids, summariesById: sessionSummaries.byId })) {
      const key = `${target.workPackageId}:${target.sessionId}`
      if (devBindAttemptedRef.current.has(key)) continue
      const next = new Set(devBindAttemptedRef.current)
      next.add(key)
      devBindAttemptedRef.current = next
      void controller.bindDevSession(requirementId, target.workPackageId, target.sessionId)
    }
  }, [slot.phase, record, requirementId, controller, sessionSummaries])

  // 0016 P1a: dev-declare mount catch-up — the REGISTER-level watcher (see
  // register.tsx / dev-watcher.ts) covers session flips globally; this is the
  // per-WP one-shot for a tab opened after a missed sweep (the analysis
  // watcher's mount-catch-up shape). RUNNING WPs skip (never seed mid-run);
  // a running→idle transition re-arms the flag (the fresh-declaration case
  // the register watcher also handles — belt and suspenders, both zero-write
  // when the endpoint anchor already covers the text).
  const devSeedAttemptedRef = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    devSeedAttemptedRef.current = new Set()
  }, [requirementId])
  useEffect(() => {
    if (slot.phase !== 'ready' || record === null) return
    for (const workPackage of record.workPackages) {
      if (workPackage.status === 'dropped') continue
      const binding = [...workPackage.sessions].reverse().find((row) => row.purpose === 'dev')
      if (binding === undefined) continue
      if (sessionSummaries.byId[binding.sessionId]?.running === true) {
        // Observed running ⇒ re-arm this WP's one-shot (an idle flip may
        // carry a fresh declaration).
        if (devSeedAttemptedRef.current.has(workPackage.id)) {
          const next = new Set(devSeedAttemptedRef.current)
          next.delete(workPackage.id)
          devSeedAttemptedRef.current = next
        }
        continue
      }
      const slotRow = record.devDeclares?.[workPackage.id]
      if (slotRow !== undefined && slotRow.seed.sessionId === binding.sessionId && slotRow.adjudication === 'pending') continue
      if (devSeedAttemptedRef.current.has(workPackage.id)) continue
      const next = new Set(devSeedAttemptedRef.current)
      next.add(workPackage.id)
      devSeedAttemptedRef.current = next
      void controller.seedDevDeclareQuiet(requirementId, workPackage.id)
    }
  }, [slot.phase, record, requirementId, controller, sessionSummaries])

  // 0024 D2-A: review-report mount catch-up — the REGISTER-level watcher (see
  // register.tsx / review-watcher.ts) covers session flips globally; this is
  // the one-shot for a tab opened after a missed sweep (the dev mount
  // catch-up's shape, requirement-granular). RUNNING skips (never read
  // mid-run); a running→idle transition re-arms (the follow-up-turn case).
  // Belt and suspenders — both zero-write when the idempotency anchor
  // already covers the text.
  const reviewSessionBinding = record?.reviewSession
  const reviewSeedAttemptedRef = useRef(false)
  useEffect(() => {
    reviewSeedAttemptedRef.current = false
  }, [requirementId, reviewSessionBinding?.sessionId])
  useEffect(() => {
    if (sessionSummaries.byId[reviewSessionBinding?.sessionId ?? '']?.running === true) {
      reviewSeedAttemptedRef.current = false
    }
  }, [sessionSummaries, reviewSessionBinding?.sessionId])
  useEffect(() => {
    if (slot.phase !== 'ready' || record === null) return
    if (reviewSessionBinding === undefined) return
    if (sessionSummaries.byId[reviewSessionBinding.sessionId]?.running === true) return
    if (reviewSeedAttemptedRef.current) return
    reviewSeedAttemptedRef.current = true
    void controller.autoImportReview(requirementId, reviewSessionBinding.sessionId, slot.revision)
  }, [slot.phase, slot.revision, record, requirementId, reviewSessionBinding, sessionSummaries, controller])

  const advance = (): void => {
    if (nextStage === null) return
    void controller.advanceStage(requirementId, nextStage).then((ok) => {
      if (ok && nextStage !== 'closed') setViewing(nextStage)
    })
  }

  // 0016 P1c D11-A: focus/visibility 台账刷新——切回 tab 或窗口获焦时重拉当前
  // 需求的台账，看板对新数据不再依赖写动作自愈。30s 节流共享 demand（短窗口
  // 内的连续切换只触发一次重拉——单用户本地成本极低但也不白给）。
  const lastFocusRefreshRef = useRef(0)
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastFocusRefreshRef.current < 30_000) return
      lastFocusRefreshRef.current = now
      void controller.open(requirementId)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [controller, requirementId])

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

      <div className={styles.railMeta}>
        <button type="button" className={styles.ghostButton} onClick={() => { setScanOpen(true) }}>{t('scan.button')}</button>
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
          {/* 0017 修订：跨阶段会话条退役（用户裁定——append-only 绑定随 v3 投递
              即绑持续累积成「chip 墙」）；会话入口收敛为 WP 详情会话行 + 收件箱
              「跳会话」+ 执行视图「跳宿主会话」。 */}
          <div className={styles.stageView} role="tabpanel" aria-label={t(STAGE_LABEL_KEY[viewing])}>
            {record === null ? (
              <div className={styles.guideSection}>
                <div className={styles.guideTitle}>{t(STAGE_LABEL_KEY[viewing])}</div>
                <div className={styles.guideHint}>{t(STAGE_HINT_KEY[viewing])}</div>
                {viewing === 'understand' ? <div className={styles.guideHint}>{t('empty.firstUseHint')}</div> : null}
              </div>
            ) : null}
            {record === null && viewing === 'understand' ? (
              <div className={styles.triptychBar}>
                {/* 建账前入口（布局重塑轮）：此按钮曾由 FindingsSection 携带；三栏区
                    record 守卫（view.spec 的 null 态诚实正则不许「待裁决」字样提前出现），
                    入口迁至 guide 下方保持可达。 */}
                <button type="button" className={styles.primaryButton} disabled={slot.busy} onClick={() => { setSow({ purpose: 'analysis' }) }}>{t('sow.analysisButton')}</button>
              </div>
            ) : null}
            {record !== null && viewing === 'understand' && readiness !== null ? (
              <div key={`understand-${requirementId}`} className={styles.triptychZone}>
                {/* 布局重塑轮：阅读顺序 = 操作顺序——待裁决三栏压过报告/文档置顶；
                    旧 gonogo 计数行解散，p/q 计数改为三栏栏头角标（f 走 rail 角标）。 */}
                <div className={styles.triptychBar}>
                  <span className={styles.triptychBarTitle}>{t('triptych.title')}</span>
                  {readiness.finalized ? (
                    <>
                      <Tag tone="success">{t('understand.approvedTag')}</Tag>
                      <span className={styles.gonogoText}>
                        {t('understand.approvedAtPrefix')} · {record.understandApprovedAt?.slice(0, 10)}
                        {readiness.changedSinceFinalize ? ` —— ${t('understand.bannerChanged')}` : ''}
                      </span>
                    </>
                  ) : null}
                  {readiness.stageReady ? <Tag tone="success">{t('understand.stageReadyTag')}</Tag> : null}
                  <span className={styles.triptychSpacer} />
                  {readiness.finalized ? (
                    <button
                      type="button"
                      className={`${styles.ghostButton} ${styles.dangerButton}`}
                      disabled={slot.busy}
                      onClick={() => { setUnderstandRevokeOpen(true); setUnderstandRevokeAck(false) }}
                    >
                      {t('understand.revoke')}
                    </button>
                  ) : null}
                  {/* 常驻：重投递入口不随会话绑定而消失；下一步是它时实心。 */}
                  <button
                    type="button"
                    className={understandNext === 'sow' ? styles.primaryButton : styles.ghostButton}
                    disabled={slot.busy}
                    onClick={() => { setSow({ purpose: 'analysis' }) }}
                  >
                    {t('sow.analysisButton')}
                  </button>
                </div>
                {readiness.stageReady ? (
                  <div className={styles.formHint}>{t('declare.stageReadyProposal')}</div>
                ) : null}
                <ProposalsTriptych
                  key={`triptych-${requirementId}`}
                  t={t}
                  slot={slot}
                  controller={controller}
                  requirementId={requirementId}
                  onRetrySeed={retryAnalysisSeed}
                  seedMiss={analysisDue ? seedMiss : undefined}
                  seedScan={analysisDue ? seedScan : undefined}
                />
              </div>
            ) : null}
            {viewing === 'understand' ? (
              <div className={styles.understandDocsRow}>
                <ReportSection key={`report-${requirementId}`} t={t} controller={controller} requirementId={requirementId} workspacePath={props.requirement.workspacePath.trim()} />
                <RequirementDocSection key={`reqdoc-${requirementId}`} t={t} controller={controller} requirementId={requirementId} workspacePath={props.requirement.workspacePath.trim()} headerExtra={record !== null ? (
                  <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { setSow({ purpose: 'consolidate' }) }}>{t('understand.consolidateButton')}</button>
                ) : undefined} />
              </div>
            ) : null}
            {viewing === 'understand' ? (
              <div className={styles.understandLedgerRow}>
                <FindingsSection key={`findings-${requirementId}`} t={t} slot={slot} controller={controller} requirementId={requirementId} />
                {record !== null ? (
                  <CriteriaSection key={`criteria-${requirementId}`} t={t} slot={slot} controller={controller} requirementId={requirementId} />
                ) : null}
              </div>
            ) : null}
            {record !== null && viewing === 'plan' ? (
              <div key={`plan-${requirementId}`} className={styles.triptychZone}>
                {/* 布局轮（拍板②全收顶栏）：两流状态 Tag + 撤销 danger + 双任务书常驻
                    （重投递可达），按 planNextAction 分层实心；采纳规划恒 ghost——文档
                    是否落盘是 IO 态，record 推不出（ack modal 探测语义保留）。 */}
                <div className={styles.triptychBar}>
                  {record.planAdoptedAt !== undefined ? (
                    <>
                      <Tag tone="success">{t('planning.adoptedTag')}</Tag>
                      <span className={styles.gonogoText}>{t('planning.adoptedAtPrefix')} {record.planAdoptedAt.slice(0, 10)}</span>
                    </>
                  ) : null}
                  {record.splitApprovedAt !== undefined ? (
                    <>
                      <Tag tone="success">{t('split.approvedTag')}</Tag>
                      <span className={styles.gonogoText}>{t('split.approvedAtPrefix')} {record.splitApprovedAt.slice(0, 10)} · {splitCoverageStats(record, t)}</span>
                    </>
                  ) : null}
                  <span className={styles.triptychSpacer} />
                  {record.planAdoptedAt !== undefined ? (
                    <button
                      type="button"
                      className={`${styles.ghostButton} ${styles.dangerButton}`}
                      disabled={slot.busy}
                      onClick={() => { setPlanRevokeOpen(true); setPlanRevokeAck(false) }}
                    >
                      {t('planning.revokeButton')}
                    </button>
                  ) : (
                    <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { setPlanAdoptOpen(true); setPlanAdoptAck(false) }}>{t('planning.adoptButton')}</button>
                  )}
                  {record.splitApprovedAt !== undefined ? (
                    <button
                      type="button"
                      className={`${styles.ghostButton} ${styles.dangerButton}`}
                      disabled={slot.busy}
                      onClick={() => { setSplitRevokeOpen(true); setSplitRevokeAck(false) }}
                    >
                      {t('split.revoke')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={planNext === 'sowPlan' ? styles.primaryButton : styles.ghostButton}
                    disabled={slot.busy}
                    onClick={() => { setSow({ purpose: 'plan' }) }}
                  >
                    {t('sow.planButton')}
                  </button>
                  <button
                    type="button"
                    className={planNext === 'sowSplit' ? styles.primaryButton : styles.ghostButton}
                    disabled={slot.busy}
                    onClick={() => { setSow({ purpose: 'split' }) }}
                  >
                    {t('sow.splitButton')}
                  </button>
                </div>
                {/* 待裁决置顶（S1 同款）：拆包提议单列——栏头角标 + 内滚，splitProposals
                    未绑定时组件自隐。 */}
                <SplitProposals
                  key={`splitproposals-${requirementId}`}
                  t={t}
                  slot={slot}
                  controller={controller}
                  requirementId={requirementId}
                  splitSeedDue={splitDue}
                  splitSeedMiss={splitDue ? splitSeedMiss : undefined}
                  onRetrySplitSeed={retrySplitSeed}
                />
              </div>
            ) : null}
            {record !== null && viewing === 'plan' ? (
              <div className={styles.planDocsRow}>
                {/* 布局轮：规划卡直挂（stale Tag 骑卡头 headerExtra——顺带消灭旧
                    PlanningSection 头与卡内头的双标题）；拆分结果卡为其孪生。 */}
                <WorkspaceDocSection
                  key={`planningdoc-${requirementId}`}
                  t={t}
                  controller={controller}
                  requirementId={requirementId}
                  workspacePath={planWorkspacePath}
                  ns="planning"
                  displayName={`planning/${requirementId.slice(0, 8)}.md`}
                  relPath={planningDocRelPath(requirementId)}
                  fetchContent={controller.planningDocContent}
                  headerExtra={record.planAdoptedAt !== undefined && record.planBaseline?.requirementDocHash !== record.understandBaseline?.docHash ? (
                    <Tag tone="warning">{t('planning.staleBadge')}</Tag>
                  ) : undefined}
                />
                {/* 0012 验收驱动补面: the split result FILE's own card (the
                    human-readable 拆分方案). The proposal column above is this
                    file's MACHINE extraction; the card is the document face
                    (preview + path disclosure + tamper warning vs the seed锚). */}
                <WorkspaceDocSection
                  key={`splitdoc-${requirementId}`}
                  t={t}
                  controller={controller}
                  requirementId={requirementId}
                  workspacePath={planWorkspacePath}
                  ns="splitResult"
                  displayName={`split/${requirementId.slice(0, 8)}.md`}
                  relPath={splitResultRelPath(requirementId)}
                  fetchContent={controller.splitResultContent}
                />
              </div>
            ) : null}
            {record !== null && viewing === 'plan' ? (
              <SplitSection
                key={`split-${requirementId}`}
                t={t}
                slot={slot}
                controller={controller}
                requirementId={requirementId}
              />
            ) : null}
            {record !== null && viewing === 'implement' && executionView === null ? (
              <InboxSection
                key={`inbox-${requirementId}`}
                t={t}
                record={record}
                sessions={{ ids: sessionSummaries.ids, summariesById: sessionSummaries.byId }}
                waitingIds={waitingIds}
                onNavigateSession={(sessionId) => { sessionsFace.navigate(sessionId) }}
                onOpenWorkPackage={(wpId) => {
                  const wp = record.workPackages.find((w) => w.id === wpId)
                  if (wp === undefined) return
                  // 0018 刀二 状态驱动路由：待计划/草拟中→规划任务书；计划已
                  // 批准与其后（含返工补投）→开发任务书。可见收件箱行只有
                  // in-dev 卡死行（no-binding/gone——补投 dev 任务书恰是解法，
                  // 由 board 卡/详情承载分层）；planned 等臂是面扩展时的前置路由。
                  setSow({ purpose: wp.status === 'planned' || wp.status === 'plan-draft' ? 'wp-plan' : 'dev', workPackage: wp })
                }}
                onStartWorkPackage={(wpId) => { void controller.startWorkPackage(requirementId, wpId) }}
              />
            ) : null}
            {record !== null && viewing === 'implement' && executionView === null ? (
              <BoardSection key={`board-${requirementId}`} t={t} slot={slot} controller={controller} requirementId={requirementId} workspacePath={props.requirement.workspacePath} sessions={sessionsFace} waitingIds={waitingIds} onNavigateSession={(sessionId) => { sessionsFace.navigate(sessionId) }} onOpenSow={(workPackage, purpose) => { setSow({ purpose, workPackage }) }} onOpenExecution={(workPackage) => { setExecutionView(workPackage) }} onSendRework={(wpId) => { setReworkId(wpId) }} />
            ) : null}
            {record !== null && viewing === 'implement' && executionView !== null ? (
              <ExecutionSection
                key={`exec-${requirementId}-${executionView.id}`}
                t={t}
                requirementId={requirementId}
                slot={slot}
                controller={controller}
                workPackage={executionView}
                sessions={{ ids: sessionSummaries.ids, summariesById: sessionSummaries.byId }}
                waitingIds={waitingIds}
                onBack={() => { setExecutionView(null) }}
                onNavigateSession={(sessionId) => { sessionsFace.navigate(sessionId) }}
              />
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
                requirement={props.requirement}
                slot={slot}
                controller={controller}
                requirementId={requirementId}
                sessions={sessionsFace}
                onOpenSow={() => { setSow({ purpose: 'review' }) }}
              />
            ) : null}
          </div>
          {nextStage !== null ? (
            <div className={styles.advanceRow}>
              {/* 0016 P2a D5-A: 准出披露行——纯提示不阻断（阶段是指针不是闸门） */}
              {record !== null && viewing === 'implement' && (() => {
                const active = record.workPackages.filter((wp) => wp.status !== 'dropped')
                const unaccepted = active.filter((wp) => wp.status !== 'accepted')
                return unaccepted.length > 0 ? (
                  <span className={styles.advanceDisclosure}>
                    {t('advance.unacceptedCount').replaceAll('{n}', String(unaccepted.length))}
                  </span>
                ) : null
              })()}
              {record !== null && viewing === 'understand' && readiness !== null ? (
                <button
                  type="button"
                  className={styles.ghostButton}
                  disabled={slot.busy || !readiness.exportable}
                  onClick={() => { setUnderstandExportOpen(true) }}
                >
                  {t('understand.exportButton')}
                </button>
              ) : null}
              {record !== null && viewing === 'understand' && readiness !== null && !readiness.finalized ? (
                <button
                  type="button"
                  className={understandNext === 'finalize' ? styles.primaryButton : styles.ghostButton}
                  disabled={slot.busy}
                  onClick={() => { setUnderstandApproveOpen(true); setUnderstandApproveAck(false) }}
                >
                  {t('understand.approveButton')}
                </button>
              ) : null}
              <button
                type="button"
                className={(viewing === 'understand' && readiness?.finalized === true) || (viewing === 'plan' && record?.splitApprovedAt !== undefined) ? styles.primaryButton : styles.advanceButton}
                disabled={slot.busy}
                onClick={advance}
              >
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
            onDelivered={sow !== null && sow.purpose !== 'analysis' && sow.purpose !== 'split' && sow.purpose !== 'dev' && sow.purpose !== 'wp-plan' && sow.purpose !== 'review' ? undefined : (sessionId: string, sowText: string, sent: boolean) => {
              // Analysis + split deliveries are the auto-watched sources
              // (ruling ③ shape) — bind with the task-book anchor (provenance
              // parity; the split channel is file-only, so its anchor is
              // informational). The planning SOW ('plan') stays UNBOUND — the
              // 整理任务书 no-return precedent: nothing seeds from it.
              // 0017 刀二: dev binds AT DELIVERY when the v3 auto-send went
              // out — the prompted id IS the real session (刀零实证: created
              // id 直接变实，无 shell 物化). Degraded deliveries (sent=false)
              // bind nothing here: the v2 shell pathology (0016 修订 #95)
              // still stands for them; the title-addressed pass below + the
              // endpoint content addressing repair those.
              // 0018: wp-plan records the provenance POINTER on sent only
              // (0017 刀二口径 — a degraded id is the shell); the wp-plan
              // watcher arms off the pointer. 0022 (0018 D8 修订，用户拍板
              // 「投递即绑关联会话」): the delivery ALSO lands a sessions[] row
              // (purpose 'wp-plan', 关联会话面) — pointer first (it arms the
              // watcher; a fully-failed bind then only degrades to the pre-0022
              // status quo), bind after (serial — the twin carries one bounded
              // 409 retry). Degraded deliveries still bind nothing.
              if (sow === null) return
              if (sow.purpose === 'split') {
                void controller.bindSplitSession(requirementId, sessionId, sowText.slice(0, 200))
                return
              }
              if (sow.purpose === 'review') {
                // 0024 D1-A: 投递即绑——需求级 reviewSession 槽（评审对照全部
                // 验收标准，不挂工作包）。有意不设 sent 门（与 dev/wp-plan 口径
                // 不同）：v2 降级尾巴落在同一 id，用户手发后的 idle 边沿照样
                // 布防收取；shell 绑定零害——读取 miss 只是咨询位，不落盘。
                void controller.bindReviewSession(requirementId, sessionId, sowText.slice(0, 200))
                return
              }
              if (sow.purpose === 'dev') {
                if (sent && sow.workPackage !== undefined) {
                  // 0018 合并轮（用户裁定：后翻状态）：plan-approved 的投递=开工
                  // 裁决点——状态翻转在投递成功之后（取消 Modal 零痕迹）；
                  // in-dev 补投只绑不翻。串行避开 revision 竞争（bindDevSession
                  // 自带一次有界 409 重试兜底；快照态过期的 startWorkPackage
                  // 失败只是 banner+slot 自愈，状态机单向不劣化）。
                  const target = sow.workPackage
                  void (async () => {
                    if (target.status === 'plan-approved') {
                      await controller.startWorkPackage(requirementId, target.id)
                    }
                    void controller.bindDevSession(requirementId, target.id, sessionId)
                  })()
                }
                return
              }
              if (sow.purpose === 'wp-plan') {
                if (sent && sow.workPackage !== undefined) {
                  const target = sow.workPackage
                  void (async () => {
                    await controller.recordWpPlanSession(requirementId, target.id, sessionId)
                    void controller.bindWpPlanSession(requirementId, target.id, sessionId)
                  })()
                }
                return
              }
              void controller.bindAnalysisSession(requirementId, sessionId, sowText.slice(0, 200))
            }}
            onClose={() => { setSow(null) }}
          />
          {/* 0019 D2-C: the rework-note modal — view-owned like the SOW
              instance so the board/dialog reject followup and the WP-detail
              standing button share one instance. Resolves the WP and its
              TAIL dev binding off the live record (the await-ok followup
              needs the just-recorded fail acceptance); no binding ⇒ not
              rendered (补投 via the inbox 存疑 row is that case's path). */}
          {record !== null && reworkId !== null ? (() => {
            const reworkWp = record.workPackages.find((w) => w.id === reworkId)
            const tailDev = reworkWp === undefined ? undefined : [...reworkWp.sessions].reverse().find((binding) => binding.purpose === 'dev')
            if (reworkWp === undefined || tailDev === undefined) return null
            return (
              <ReworkModal
                t={t}
                open
                workPackage={reworkWp}
                requirementTitle={props.requirement.title}
                targetSessionId={tailDev.sessionId}
                targetDisplayTitle={sessionSummaries.byId[tailDev.sessionId]?.displayTitle}
                send={props.sendToSession}
                onNavigateSession={(sessionId) => { sessionsFace.navigate(sessionId) }}
                onClose={() => { setReworkId(null) }}
              />
            )
          })() : null}
        </>
      ) : null}
      <ScanModal
        t={t}
        open={scanOpen}
        requirementId={requirementId}
        controller={controller}
        onClose={() => { setScanOpen(false) }}
      />
      {/* 0007 定稿软门 — ack-confirm finalize (the split approve-modal shape:
          stats in the description, checkbox-gated confirm; warnings NEVER
          block — proceeding with known risks is the user's call). 0008 adds
          the doc-presence disclosure (软门：无文档可定稿，有则盖章即锚定). */}
      <Modal
        open={understandApproveOpen}
        onClose={() => { setUnderstandApproveOpen(false) }}
        title={t('understand.approveTitle')}
        closeLabel={t('action.cancel')}
        description={understandAckStats}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setUnderstandApproveOpen(false) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={slot.busy || !understandApproveAck}
              onClick={() => {
                setUnderstandApproveOpen(false)
                void controller.approveUnderstand(requirementId)
              }}
            >
              {t('understand.approveConfirm')}
            </button>
          </>
        }
      >
        {understandAckDoc === 'doc' ? <div className={styles.formHint}>{t('understand.ackDocWillAnchor')}</div> : null}
        {understandAckDoc === 'no-doc' ? <div className={styles.formHint}>{t('understand.ackNoDoc')}</div> : null}
        <div className={styles.ackRow}>
          <input type="checkbox" checked={understandApproveAck} onChange={() => { setUnderstandApproveAck(!understandApproveAck) }} />
          <span>{t('understand.approveAck')}</span>
        </div>
      </Modal>
      <Modal
        open={understandRevokeOpen}
        onClose={() => { setUnderstandRevokeOpen(false) }}
        title={t('understand.revokeTitle')}
        closeLabel={t('action.cancel')}
        description={t('understand.revokeDescription')}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setUnderstandRevokeOpen(false) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={slot.busy || !understandRevokeAck}
              onClick={() => {
                setUnderstandRevokeOpen(false)
                void controller.revokeUnderstand(requirementId)
              }}
            >
              {t('understand.revokeConfirm')}
            </button>
          </>
        }
      >
        <div className={styles.ackRow}>
          <input type="checkbox" checked={understandRevokeAck} onChange={() => { setUnderstandRevokeAck(!understandRevokeAck) }} />
          <span>{t('understand.revokeAck')}</span>
        </div>
      </Modal>
      {/* 布局轮（S2 溶解 PlanningSection 上提）: 采纳规划 ack modal（文档在场探测——
          0012 软门口径：无文档可采纳，有则盖章即锚定）+ 撤销采纳 + 撤销批准三件。 */}
      <Modal
        open={planAdoptOpen}
        onClose={() => { setPlanAdoptOpen(false) }}
        title={t('planning.adoptTitle')}
        closeLabel={t('action.cancel')}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setPlanAdoptOpen(false) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={slot.busy || !planAdoptAck}
              onClick={() => {
                setPlanAdoptOpen(false)
                void controller.adoptPlan(requirementId)
              }}
            >
              {t('planning.adoptConfirm')}
            </button>
          </>
        }
      >
        <div className={styles.formHint}>
          {planWorkspacePath === ''
            ? t('planning.ackNoDoc')
            : planAckDoc === 'probing' ? t('page.loading') : planAckDoc === 'doc' ? t('planning.ackDocWillAnchor') : t('planning.ackNoDoc')}
        </div>
        <div className={styles.ackRow}>
          <input type="checkbox" checked={planAdoptAck} onChange={() => { setPlanAdoptAck(!planAdoptAck) }} />
          <span>{t('planning.adoptAck')}</span>
        </div>
      </Modal>
      <Modal
        open={planRevokeOpen}
        onClose={() => { setPlanRevokeOpen(false) }}
        title={t('planning.revokeTitle')}
        closeLabel={t('action.cancel')}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setPlanRevokeOpen(false) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.ghostButton} ${styles.dangerButton}`}
              disabled={slot.busy || !planRevokeAck}
              onClick={() => {
                setPlanRevokeOpen(false)
                void controller.revokePlanAdoption(requirementId)
              }}
            >
              {t('planning.revokeConfirm')}
            </button>
          </>
        }
      >
        <div className={styles.ackRow}>
          <input type="checkbox" checked={planRevokeAck} onChange={() => { setPlanRevokeAck(!planRevokeAck) }} />
          <span>{t('planning.revokeAck')}</span>
        </div>
      </Modal>
      <Modal
        open={splitRevokeOpen}
        onClose={() => { setSplitRevokeOpen(false) }}
        title={t('split.revokeTitle')}
        closeLabel={t('action.cancel')}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setSplitRevokeOpen(false) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={slot.busy || !splitRevokeAck}
              onClick={() => {
                setSplitRevokeOpen(false)
                void controller.revokeSplitApproval(requirementId)
              }}
            >
              {t('split.revokeConfirm')}
            </button>
          </>
        }
      >
        <div className={styles.ackRow}>
          <input type="checkbox" checked={splitRevokeAck} onChange={() => { setSplitRevokeAck(!splitRevokeAck) }} />
          <span>{t('split.revokeDescription')}</span>
        </div>
      </Modal>
      {record !== null ? (
        <SheetExportModal
          t={t}
          open={understandExportOpen}
          title={t('understand.exportTitle')}
          sheet={buildUnderstandingSheet({
            requirement: props.requirement,
            record,
            revision: slot.revision,
            generatedAt: new Date().toISOString(),
          })}
          filename={`understanding-sheet-${requirementId}.md`}
          onClose={() => { setUnderstandExportOpen(false) }}
        />
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
  /** 0019 rework-note send face (optional — same honest-degrade discipline). */
  sendToSession?: SendMessageFace
}): (props: PropsRuntime<'requirements.detail.view'>) => ReactNode {
  const { t, store, controller, sessions, waiting, deliver, sendToSession } = options
  return (props) => <WorkbenchSeat t={t} store={store} controller={controller} requirement={props.requirement} sessions={sessions} waiting={waiting} deliver={deliver} sendToSession={sendToSession} />
}

function WorkbenchSeat(props: {
  t: WorkbenchT
  store: WorkbenchStore
  controller: WorkbenchController
  requirement: RequirementRecord
  sessions?: WorkbenchSessionsFace
  waiting?: WaitingFace
  deliver?: DeliverFace
  sendToSession?: SendMessageFace
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
      sendToSession={props.sendToSession}
    />
  )
}
