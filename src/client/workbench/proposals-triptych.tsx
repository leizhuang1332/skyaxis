/**
 * S1 pending-adjudication triptych (布局重塑轮): the three analysis-session
 * proposal lists as equal left/center/right columns, each with its own
 * internal scroll — reading order = operation order (rule what is yours to
 * rule first; reference material sits below the zone). The column bodies
 * are physical moves out of findings-section / criteria-section /
 * clarifications-section (the formal findings/criteria lists stay behind
 * in their sections). The old per-group null-returns are replaced by a
 * visible column state because equal columns need a body — seeded-and-empty
 * now shows settledHint (a deliberate reversal of the 空批隐退 contract,
 * pinned in analysis-return.spec).
 *
 * Keyed by requirementId at the render site: an open answer draft never
 * crosses a requirement switch.
 */
import { useState, type ReactNode } from 'react'
import type { SeedMissingReason, WorkbenchAnalysisProposals } from '../../workbench-shared/protocol.js'
import { SEED_MISS_KEY, type WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import styles from './view.module.css'

interface ColumnProps {
  t: WorkbenchT
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  requirementId: string
  /** 回传轮: manual re-arm of the one-shot seed attempt (the waiting hint's retry button). */
  onRetrySeed?: () => void
  /** 回传轮: the last seed attempt's zero-write reason (disclosed under the waiting hint). */
  seedMiss?: SeedMissingReason
  /** 回传轮: the no-declare-block miss's scan fingerprint (raw, language-neutral). */
  seedScan?: string
  analysis: WorkbenchAnalysisProposals
}

export function ProposalsTriptych(props: {
  t: WorkbenchT
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  requirementId: string
  /** 回传轮: same three props the old three sections threaded (view.tsx render site). */
  onRetrySeed?: () => void
  seedMiss?: SeedMissingReason
  seedScan?: string
}): ReactNode {
  const { t, slot } = props
  const analysis = slot.record?.analysis

  // Pre-bind: one zone-level hint, not three empty columns — the columns
  // appear when the analysis session lands (progressive disclosure).
  if (analysis === undefined) {
    return <div className={styles.formHint}>{t('triptych.noSessionHint')}</div>
  }

  const columnProps: ColumnProps = { ...props, analysis }
  return (
    <div className={styles.triptychColumns}>
      <FindingsProposalsColumn {...columnProps} />
      <CriteriaProposalsColumn {...columnProps} />
      <ClarificationsProposalsColumn {...columnProps} />
    </div>
  )
}

/** Column chrome: head (title + pending-count badge, rendered only when > 0
 *  — the badge-honesty convention) over the internally scrolling body. */
function ProposalColumnShell(props: { title: string; badge: number | null; children: ReactNode }): ReactNode {
  return (
    <div className={styles.triptychColumn}>
      <div className={styles.triptychColumnHead}>
        <span>{props.title}</span>
        {props.badge !== null && props.badge > 0 ? <span className={styles.triptychBadge}>{props.badge}</span> : null}
      </div>
      <div className={styles.triptychColumnBody}>{props.children}</div>
    </div>
  )
}

/** Shared 回传轮 chrome: waiting hint + manual retry, the zero-write
 *  reason, the scan fingerprint — identical to the old per-group rows. */
function SeedChrome(props: ColumnProps & { waiting: boolean }): ReactNode {
  return (
    <>
      {props.waiting ? (
        <div className={styles.formHint}>
          {props.t('proposal.waitingHint')}
          {props.onRetrySeed !== undefined ? (
            <button type="button" className={styles.ghostButton} disabled={props.slot.busy} onClick={props.onRetrySeed}>{props.t('proposal.retry')}</button>
          ) : null}
        </div>
      ) : null}
      {props.seedMiss !== undefined ? (
        <div className={styles.fieldError}>{props.t(SEED_MISS_KEY[props.seedMiss]).replaceAll('{n}', '?')}</div>
      ) : null}
      {props.seedScan !== undefined ? (
        <div className={styles.findingRowMeta}>{props.t('proposal.scanPrefix')}{props.seedScan}</div>
      ) : null}
    </>
  )
}

function FindingsProposalsColumn(props: ColumnProps): ReactNode {
  const { t, slot, controller, requirementId, analysis } = props
  const settled = analysis.findings.length === 0 && analysis.seed !== undefined
  return (
    <ProposalColumnShell title={t('proposal.findingsTitle')} badge={analysis.findings.length}>
      <SeedChrome {...props} waiting={analysis.findings.length === 0 && analysis.seed === undefined} />
      {settled ? <div className={styles.formHint}>{t('triptych.settledHint')}</div> : null}
      {analysis.findings.map((row) => (
        <div key={row.id} className={styles.proposalRow}>
          <div className={styles.proposalRowMain}>
            <div className={styles.proposalRowTitle}>[{t(`finding.category.${row.category}`)}·{t(`finding.severity.${row.severity}`)}] {row.title}</div>
            {row.detail !== undefined && row.detail.length > 0 ? <div className={styles.proposalRowDetail}>{row.detail}</div> : null}
            <div className={styles.findingRowMeta}>{t('proposal.sourcePrefix').replaceAll('{id}', (analysis.seed?.sessionId ?? analysis.session.sessionId).slice(0, 8))}</div>
          </div>
          <div className={styles.proposalRowActions}>
            <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { void controller.adoptFindingProposal(requirementId, row.id) }}>{t('proposal.adopt')}</button>
            <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { void controller.dismissFindingProposal(requirementId, row.id) }}>{t('proposal.dismiss')}</button>
          </div>
        </div>
      ))}
    </ProposalColumnShell>
  )
}

