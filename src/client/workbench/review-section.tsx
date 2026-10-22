/**
 * S4 review section (P4 + P5b): reports → adjudication → PRD coverage matrix
 * (research §4.2 S4, mockup 623-680).
 *
 * P4 landed manual verdict entry. P5b adds the structured review convention:
 * a review statement-of-work (the fourth SOW purpose) briefs the AI to emit a
 * `# skyaxis-review` block, and the report import (paste, or fetch from a
 * bound session) seeds each finding as a `proposed` verdict row — the AI
 * PROPOSES, the user still adjudicates every row to confirmed/rejected. The
 * report body writes through the same writeReview idempotency anchor, so a
 * retry converges and never re-seeds (which would resurrect deleted rows).
 *
 * Governance anchors:
 *  - adjudication stays the USER's power (§5.3): a seeded row is 'proposed'
 *    (host-minted, never client-writable), never a ruling; the row's Tag and
 *    the rail badge surface it as awaiting the user, and the edit form offers
 *    only the two real rulings;
 *  - the coverage matrix is a READ projection of criteria.coveredBy (the
 *    host-recomputed projection — never client-written) with WP status
 *    suffixes on non-accepted packages; hollow rows warn (§7.5);
 *  - 完成口径 = 发现全处置（confirmed 全有处置 ∪ rejected）+ 无 proposed +
 *    无空洞, with the empty-set guard: zero verdict rows is "nothing
 *    adjudicated yet", not complete (the releaseGoNoGo guard, mirrored);
 *  - no source-session meta on report cards — ReviewReportEntry carries no
 *    sessionId field and the honesty rule does not render absent data
 *    (mockup-only detail, deviation recorded);
 *  - all actions ride the main union (outside the split gate — the
 *    findings/candidates/releaseItems family; the report body write rides
 *    the artifacts route whose 409s leave zero file side effects).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { MarkdownText, Modal, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { sessionChipState } from './session-chip.js'
import type { ReviewReportEntry, ReviewVerdict, SaveReviewVerdictRequest, WorkbenchCriteriaCheck, WorkbenchRecord } from '../../workbench-shared/protocol.js'
import { WORKBENCH_ARTIFACT_MAX_CHARS } from '../../workbench-shared/protocol.js'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import type { WorkbenchSessionsFace } from './view.js'
import { RowMenu } from './row-menu.js'
import { CopyTextButton } from './copy-text-button.js'
import { sameHostPath } from './delivery.js'
import styles from './view.module.css'

const SEVERITY_TAG_TONE: Record<ReviewVerdict['severity'], 'danger' | 'warning' | 'info'> = {
  high: 'danger',
  medium: 'warning',
  low: 'info',
}

const SEVERITY_LABEL_KEY: Record<ReviewVerdict['severity'], Parameters<WorkbenchT>[0]> = {
  high: 'finding.severity.high',
  medium: 'finding.severity.medium',
  low: 'finding.severity.low',
}

const DISPOSITION_LABEL_KEY: Record<NonNullable<ReviewVerdict['disposition']>, Parameters<WorkbenchT>[0]> = {
  'to-fix': 'review.disposition.to-fix',
  fixed: 'review.disposition.fixed',
  'wont-fix': 'review.disposition.wont-fix',
}

const WP_STATUS_LABEL_KEY: Record<WorkbenchRecord['workPackages'][number]['status'], Parameters<WorkbenchT>[0]> = {
  planned: 'detail.statusPlanned',
  'plan-draft': 'detail.statusPlanDraft',
  'plan-approved': 'detail.statusPlanApproved',
  'in-dev': 'detail.statusInDev',
  built: 'detail.statusBuilt',
  accepted: 'detail.statusAccepted',
  dropped: 'detail.statusDropped',
}

/** 0023 D2-A: conformance-check result → the row's tag key (informational face). */
const CHECK_RESULT_LABEL_KEY: Record<WorkbenchCriteriaCheck['result'], Parameters<WorkbenchT>[0]> = {
  satisfied: 'review.checkSatisfied',
  unmet: 'review.checkUnmet',
  'not-verifiable': 'review.checkNotVerifiable',
}

const CHECK_RESULT_TAG_TONE: Record<WorkbenchCriteriaCheck['result'], 'success' | 'danger' | 'info'> = {
  satisfied: 'success',
  unmet: 'danger',
  'not-verifiable': 'info',
}

/**
 * 0026 修订#1: report timestamps display to the minute (yyyy-MM-dd HH:mm) in
 * the USER's local time — the ledger stores UTC ISO, and once minutes are
 * shown a raw slice would drift hours off the local clock. One truth for the
 * card meta line and every untitled-report fallback title. Exported for the
 * spec (the devTitleBindTargets precedent — tests compute the expectation
 * through the same function, so no timezone assumption leaks in).
 */
