/**
 * S1 clarifications section (文件交付轮): the report's 待澄清 rows — each a
 * question awaiting the requirement owner's ANSWER (plus the session's
 * recommendation and what it blocks), plus the 忽略 dismiss. Answers are
 * USER-OWNED ledger state (the adjudication discipline — the report file is
 * never written back); the next analysis task book re-embeds answered rows
 * as settled facts via the snapshot block. Like findings (and unlike
 * criterion adoption), every action here lives OUTSIDE the split lock: the
 * gate freezes the list × coverage contract, not analysis Q&A.
 *
 * Keyed by requirementId at the render site: an open answer draft never
 * crosses a requirement switch.
 */
import { useState, type ReactNode } from 'react'
import type { SeedMissingReason } from '../../workbench-shared/protocol.js'
import { SEED_MISS_KEY, type WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import styles from './view.module.css'

export function ClarificationsSection(props: {
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
}): ReactNode {
  const { t, slot, controller, requirementId } = props
  const analysis = slot.record?.analysis
  const clarifications = analysis?.clarifications ?? []
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

  if (analysis === undefined) return null
  if (clarifications.length === 0 && analysis.seed !== undefined) return null

  return (
    <div className={styles.proposalGroup}>
      <div className={styles.sectionTitle}>{t('proposal.clarificationsTitle')}</div>
      {clarifications.length === 0 && analysis.seed === undefined ? (
        <div className={styles.formHint}>
          {t('proposal.waitingHint')}
          {props.onRetrySeed !== undefined ? (
            <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={props.onRetrySeed}>{t('proposal.retry')}</button>
          ) : null}
        </div>
      ) : null}
      {props.seedMiss !== undefined ? (
        <div className={styles.fieldError}>{t(SEED_MISS_KEY[props.seedMiss]).replaceAll('{n}', '?')}</div>
      ) : null}
      {props.seedScan !== undefined ? (
        <div className={styles.findingRowMeta}>{t('proposal.scanPrefix')}{props.seedScan}</div>
      ) : null}
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
    </div>
  )
}
