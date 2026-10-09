/**
 * S4 review section (P4): reports → adjudication → PRD coverage matrix
 * (research §4.2 S4, mockup 623-680). Verdict rows are MANUAL this round
 * (user ruling 2026-10-08 — the structured review convention joins P5):
 * the report imports as markdown (paste; byte-identical retries converge
 * via the writeReview idempotency anchor), findings are added row by row
 * and adjudicated confirmed/rejected with dispositions.
 *
 * Governance anchors:
 *  - adjudication is the USER's power (§5.3) — rows enter by hand, the
 *    section carries no AI-proposal channel;
 *  - the coverage matrix is a READ projection of criteria.coveredBy (the
 *    host-recomputed projection — never client-written) with WP status
 *    suffixes on non-accepted packages; hollow rows warn (§7.5);
 *  - 完成口径 = 发现全处置（confirmed 全有处置 ∪ rejected）+ 无空洞, with
 *    the empty-set guard: zero verdict rows is "nothing adjudicated yet",
 *    not complete (the releaseGoNoGo guard, mirrored);
 *  - no source-session meta on report cards — ReviewReportEntry carries no
 *    sessionId field and the honesty rule does not render absent data
 *    (mockup-only detail, deviation recorded);
 *  - all actions ride the main union (outside the split gate — the
 *    findings/candidates/releaseItems family; the report body write rides
 *    the artifacts route whose 409s leave zero file side effects).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { MarkdownText, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReviewReportEntry, ReviewVerdict, SaveReviewVerdictRequest, WorkbenchRecord } from '../../workbench-shared/protocol.js'
import { WORKBENCH_ARTIFACT_MAX_CHARS } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import { RowMenu } from './row-menu.js'
import { CopyTextButton } from './copy-text-button.js'
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

export function ReviewSection(props: {
  t: WorkbenchT
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  requirementId: string
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
    const rejected = report.verdicts.filter((row) => row.verdict === 'rejected').length
    const disposed = report.verdicts.filter((row) => row.verdict === 'rejected' || row.disposition !== undefined).length
    return {
      text: t('review.counts').replaceAll('{n}', String(total)).replaceAll('{c}', String(total - rejected)).replaceAll('{r}', String(rejected)),
      tone: total === 0 ? 'info' : disposed === total ? 'success' : 'warning',
    }
  }

  const verdictStateTag = (row: ReviewVerdict): { text: string; tone: 'success' | 'warning' | 'neutral' } => {
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

  return (
    <div className={styles.reviewSection}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{t('review.sectionTitle')}</div>
        <button type="button" className={styles.ghostButton} onClick={() => { setImportOpen(true) }}>{t('review.importButton')}</button>
      </div>
      {reports.length === 0 ? <div className={styles.guideHint}>{t('review.empty')}</div> : null}
      {reports.map((report) => {
        const counts = reportCountsTag(report)
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
                {' '}{report.title !== undefined && report.title.length > 0 ? report.title : `${t('review.detailTitle')} · ${report.at.slice(0, 10)}`}
              </div>
              <div className={styles.wpRowMeta}>{report.at.slice(0, 10)}</div>
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
              <div className={styles.wpRowMeta}>{report.title !== undefined && report.title.length > 0 ? report.title : `${t('review.detailTitle')} · ${report.at.slice(0, 10)}`}</div>
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
          {record.criteria.map((criterion) => (
            <div key={criterion.id} className={styles.criterionRow}>
              <div className={styles.criterionRowMain}>
                <div className={styles.criterionRowTitle}>{criterion.id}　{criterion.text}</div>
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
          ))}
        </>
      ) : null}

      <ReviewImportModal
        t={t}
        open={importOpen}
        busy={slot.busy}
        onCancel={() => { setImportOpen(false) }}
        onSubmit={(title, text) => {
          setImportOpen(false)
          void controller.importReview(requirementId, title, text)
        }}
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

function ReviewImportModal(props: {
  t: WorkbenchT
  open: boolean
  busy: boolean
  onCancel: () => void
  onSubmit: (title: string | undefined, text: string) => void
}): ReactNode {
  const { t } = props
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  useEffect(() => {
    if (props.open) {
      setTitle('')
      setText('')
    }
  }, [props.open])

  const submit = (): void => {
    const trimmed = title.trim()
    props.onSubmit(trimmed.length > 0 ? trimmed : undefined, text)
  }

  return (
    <Modal
      open={props.open}
      onClose={() => { props.onCancel() }}
      title={t('review.importTitle')}
      closeLabel={t('action.cancel')}
      className={styles.knowledgeDialog}
      footer={
        <>
          <button type="button" className={styles.ghostButton} onClick={() => { props.onCancel() }}>{t('action.cancel')}</button>
          <button type="button" className={styles.primaryButton} disabled={props.busy || text.trim().length === 0} onClick={submit}>{t('action.save')}</button>
        </>
      }
    >
      <div className={styles.modalForm}>
        <label className={styles.formField}>
          <span>{t('review.reportTitleLabel')}</span>
          <input value={title} maxLength={128} onChange={(event) => { setTitle(event.target.value) }} />
        </label>
        <label className={styles.formField}>
          <span>{t('review.bodyLabel')}</span>
          <textarea
            rows={12}
            className={styles.wpDraftTextarea}
            value={text}
            maxLength={WORKBENCH_ARTIFACT_MAX_CHARS}
            onChange={(event) => { setText(event.target.value) }}
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
      title={props.report.title !== undefined && props.report.title.length > 0 ? props.report.title : `${t('review.detailTitle')} · ${props.report.at.slice(0, 10)}`}
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
          <label className={styles.formField}>
            <span>{t('review.sectionTitle')}</span>
            <select value={reportId} onChange={(event) => { setReportId(event.target.value) }}>
              {props.reports.map((report) => (
                <option key={report.id} value={report.id}>{report.title !== undefined && report.title.length > 0 ? report.title : report.id}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={styles.formField}>
          <span>{t('review.verdictTitleLabel')}</span>
          <input value={title} maxLength={64} onChange={(event) => { setTitle(event.target.value); setFieldError(null) }} />
        </label>
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