export function formatReportAt(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 0023 D2-A: the report card's second tag — conformance counts. Null when
 * the report carries no criteriaChecks (pre-0023 rows: the honest absence,
 * no face rendered).
 */
function reportChecksTag(report: ReviewReportEntry, t: WorkbenchT): { text: string; tone: 'success' | 'warning' | 'info' } | null {
  const checks = report.criteriaChecks
  if (checks === undefined) return null
  const satisfied = checks.filter((row) => row.result === 'satisfied').length
  const unmet = checks.filter((row) => row.result === 'unmet').length
  const notVerifiable = checks.filter((row) => row.result === 'not-verifiable').length
  return {
    text: t('review.checksCount')
      .replaceAll('{s}', String(satisfied))
      .replaceAll('{u}', String(unmet))
      .replaceAll('{v}', String(notVerifiable)),
    // Direct counting, never by subtraction (the reportCountsTag lesson):
    // warning whenever anything is unmet or awaiting human verification.
    tone: unmet > 0 || notVerifiable > 0 ? 'warning' : 'success',
  }
}

export function ReviewSection(props: {
  t: WorkbenchT
  /** Needed for the review-SOW entry (P5b) — the statement of work carries the requirement. */
  requirement: RequirementRecord
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  requirementId: string
  /** S4 entry: open the review SOW modal (view-owned instance, P5b). */
  onOpenSow?: () => void
  /** Optional live-session face — powers the report-fetch picker; absent ⇒ paste-only. */
  sessions?: WorkbenchSessionsFace
}): ReactNode {
  const { t, slot, controller, requirementId } = props
  const record = slot.record
  // Hooks first, unconditionally — the null render below must never change
  // the hook order if the slot flips between record states.
  const [importOpen, setImportOpen] = useState(false)
  const [detailTarget, setDetailTarget] = useState<ReviewReportEntry | null>(null)
  const [verdictTarget, setVerdictTarget] = useState<{ report: ReviewReportEntry; row?: ReviewVerdict } | null>(null)
  const [removeReportTarget, setRemoveReportTarget] = useState<ReviewReportEntry | null>(null)
  const [removeVerdictTarget, setRemoveVerdictTarget] = useState<{ report: ReviewReportEntry; row: ReviewVerdict } | null>(null)
  if (record === null) return null

  const reports = [...record.reviewReports].sort((a, b) => b.at.localeCompare(a.at))
  const verdictRows = reports.flatMap((report) => report.verdicts.map((row) => ({ report, row })))

  const reportCountsTag = (report: ReviewReportEntry): { text: string; tone: 'info' | 'success' | 'warning' } => {
    const total = report.verdicts.length
    // Count each state DIRECTLY, never by subtraction — with the P5b third
    // state 'proposed', `total - rejected` would silently report AI-proposed
    // (unadjudicated) rows as confirmed.
    const proposed = report.verdicts.filter((row) => row.verdict === 'proposed').length
    const confirmed = report.verdicts.filter((row) => row.verdict === 'confirmed').length
    const rejected = report.verdicts.filter((row) => row.verdict === 'rejected').length
    const disposed = report.verdicts.filter((row) => row.verdict === 'rejected' || row.disposition !== undefined).length
    return {
      text: t('review.counts')
        .replaceAll('{n}', String(total))
        .replaceAll('{p}', String(proposed))
        .replaceAll('{c}', String(confirmed))
        .replaceAll('{r}', String(rejected)),
      // success only when nothing is left proposed or undisposed.
      tone: total === 0 ? 'info' : (disposed === total && proposed === 0) ? 'success' : 'warning',
    }
  }

  const verdictStateTag = (row: ReviewVerdict): { text: string; tone: 'success' | 'warning' | 'neutral' | 'outline' } => {
    // P5b third state: an AI-proposed finding awaiting the user's ruling.
    // Rendered distinctly (outline, dictionary text) — the pre-P5b code fell
    // through to a hardcoded 'confirmed' warning tag, which would launder an
    // unexamined proposal into a user ruling (the decisions/0006 D10 point).
    if (row.verdict === 'proposed') {
      return { text: t('review.verdictPending'), tone: 'outline' }
    }
    if (row.verdict === 'rejected') {
      return { text: row.note !== undefined ? `rejected：${row.note}` : 'rejected', tone: 'neutral' }
    }
    if (row.disposition === undefined) return { text: 'confirmed', tone: 'warning' }
    return {
      text: `confirmed · ${t(DISPOSITION_LABEL_KEY[row.disposition])}`,
      tone: row.disposition === 'fixed' ? 'success' : row.disposition === 'to-fix' ? 'warning' : 'neutral',
    }
  }

  const matrix = (() => {
    const total = verdictRows.length
    const disposed = verdictRows.filter(({ row }) => row.verdict === 'rejected' || row.disposition !== undefined).length
    const holes = record.criteria.filter((criterion) => criterion.coveredBy.length === 0).length
    // Empty-set guard: zero verdict rows is "nothing adjudicated", not done.
    const done = total > 0 && disposed === total && holes === 0
    return { total, disposed, holes, done }
  })()

  const wpById = new Map(record.workPackages.map((workPackage) => [workPackage.id, workPackage]))

  // 0025 核验矩阵轮: the review-stage matrix LEADS with the latest
  // conformance verdict — per criterion, the newest report carrying a
  // criteriaChecks row for that ref wins (a re-review supersedes its
  // predecessor; `reports` is already at-desc so first hit is newest).
  // Absent = 未核验, the honest absence (no report checked it yet — a
  // distinct state from the AI's not-verifiable ruling). The planning-
  // coverage chips (coveredBy) stay as the secondary line; holes stay
  // (the completion gate reads them); the 完成口径 itself is untouched.
  const latestChecks = new Map<string, WorkbenchCriteriaCheck>()
  for (const report of reports) {
    for (const check of report.criteriaChecks ?? []) {
      if (!latestChecks.has(check.ref)) latestChecks.set(check.ref, check)
    }
  }

  // 0026 排版轮 (A 摘要条置顶): the stage STATE leads the page — done tag +
  // disposition summary + the acceptance-face check counts in one strip, so
  // opening the tab answers「过没过、还差多少」without scrolling to the
  // matrix. The full matrix stays at the bottom (per-criterion detail with
  // evidence); a long criterion list never buries the fresh report cards or
  // the action buttons.
  const checkTally = (() => {
    const tally: Record<WorkbenchCriteriaCheck['result'] | 'unchecked', number> = { satisfied: 0, unmet: 0, 'not-verifiable': 0, unchecked: 0 }
    for (const criterion of record.criteria) {
      const check = latestChecks.get(criterion.id)
      if (check === undefined) tally.unchecked += 1
      else tally[check.result] += 1
    }
    return tally
  })()

  return (
    <div className={styles.reviewSection}>
      {record.criteria.length > 0 ? (
        <div className={styles.sectionHead}>
          <Tag tone={matrix.done ? 'success' : 'neutral'}>{t(matrix.done ? 'review.matrixDone' : 'review.matrixUndone')}</Tag>
          <span className={styles.gonogoText}>
            {t('review.matrixSummary')
              .replaceAll('{n}', String(matrix.disposed))
              .replaceAll('{m}', String(matrix.total))
              .replaceAll('{k}', String(matrix.holes))}
            {' · '}
            {t('review.stripChecks')
              .replaceAll('{s}', String(checkTally.satisfied))
              .replaceAll('{u}', String(checkTally.unmet))
              .replaceAll('{v}', String(checkTally['not-verifiable']))
              .replaceAll('{w}', String(checkTally.unchecked))}
          </span>
        </div>
      ) : null}
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{t('review.sectionTitle')}</div>
        {props.onOpenSow !== undefined ? (
          <button type="button" className={styles.ghostButton} onClick={() => { props.onOpenSow?.() }}>{t('sow.reviewButton')}</button>
        ) : null}
        <button type="button" className={styles.ghostButton} onClick={() => { setImportOpen(true) }}>{t('review.importButton')}</button>
      </div>
      {reports.length === 0 ? <div className={styles.guideHint}>{t('review.empty')}</div> : null}
      {reports.map((report) => {
        const counts = reportCountsTag(report)
        const checks = reportChecksTag(report, t)
        return (
          <div key={report.id} className={styles.wpRow}>
            <div
              role="button"
              tabIndex={0}
              className={styles.wpRowMain}
              onClick={() => { setDetailTarget(report) }}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setDetailTarget(report) }}
            >
              <div className={styles.wpRowTitle}>
                <Tag tone={counts.tone}>{counts.text}</Tag>
                {checks !== null ? <>{' '}<Tag tone={checks.tone}>{checks.text}</Tag></> : null}
                {' '}{report.title !== undefined && report.title.length > 0 ? report.title : `${t('review.detailTitle')} · ${formatReportAt(report.at)}`}
              </div>
              <div className={styles.wpRowMeta}>{formatReportAt(report.at)}</div>
            </div>
            <RowMenu
              menuLabel={report.id}
              items={[{ id: 'remove', label: t('menu.remove'), danger: true }]}
              onSelect={() => { setRemoveReportTarget(report) }}
            />
          </div>
        )
      })}

      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{t('review.verdictsTitle')}</div>
        {reports.length > 0 ? (
          <button type="button" className={styles.ghostButton} onClick={() => { setVerdictTarget({ report: reports[0]! }) }}>{t('review.addVerdict')}</button>
        ) : null}
      </div>
      {verdictRows.length === 0 ? (
        reports.length > 0 ? <div className={styles.guideHint}>{t('review.verdictsEmpty')}</div> : null
      ) : verdictRows.map(({ report, row }) => {
        const state = verdictStateTag(row)
        return (
          <div key={`${report.id}:${row.id ?? row.title}`} className={styles.wpRow}>
            <div
              role="button"
              tabIndex={0}
              className={styles.wpRowMain}
              onClick={() => { setVerdictTarget({ report, row }) }}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setVerdictTarget({ report, row }) }}
            >
              <div className={styles.wpRowTitle}>
                <Tag tone={SEVERITY_TAG_TONE[row.severity]}>{t(SEVERITY_LABEL_KEY[row.severity])}</Tag>
                {' '}{row.title}
                {' '}<Tag tone={state.tone}>{state.text}</Tag>
              </div>
              <div className={styles.wpRowMeta}>{report.title !== undefined && report.title.length > 0 ? report.title : `${t('review.detailTitle')} · ${formatReportAt(report.at)}`}</div>
            </div>
            <RowMenu
              menuLabel={row.id ?? row.title}
              items={[{ id: 'remove', label: t('menu.remove'), danger: true }]}
              onSelect={() => { setRemoveVerdictTarget({ report, row }) }}
            />
          </div>
        )
      })}

      {record.criteria.length > 0 ? (
        <>
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitle}>{t('review.matrixTitle')}</div>
            <span className={styles.gonogoText}>
              {t('review.matrixSummary').replaceAll('{n}', String(matrix.disposed)).replaceAll('{m}', String(matrix.total)).replaceAll('{k}', String(matrix.holes))}
            </span>
            <Tag tone={matrix.done ? 'success' : 'neutral'}>{t(matrix.done ? 'review.matrixDone' : 'review.matrixUndone')}</Tag>
          </div>
          {record.criteria.map((criterion) => {
            // 0025: the verdict tag leads the line (the review-stage
            // question is "is it met"), coverage chips trail as secondary.
            const check = latestChecks.get(criterion.id)
            return (
              <div key={criterion.id} className={styles.criterionRow}>
                <div className={styles.criterionRowMain}>
                  <div className={styles.criterionRowTitle}>
                    {check !== undefined
                      ? <Tag tone={CHECK_RESULT_TAG_TONE[check.result]}>{t(CHECK_RESULT_LABEL_KEY[check.result])}</Tag>
                      : <Tag tone="neutral">{t('review.unchecked')}</Tag>}
                    {' '}{criterion.id}　{criterion.text}
                  </div>
                  {/* 0026: the latest check's evidence rides the row (the detail
                      modal's per-report table retired — the matrix is the one
                      checks face; grounding stays readable without opening
                      the report body). */}
                  {check?.evidence !== undefined && check.evidence.length > 0 ? (
                    <div className={styles.wpRowMeta}>{t('review.checkEvidence')}：{check.evidence}</div>
                  ) : null}
                  <div className={styles.coverChips}>
                    {criterion.coveredBy.length === 0 ? (
                      <span className={styles.coverChipHole}>{t('review.holeChip')}</span>
                    ) : criterion.coveredBy.map((workPackageId) => {
                      const workPackage = wpById.get(workPackageId)
                      const statusSuffix = workPackage !== undefined && workPackage.status !== 'accepted'
                        ? ` · ${t(WP_STATUS_LABEL_KEY[workPackage.status])}`
                        : ''
                      return (
                        <span key={workPackageId} className={styles.coverChip}>{`← ${workPackageId}${statusSuffix}`}</span>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </>
      ) : null}

      <ReviewImportModal
        t={t}
        open={importOpen}
        busy={slot.busy}
        record={record}
        sessions={props.sessions}
        workspacePath={props.requirement.workspacePath}
        controller={controller}
        requirementId={requirementId}
        onClose={() => { setImportOpen(false) }}
      />

      {detailTarget !== null ? (
        <ReportDetailModal
          key={detailTarget.id}
          t={t}
          report={detailTarget}
          fileExists={slot.reviewFileExists.find((row) => row.reviewId === detailTarget.id)?.exists}
          controller={controller}
          requirementId={requirementId}
          onClose={() => { setDetailTarget(null) }}
        />
      ) : null}

      {verdictTarget !== null ? (
        <VerdictFormModal
          key={verdictTarget.row !== undefined ? verdictTarget.row.id ?? verdictTarget.row.title : `new-${verdictTarget.report.id}`}
          t={t}
          report={verdictTarget.report}
          reports={reports}
          row={verdictTarget.row}
          busy={slot.busy}
          onCancel={() => { setVerdictTarget(null) }}
          onSubmit={(reportId, verdict) => {
            setVerdictTarget(null)
            void controller.saveReviewVerdict(requirementId, reportId, verdict)
          }}
        />
      ) : null}

      <Modal
        open={removeReportTarget !== null}
        onClose={() => { setRemoveReportTarget(null) }}
        title={t('review.removeReportTitle')}
        closeLabel={t('action.cancel')}
        description={removeReportTarget?.title}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setRemoveReportTarget(null) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={slot.busy}
              onClick={() => {
                const target = removeReportTarget
                setRemoveReportTarget(null)
                if (target !== null) void controller.removeReviewReport(requirementId, target.id)
              }}
            >
              {t('action.confirm')}
            </button>
          </>
        }
      >
        {t('review.removeReportDescription')}
      </Modal>

      <Modal
        open={removeVerdictTarget !== null}
        onClose={() => { setRemoveVerdictTarget(null) }}
        title={t('review.removeVerdictTitle')}
        closeLabel={t('action.cancel')}
        description={removeVerdictTarget?.row.title}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setRemoveVerdictTarget(null) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={slot.busy}
              onClick={() => {
                const target = removeVerdictTarget
                setRemoveVerdictTarget(null)
                if (target !== null && target.row.id !== undefined) {
                  void controller.removeReviewVerdict(requirementId, target.report.id, target.row.id)
                }
              }}
            >
              {t('action.confirm')}
            </button>
          </>
        }
      >
        {t('review.removeVerdictDescription')}
      </Modal>
    </div>
  )
}

/** Review fetch-error reason → dictionary key (the declare FETCH_ERROR_KEY pattern). */
const REVIEW_FETCH_ERROR_KEY: Record<string, Parameters<WorkbenchT>[0]> = {
  'no-service': 'review.fetchNoService',
  'not-found': 'review.fetchNotFound',
  'unreadable': 'review.fetchUnreadable',
  'no-review-block': 'review.fetchNoBlock',
}

function ReviewImportModal(props: {
  t: WorkbenchT
  open: boolean
  busy: boolean
  record: WorkbenchRecord
  requirementId: string
  /** The requirement's workspace anchor (required on RequirementRecord) — scopes the fetch candidates (0024 修订#2). */
  workspacePath: string
  controller: WorkbenchController
  /** Optional live-session face — absent (jsdom/tests) ⇒ paste-only. */
  sessions?: WorkbenchSessionsFace
  onClose: () => void
}): ReactNode {
  const { t, controller, requirementId, record } = props
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [fetchBusy, setFetchBusy] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  // done phase carries the seeded counts + advisory blockError for honest
  // disclosure (a report with no convention block still imports — verdicts 0;
  // 0023: seededChecks rides along when the block carried criteriaChecks).
  const [done, setDone] = useState<{ seeded: number; seededChecks?: number; blockError?: 'no-review-block' | 'yaml-syntax' } | null>(null)
  useEffect(() => {
    if (props.open) {
      setTitle('')
      setText('')
      setSessionId('')
      setFetchBusy(false)
      setFetchError(null)
      setDone(null)
    }
  }, [props.open])

  // 0024 修订#1 (user acceptance): the fetch candidates are ALL workspace
  // sessions, not just bound ones — the fetch is a pure read, any session's
  // log can carry a report (delivered from the workbench or run by hand).
  // Blank sessions filter out (never ran, nothing to fetch — the
  // SessionPicker rationale). The record's reviewSession pointer only PINS
  // the order: the auto-collect source leads, the manual repair path when
  // the watcher missed.
  //
  // 0024 修订#2 (user acceptance): the sessions face is MACHINE-wide, not
  // workspace-wide — the host list RPC answers every visible session of
  // every workspace ("filtering stays with the consumer", the store carries
  // every row), so 修订#1's「工作区全体」was in fact「全机器全体」and the
  // picker listed other projects' sessions. Scope the candidates by the
  // summary's cwd against the requirement's workspacePath (the delivery.ts
  // sameHostPath precedent — Win11 case/separator/trailing-slash folding).
  // A row with NO cwd still passes: host list rows carry one, so undefined
  // is the create-echo placeholder race (manager.d.ts "fill the
  // placeholder's missing cwd") — a just-delivered session stays visible
  // rather than blinking out; an empty anchor degrades unscoped the same
  // honest way (the field is host-validated required, '' is pathological).
  const sessionRows = props.sessions !== undefined
    ? props.sessions.ids
      .map((id) => props.sessions?.summariesById[id])
      .filter((summary): summary is NonNullable<typeof summary> =>
        summary !== undefined && !summary.blank
        && (summary.cwd === undefined || props.workspacePath === '' || sameHostPath(summary.cwd, props.workspacePath)))
    : []
  const faceIds = sessionRows.map((row) => row.id)
  const pinnedSessionId = record.reviewSession?.sessionId
  const fetchableIds = pinnedSessionId !== undefined && faceIds.includes(pinnedSessionId)
    ? [pinnedSessionId, ...faceIds.filter((id) => id !== pinnedSessionId)]
    : faceIds
  const sessionTitle = (id: string): string =>
    props.sessions?.summariesById[id]?.displayTitle ?? `${id.slice(0, 8)}…`

  const onFetch = (): void => {
    if (fetchBusy || sessionId === '') return
    setFetchBusy(true)
    setFetchError(null)
    void controller.reviewFetch(sessionId).then((result) => {
      setFetchBusy(false)
      if (result === undefined) return
      if (result.kind !== 'ok') {
        setFetchError(t('error.network'))
        return
      }
      const response = result.response
      if ('missing' in response) {
        // 'no-review-block' is advisory — the message may still be a plain
        // report; leave the textarea as-is and show the hint (never fatal).
        setFetchError(t(REVIEW_FETCH_ERROR_KEY[response.missing] ?? 'error.internal'))
        return
      }
      setText(response.text)
    })
  }

  const submit = (): void => {
    const trimmed = title.trim()
    void controller.importReview(requirementId, trimmed.length > 0 ? trimmed : undefined, text).then((outcome) => {
      if (outcome !== undefined && outcome.ok) setDone({ seeded: outcome.seeded, ...(outcome.seededChecks !== undefined ? { seededChecks: outcome.seededChecks } : {}), blockError: outcome.blockError })
    })
  }

  return (
    <Modal
      open={props.open}
      onClose={() => {
        // While the write is in flight the server may have committed — closing
        // would read as a cancel that isn't one (the declare-import precedent).
        if (!props.busy) props.onClose()
      }}
      title={t('review.importTitle')}
      closeLabel={t('action.cancel')}
      className={styles.knowledgeDialog}
      contentClassName={styles.wpDialogBody}
      footer={
        <>
          {done !== null ? (
            <div className={styles.sowWarn} role="status">
              {done.blockError !== undefined
                ? t('review.seededWithBlockError').replaceAll('{n}', String(done.seeded))
                : t('review.seededCount').replaceAll('{n}', String(done.seeded))}
              {done.seededChecks !== undefined
                ? ` · ${t('review.seededChecks').replaceAll('{n}', String(done.seededChecks))}`
                : ''}
            </div>
          ) : null}
          <div className={styles.wpFooterMain}>
            <button type="button" className={styles.ghostButton} disabled={props.busy} onClick={() => { props.onClose() }}>{t('action.cancel')}</button>
            <button type="button" className={styles.primaryButton} disabled={props.busy || text.trim().length === 0} onClick={submit}>{t('action.save')}</button>
          </div>
        </>
      }
    >
      <div className={styles.modalForm}>
        {props.sessions !== undefined ? (
          <div className={styles.formField}>
            <span>{t('review.sessionLabel')}</span>
            {fetchableIds.length === 0 ? (
              <div className={styles.formHint}>{t('review.noSessions')}</div>
            ) : (
              // 0024 D3-B: the SCROLLABLE picker list replaces the native
              // <select> — its popup is rendered by the host webview and does
              // NOT scroll past the viewport height (the acceptance finding:
              // lower sessions unreachable). The SessionPicker precedent
              // (radio rows + StateDot + max-height list) carries over.
              <>
                <div className={styles.formHint}>{t('review.sessionPlaceholder')}</div>
                <div className={styles.pickerList} role="radiogroup" aria-label={t('review.sessionLabel')}>
                  {fetchableIds.map((id) => {
                    const summary = props.sessions?.summariesById[id]
                    return (
                      <label key={id} className={styles.pickerRow}>
                        <input
                          type="radio"
                          name="review-fetch-session"
                          value={id}
                          checked={sessionId === id}
                          onChange={() => { setSessionId(id); setFetchError(null) }}
                        />
                        <StateDot state={sessionChipState(false, summary?.running === true, summary?.blank === true).dot} />
                        <span className={styles.pickerRowTitle}>{sessionTitle(id)}</span>
                      </label>
                    )
                  })}
                </div>
                <div className={styles.findingFieldRow}>
                  <button type="button" className={styles.ghostButton} disabled={fetchBusy || sessionId === ''} onClick={onFetch}>
                    {t('review.fetchButton')}
                  </button>
                </div>
              </>
            )}
            {fetchError !== null ? <div className={styles.fieldError}>{fetchError}</div> : null}
          </div>
        ) : null}
        <label className={styles.formField}>
          <span>{t('review.reportTitleLabel')}</span>
          <input value={title} maxLength={128} onChange={(event) => { setTitle(event.target.value); setDone(null) }} />
        </label>
        <label className={styles.formField}>
          <span>{t('review.bodyLabel')}</span>
          <textarea
            rows={12}
            className={styles.wpDraftTextarea}
            value={text}
            maxLength={WORKBENCH_ARTIFACT_MAX_CHARS}
            onChange={(event) => { setText(event.target.value); setDone(null) }}
          />
        </label>
      </div>
    </Modal>
  )
}

type ReportBody =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'missing' }
  | { phase: 'ready'; content: string; tampered: boolean }

function ReportDetailModal(props: {
  t: WorkbenchT
  report: ReviewReportEntry
  fileExists: boolean | undefined
  controller: WorkbenchController
  requirementId: string
  onClose: () => void
}): ReactNode {
  const { t, report, controller, requirementId } = props
  const [body, setBody] = useState<ReportBody>({ phase: 'loading' })
  useEffect(() => {
    let cancelled = false
    setBody({ phase: 'loading' })
    void controller.reviewContent(requirementId, report.id).then((result) => {
      if (cancelled) return
      if (result === undefined) {
        setBody({ phase: 'error' })
        return
      }
      if (result.kind === 'ok') {
        setBody({ phase: 'ready', content: result.content, tampered: result.contentTampered })
        return
      }
      setBody(result.kind === 'http-error' && result.status === 404 ? { phase: 'missing' } : { phase: 'error' })
    })
    return () => {
      cancelled = true
    }
  }, [controller, requirementId, report.id])

  const markdownLabels = useMemo(() => ({
    code: { copyLabel: t('md.copyCode'), copiedLabel: t('md.copiedCode') },
    footnotes: t('md.footnotes'),
  }), [t])

  return (
    <Modal
      open
      onClose={() => { props.onClose() }}
      title={props.report.title !== undefined && props.report.title.length > 0 ? props.report.title : `${t('review.detailTitle')} · ${formatReportAt(props.report.at)}`}
      closeLabel={t('action.cancel')}
      className={styles.wpDialog}
      contentClassName={styles.wpDialogBody}
      footer={
        <div className={styles.wpFooterMain}>
          <button type="button" className={styles.ghostButton} onClick={() => { props.onClose() }}>{t('action.cancel')}</button>
        </div>
      }
    >
      {props.fileExists === false || body.phase === 'missing' ? <div className={styles.wpMissing}>{t('review.fileMissing')}</div> : null}
      {body.phase === 'loading' ? <div className={styles.formHint}>{t('page.loading')}</div> : null}
      {body.phase === 'error' ? <div className={styles.fieldError}>{t('page.loadError')}</div> : null}
      {body.phase === 'ready' ? (
        <>
          {body.tampered ? <div className={styles.wpWarnStrip}>{t('detail.tampered')}</div> : null}
          {/* 0026 修订#1 (user ruling): the per-report checks table RESTORED —
              each report's rows are an INDEPENDENT SNAPSHOT of that review
              round, complementary to (not a duplicate of) the section-page
              matrix: the matrix aggregates latest-wins across rounds, this
              table shows what THIS round concluded with its evidence — the
              multi-round audit face (compare round N vs N+1 per criterion).
              Absent on pre-0023 reports: nothing renders. */}
          {(props.report.criteriaChecks?.length ?? 0) > 0 ? (
            <div className={styles.wpDocBody}>
              <div className={styles.sectionTitle}>{t('review.checksTitle')}</div>
              {props.report.criteriaChecks!.map((check) => (
                <div key={`${check.ref}:${check.result}`} className={styles.criterionRow}>
                  <div className={styles.criterionRowMain}>
                    <div className={styles.criterionRowTitle}>
                      <Tag tone={CHECK_RESULT_TAG_TONE[check.result]}>{t(CHECK_RESULT_LABEL_KEY[check.result])}</Tag>
                      {' '}{check.ref}
                    </div>
                    {check.evidence !== undefined && check.evidence.length > 0 ? (
                      <div className={styles.wpRowMeta}>{t('review.checkEvidence')}：{check.evidence}</div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div className={styles.wpDraftActions}>
            <CopyTextButton t={t} text={body.content} />
          </div>
          <div className={styles.wpDocBody}>
            <MarkdownText text={body.content} labels={markdownLabels} />
          </div>
        </>
      ) : null}
    </Modal>
  )
}

function VerdictFormModal(props: {
  t: WorkbenchT
  report: ReviewReportEntry
  reports: readonly ReviewReportEntry[]
  row?: ReviewVerdict
  busy: boolean
  onCancel: () => void
  onSubmit: (reportId: string, verdict: SaveReviewVerdictRequest['verdict']) => void
}): ReactNode {
  const { t } = props
  const row = props.row
  const [reportId, setReportId] = useState(props.report.id)
  const [title, setTitle] = useState(row?.title ?? '')
  const [severity, setSeverity] = useState<ReviewVerdict['severity']>(row?.severity ?? 'medium')
  // Two-valued by design: opening a PROPOSED row is the act of adjudicating
  // it, so it seeds to 'confirmed' — the form never submits 'proposed' (the
  // host-minted seed state a client cannot write). The radios offer only the
  // two real rulings.
  const [verdict, setVerdict] = useState<'confirmed' | 'rejected'>(row?.verdict === 'rejected' ? 'rejected' : 'confirmed')
  const [disposition, setDisposition] = useState<string>(row?.disposition ?? '')
  const [note, setNote] = useState(row?.note ?? '')
  const [fieldError, setFieldError] = useState<string | null>(null)

  const submit = (): void => {
    const trimmedTitle = title.trim()
    if (trimmedTitle.length === 0) {
      setFieldError(t('release.titleRequired'))
      return
    }
    const trimmedNote = note.trim()
    if (verdict === 'rejected' && trimmedNote.length === 0) {
      setFieldError(t('review.noteRequired'))
      return
    }
    props.onSubmit(reportId, {
      ...(row?.id !== undefined ? { id: row.id } : {}),
      title: trimmedTitle,
      severity,
      verdict,
      ...(verdict === 'confirmed' && disposition !== '' ? { disposition: disposition as ReviewVerdict['disposition'] } : {}),
      ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}),
      // 0023 D4-A: the seeded evidence rides through UNCHANGED — full-row
      // replace without it would drop the AI's grounding (not a user face).
      ...(row?.detail !== undefined ? { detail: row.detail } : {}),
    })
  }

  return (
    <Modal
      open
      onClose={() => { props.onCancel() }}
      title={t(row !== undefined ? 'review.verdictEditTitle' : 'review.verdictAddTitle')}
      closeLabel={t('action.cancel')}
      className={styles.knowledgeDialog}
      footer={
        <>
          <button type="button" className={styles.ghostButton} onClick={() => { props.onCancel() }}>{t('action.cancel')}</button>
          <button type="button" className={styles.primaryButton} disabled={props.busy} onClick={submit}>{t('action.save')}</button>
        </>
      }
    >
      <div className={styles.modalForm}>
        {props.reports.length > 1 ? (
          // 0024 D3-B: the report dropdown joins the scrollable picker list
          // (the same native-select popup defect — a long report list would
          // be equally unreachable in the webview).
          <div className={styles.formField}>
            <span>{t('review.sectionTitle')}</span>
            <div className={styles.pickerList} role="radiogroup" aria-label={t('review.sectionTitle')}>
              {props.reports.map((report) => (
                <label key={report.id} className={styles.pickerRow}>
                  <input
                    type="radio"
                    name="verdict-report"
                    value={report.id}
                    checked={reportId === report.id}
                    onChange={() => { setReportId(report.id) }}
                  />
                  <span className={styles.pickerRowTitle}>{report.title !== undefined && report.title.length > 0 ? report.title : report.id}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <label className={styles.formField}>
          <span>{t('review.verdictTitleLabel')}</span>
          <input value={title} maxLength={64} onChange={(event) => { setTitle(event.target.value); setFieldError(null) }} />
        </label>
        {row?.detail !== undefined && row.detail.length > 0 ? (
          <div className={styles.formField}>
            <span>{t('review.checkEvidence')}</span>
            <div className={styles.formHint}>{row.detail}</div>
          </div>
        ) : null}
        <div className={styles.formField}>
          <span>{t('finding.severityLabel')}</span>
          {(['high', 'medium', 'low'] as const).map((level) => (
            <label key={level} className={styles.checkRow}>
              <input type="radio" name="verdict-severity" checked={severity === level} onChange={() => { setSeverity(level) }} />
              <span>{t(SEVERITY_LABEL_KEY[level])}</span>
            </label>
          ))}
        </div>
        <div className={styles.formField}>
          <span>{t('review.verdictLabel')}</span>
          <label className={styles.checkRow}>
            <input type="radio" name="verdict-outcome" checked={verdict === 'confirmed'} onChange={() => { setVerdict('confirmed'); setFieldError(null) }} />
            <span>{t('review.verdictConfirmed')}</span>
          </label>
          <label className={styles.checkRow}>
            <input type="radio" name="verdict-outcome" checked={verdict === 'rejected'} onChange={() => { setVerdict('rejected'); setDisposition(''); setFieldError(null) }} />
            <span>{t('review.verdictRejected')}</span>
          </label>
        </div>
        <label className={styles.formField}>
          <span>{t('review.dispositionLabel')}</span>
          <select value={disposition} disabled={verdict !== 'confirmed'} onChange={(event) => { setDisposition(event.target.value) }}>
            <option value="">（{t('review.matrixUndone')}）</option>
            {(['to-fix', 'fixed', 'wont-fix'] as const).map((option) => (
              <option key={option} value={option}>{t(DISPOSITION_LABEL_KEY[option])}</option>
            ))}
          </select>
        </label>
        <label className={styles.formField}>
          <span>{t('review.noteLabel')}</span>
          <textarea rows={3} value={note} maxLength={2000} onChange={(event) => { setNote(event.target.value); setFieldError(null) }} />
        </label>
        {fieldError !== null ? <div className={styles.fieldError}>{fieldError}</div> : null}
      </div>
    </Modal>
  )
}