function CriteriaProposalsColumn(props: ColumnProps): ReactNode {
  const { t, slot, controller, requirementId, analysis } = props
  // 回传轮: adopt UNDER the split lock (ruling ⑤: writing criteria[] is the
  // frozen 清单×coverage contract, adopt's own gate mirrors saveCriterion),
  // dismiss stays open (a ruling is never hostage to the lock).
  const locked = (slot.record?.splitApprovedAt ?? undefined) !== undefined
  const settled = analysis.criteria.length === 0 && analysis.seed !== undefined
  return (
    <ProposalColumnShell title={t('proposal.criteriaTitle')} badge={analysis.criteria.length}>
      <SeedChrome {...props} waiting={analysis.criteria.length === 0 && analysis.seed === undefined} />
      {settled ? <div className={styles.formHint}>{t('triptych.settledHint')}</div> : null}
      {locked ? <div className={styles.formHint}>{t('proposal.lockedHint')}</div> : null}
      {analysis.criteria.map((row) => (
        <div key={row.id} className={styles.proposalRow}>
          <div className={styles.proposalRowMain}>
            <div className={styles.proposalRowTitle}>{row.text}</div>
            {row.sourceSection !== undefined && row.sourceSection.length > 0 ? <div className={styles.proposalRowDetail}>{row.sourceSection}</div> : null}
          </div>
          <div className={styles.proposalRowActions}>
            <button type="button" className={styles.ghostButton} disabled={slot.busy || locked} onClick={() => { void controller.adoptCriterionProposal(requirementId, row.id) }}>{t('proposal.adopt')}</button>
            <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { void controller.dismissCriterionProposal(requirementId, row.id) }}>{t('proposal.dismiss')}</button>
          </div>
        </div>
      ))}
    </ProposalColumnShell>
  )
}

function ClarificationsProposalsColumn(props: ColumnProps): ReactNode {
  const { t, slot, controller, requirementId, analysis } = props
  const clarifications = analysis.clarifications ?? []
  // The inline answer draft: one open row at a time, prefilled on re-answer.
  const [answeringId, setAnsweringId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)

  const openAnswer = (id: string, prefilled: string | undefined): void => {
    setAnsweringId(id)
    setDraft(prefilled ?? '')
    setFieldError(null)
  }

  const submitAnswer = (id: string): void => {
    const answer = draft.trim()
    if (answer.length === 0) {
      setFieldError(t('proposal.answerPlaceholder'))
      return
    }
    void controller.answerAnalysisClarification(requirementId, id, answer).then((ok) => {
      if (ok) {
        setAnsweringId(null)
        setDraft('')
        setFieldError(null)
      }
    })
  }

  const pending = clarifications.filter((row) => row.answer === undefined).length
  const settled = clarifications.length === 0 && analysis.seed !== undefined
  return (
    <ProposalColumnShell title={t('proposal.clarificationsTitle')} badge={pending}>
      <SeedChrome {...props} waiting={clarifications.length === 0 && analysis.seed === undefined} />
      {settled ? <div className={styles.formHint}>{t('triptych.settledHint')}</div> : null}
      {clarifications.map((row) => (
        <div key={row.id} className={styles.proposalRow}>
          <div className={styles.proposalRowMain}>
            <div className={styles.proposalRowTitle}>{row.question}</div>
            {row.recommendation !== undefined && row.recommendation.length > 0 ? <div className={styles.proposalRowDetail}>{t('proposal.recommendationPrefix')}{row.recommendation}</div> : null}
            {row.blocks !== undefined && row.blocks.length > 0 ? <div className={styles.findingRowMeta}>{t('proposal.blocksPrefix')}{row.blocks}</div> : null}
            {row.answer !== undefined ? (
              <div className={styles.proposalRowDetail}>{t('proposal.answerPrefix')}{row.answer}</div>
            ) : null}
            {answeringId === row.id ? (
              <div className={styles.inlineAnswerForm}>
                <textarea
                  rows={2}
                  value={draft}
                  maxLength={2000}
                  placeholder={t('proposal.answerPlaceholder')}
                  onChange={(event) => { setDraft(event.target.value); setFieldError(null) }}
                />
                {fieldError !== null ? <div className={styles.fieldError}>{fieldError}</div> : null}
                <div className={styles.proposalRowActions}>
                  <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { submitAnswer(row.id) }}>{t('proposal.answerSave')}</button>
                  <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { setAnsweringId(null); setFieldError(null) }}>{t('proposal.answerCancel')}</button>
                </div>
              </div>
            ) : null}
          </div>
          {answeringId === row.id ? null : (
            <div className={styles.proposalRowActions}>
              <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { openAnswer(row.id, row.answer) }}>{t('proposal.answer')}</button>
              <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { void controller.dismissAnalysisClarification(requirementId, row.id) }}>{t('proposal.ignore')}</button>
            </div>
          )}
        </div>
      ))}
    </ProposalColumnShell>
  )
}
