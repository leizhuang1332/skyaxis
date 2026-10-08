/**
 * S6 knowledge view (the retro stage's body — three stacked sections):
 * ① pending candidates from the workbench ledger — activate (opens the
 *    activate modal), edit (candidate edit modal), drop (confirm); writes go
 *    through the MAIN-ledger controller methods (slot.busy gates them).
 * ② active knowledge rows from the requirement ∪ global knowledge slice — a
 *    SEPARATE ledger with its own phase/revision/busy; add/edit share the
 *    form modal, archive confirms irreversibly. Load-error / degraded /
 *    first-load degrade THIS section only (candidates and stats are
 *    main-ledger data and stay live).
 * ③ retro stat cards, computed from the ledger: distinct linked sessionIds,
 *    findings disposition n/m, rework (fail acceptances), cycle days
 *    (closed-at anchored; an open requirement measures to now, whole days).
 *
 * Modal seeding follows the criteria-section pattern: the call site keys
 * each form modal by its target, so a fresh mount seeds and close/reopen is
 * clean. Confirm modals close BEFORE the call (fire-and-forget — the banner
 * surface reports failures), form modals stay open on a failed save.
 */
import { useState, type CSSProperties, type ReactNode } from 'react'
import { Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { WORKBENCH_INLINE_MAX_CHARS, type KnowledgeCandidate, type WorkbenchKnowledgeRecord, type WorkbenchRecord } from '../../workbench-shared/protocol.js'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { KnowledgeSliceState, RequirementWorkbenchState } from './store.js'
import { RowMenu } from './row-menu.js'
import { KnowledgeActivateModal } from './knowledge-activate-modal.js'
import { KnowledgeFormModal } from './knowledge-form-modal.js'
import styles from './view.module.css'

const DAY_MS = 86_400_000

/** Draft preview: a two-line clamp keeps the review queue scannable. */
const DRAFT_CLAMP: CSSProperties = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }

export function KnowledgeSection(props: {
  t: WorkbenchT
  requirement: RequirementRecord
  slot: RequirementWorkbenchState
  knowledge: KnowledgeSliceState
  controller: WorkbenchController
  requirementId: string
}): ReactNode {
  const { t, requirement, slot, knowledge, controller, requirementId } = props
  const record = slot.record
  const pending = record?.knowledgeCandidates.filter((candidate) => candidate.status === 'pending') ?? []
  const active = knowledge.records.filter((row) => row.status === 'active')
  const knowledgeBusy = knowledge.busy ?? false

  const [activateTarget, setActivateTarget] = useState<KnowledgeCandidate | null>(null)
  const [editTarget, setEditTarget] = useState<'new' | KnowledgeCandidate | null>(null)
  const [dropTarget, setDropTarget] = useState<KnowledgeCandidate | null>(null)
  const [formTarget, setFormTarget] = useState<'new' | WorkbenchKnowledgeRecord | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<WorkbenchKnowledgeRecord | null>(null)

  return (
    <div className={styles.criteriaSection}>
      {/* ① 知识候选（pending，来自主账本） */}
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{t('knowledge.candidatesTitle')}</div>
        <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { setEditTarget('new') }}>{t('knowledge.candidateAdd')}</button>
      </div>
      {pending.length === 0 ? (
        <div className={styles.guideHint}>{t('knowledge.emptyCandidates')}</div>
      ) : pending.map((candidate) => (
        <div key={candidate.id} className={styles.candidateCard}>
          <div className={styles.criterionRowMain}>
            <div className={styles.criterionRowTitle}>
              <Tag>{t(candidate.type === 'business' ? 'knowledge.typeBusiness' : 'knowledge.typeConvention')}</Tag>
              {' '}{candidate.title}
            </div>
            <div className={styles.guideHint} style={DRAFT_CLAMP}>
              {t('knowledge.candidateDraftPrefix')}{candidate.draft}
            </div>
            {candidate.proposedSessionId !== undefined ? (
              <div className={styles.guideHint}>{t('knowledge.proposedSessionPrefix')}{candidate.proposedSessionId}</div>
            ) : null}
          </div>
          <div className={styles.candidateActions}>
            <button type="button" className={styles.primaryButton} disabled={slot.busy} onClick={() => { setActivateTarget(candidate) }}>{t('knowledge.activate')}</button>
            <button type="button" className={styles.ghostButton} disabled={slot.busy} onClick={() => { setEditTarget(candidate) }}>{t('knowledge.edit')}</button>
            <button type="button" className={`${styles.ghostButton} ${styles.dangerButton}`} disabled={slot.busy} onClick={() => { setDropTarget(candidate) }}>{t('knowledge.drop')}</button>
          </div>
        </div>
      ))}

      {/* ② 已激活知识（requirement ∪ global，独立账本切片） */}
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{t('knowledge.activeTitle')}</div>
        <button type="button" className={styles.ghostButton} onClick={() => { setFormTarget('new') }}>{t('knowledge.add')}</button>
      </div>
      {knowledge.phase === 'load-error' ? (
        <div className={styles.guideSection}><div className={styles.guideHint}>{t('knowledge.loadError')}</div></div>
      ) : knowledge.phase === 'degraded' ? (
        <div className={styles.guideSection}>
          <div className={styles.guideTitle}>{t('page.degraded')}</div>
          <div className={styles.guideHint}>{t('page.degradedBackupHint')}</div>
        </div>
      ) : active.length === 0 && knowledge.phase === 'loading' ? (
        <div className={styles.guideSection}><div className={styles.guideHint}>{t('page.loading')}</div></div>
      ) : active.length === 0 ? (
        <div className={styles.guideHint}>{t('knowledge.emptyActive')}</div>
      ) : active.map((row) => (
        <div key={row.id} className={styles.criterionRow}>
          <div className={styles.criterionRowMain}>
            <div className={styles.criterionRowTitle}>
              <Tag>{triggerTagText(row.trigger)}</Tag>
              {' '}{row.title}
            </div>
            <div className={styles.guideHint}>
              {row.scope === 'requirement'
                ? t('knowledge.metaRequirement')
                : `${t('knowledge.metaGlobal')} · ${t('knowledge.activatedAtPrefix')} ${row.provenance.at.slice(0, 10)}`}
            </div>
          </div>
          <RowMenu
            menuLabel={row.title}
            items={[
              { id: 'edit', label: t('menu.edit') },
              { id: 'archive', label: t('knowledge.archive'), danger: true },
            ]}
            onSelect={(id) => {
              if (id === 'edit') setFormTarget(row)
              if (id === 'archive') setArchiveTarget(row)
            }}
          />
        </div>
      ))}

      {/* ③ 复盘统计（全部由账本派生，无独立状态） */}
      <div className={styles.statGrid}>
        <div className={styles.statCell}>
          <div className={styles.statNum}>{distinctSessionCount(record)}</div>
          <div className={styles.statLabel}>{t('knowledge.statSessions')}</div>
        </div>
        <div className={styles.statCell}>
          <div className={styles.statNum}>{findingStats(record).resolved}/{findingStats(record).total}</div>
          <div className={styles.statLabel}>{t('knowledge.statFindings')}</div>
        </div>
        <div className={styles.statCell}>
          <div className={styles.statNum}>{reworkCount(record)}</div>
          <div className={styles.statLabel}>{t('knowledge.statRework')}</div>
        </div>
        <div className={styles.statCell}>
          <div className={styles.statNum}>{cycleDays(record, requirement.createdAt)}</div>
          <div className={styles.statLabel}>{t('knowledge.statCycleDays')}</div>
        </div>
      </div>

      {activateTarget !== null ? (
        <KnowledgeActivateModal
          key={activateTarget.id}
          t={t}
          open
          candidate={activateTarget}
          busy={slot.busy}
          onCancel={() => { setActivateTarget(null) }}
          onSubmit={(input) => {
            const target = activateTarget
            void controller.activateKnowledgeCandidate(requirementId, target.id, input).then((ok) => {
              if (ok) setActivateTarget(null)
            })
          }}
        />
      ) : null}
      {editTarget !== null ? (
        <CandidateEditModal
          key={editTarget === 'new' ? 'new' : editTarget.id}
          t={t}
          candidate={editTarget === 'new' ? undefined : editTarget}
          busy={slot.busy}
          onCancel={() => { setEditTarget(null) }}
          onSubmit={(input) => {
            const target = editTarget
            if (target === 'new') {
              void controller.saveKnowledgeCandidate(requirementId, input).then((ok) => {
                if (ok) setEditTarget(null)
              })
              return
            }
            void controller.editKnowledgeCandidate(requirementId, target.id, input).then((ok) => {
              if (ok) setEditTarget(null)
            })
          }}
        />
      ) : null}
      {formTarget !== null ? (
        <KnowledgeFormModal
          key={formTarget === 'new' ? 'new' : formTarget.id}
          t={t}
          open
          editing={formTarget === 'new' ? null : formTarget}
          requirementId={requirementId}
          busy={knowledgeBusy}
          onCancel={() => { setFormTarget(null) }}
          onSubmit={(input) => {
            void controller.saveKnowledge(requirementId, input).then((ok) => {
              if (ok) setFormTarget(null)
            })
          }}
        />
      ) : null}

      <Modal
        open={dropTarget !== null}
        onClose={() => { setDropTarget(null) }}
        title={t('knowledge.dropTitle')}
        closeLabel={t('action.cancel')}
        description={dropTarget !== null ? dropTarget.title : undefined}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setDropTarget(null) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={slot.busy}
              onClick={() => {
                const target = dropTarget
                setDropTarget(null)
                if (target !== null) void controller.dismissKnowledgeCandidate(requirementId, target.id)
              }}
            >
              {t('action.confirm')}
            </button>
          </>
        }
      >
        {t('knowledge.dropDescription')}
      </Modal>
      <Modal
        open={archiveTarget !== null}
        onClose={() => { setArchiveTarget(null) }}
        title={t('knowledge.archiveTitle')}
        closeLabel={t('action.cancel')}
        description={archiveTarget !== null ? archiveTarget.title : undefined}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setArchiveTarget(null) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={knowledgeBusy}
              onClick={() => {
                const target = archiveTarget
                setArchiveTarget(null)
                if (target !== null) void controller.archiveKnowledge(requirementId, target.id)
              }}
            >
              {t('action.confirm')}
            </button>
          </>
        }
      >
        {t('knowledge.archiveDescription')}
      </Modal>
    </div>
  )
}

/** keyword rows surface their value (the match target is the useful bit);
 *  the other modes read as the bare mode name. */
function triggerTagText(trigger: WorkbenchKnowledgeRecord['trigger']): string {
  if (trigger.mode === 'keyword' && trigger.value !== undefined && trigger.value.length > 0) return `keyword: ${trigger.value}`
  return trigger.mode
}

function distinctSessionCount(record: WorkbenchRecord | null): number {
  const seen = new Set<string>()
  for (const workPackage of record?.workPackages ?? []) {
    for (const binding of workPackage.sessions) seen.add(binding.sessionId)
  }
  return seen.size
}

function findingStats(record: WorkbenchRecord | null): { resolved: number; total: number } {
  const findings = record?.findings ?? []
  return { resolved: findings.filter((finding) => finding.status !== 'open').length, total: findings.length }
}

function reworkCount(record: WorkbenchRecord | null): number {
  return (record?.workPackages ?? []).reduce(
    (sum, workPackage) => sum + workPackage.acceptances.filter((acceptance) => acceptance.result === 'fail').length,
    0,
  )
}

/** The LAST 'closed' stage-history entry anchors the end; an open
 *  requirement measures to now (whole days, ceil — 同日取 0 或 1 由实差决定). */
function cycleDays(record: WorkbenchRecord | null, createdAt: string): number {
  let closedAt: string | undefined
  for (const change of record?.stageHistory ?? []) {
    if (change.stage === 'closed') closedAt = change.at
  }
  const endMs = closedAt !== undefined ? Date.parse(closedAt) : Date.now()
  return Math.ceil((endMs - Date.parse(createdAt)) / DAY_MS)
}

/** Candidate edit/create: title/draft/type — draft is candidate-speak for
 *  content (the promote-time scope/trigger choice lives in the activate
 *  modal). P4: `candidate` absent = manual distillation (§7.4 channel ②,
 * 复盘时从 findings/裁决中提炼 — the row lands pending and flows into the
 *  existing activate review queue). */
function CandidateEditModal(props: {
  t: WorkbenchT
  candidate?: KnowledgeCandidate
  busy: boolean
  onCancel: () => void
  onSubmit: (candidate: { title: string; draft: string; type: 'business' | 'convention' }) => void
}): ReactNode {
  const { t } = props
  const candidate = props.candidate
  const [title, setTitle] = useState(candidate?.title ?? '')
  const [draft, setDraft] = useState(candidate?.draft ?? '')
  const [type, setType] = useState<'business' | 'convention'>(candidate?.type ?? 'business')
  const [fieldError, setFieldError] = useState<string | null>(null)

  const submit = (): void => {
    if (title.trim().length === 0) {
      setFieldError(t('knowledge.titleLabel'))
      return
    }
    props.onSubmit({ title: title.trim(), draft, type })
  }

  return (
    <Modal
      open
      onClose={() => { props.onCancel() }}
      className={styles.knowledgeDialog}
      title={t(candidate !== undefined ? 'knowledge.edit' : 'knowledge.candidateAddTitle')}
      closeLabel={t('action.cancel')}
      footer={
        <>
          <button type="button" className={styles.ghostButton} onClick={() => { props.onCancel() }}>{t('action.cancel')}</button>
          <button type="button" className={styles.primaryButton} disabled={props.busy} onClick={submit}>{t('action.save')}</button>
        </>
      }
    >
      <div className={styles.modalForm}>
        <label className={styles.formField}>
          <span>{t('knowledge.titleLabel')}</span>
          <input value={title} maxLength={64} onChange={(event) => { setTitle(event.target.value); setFieldError(null) }} />
        </label>
        <label className={styles.formField}>
          <span>{t('knowledge.contentLabel')}</span>
          <textarea rows={4} value={draft} maxLength={WORKBENCH_INLINE_MAX_CHARS} onChange={(event) => { setDraft(event.target.value) }} />
        </label>
        <div className={styles.formField}>
          <span>{t('knowledge.typeLabel')}</span>
          <label className={styles.checkRow}>
            <input type="radio" name="knowledge-candidate-type" checked={type === 'business'} onChange={() => { setType('business') }} />
            <span>{t('knowledge.typeBusiness')}</span>
          </label>
          <label className={styles.checkRow}>
            <input type="radio" name="knowledge-candidate-type" checked={type === 'convention'} onChange={() => { setType('convention') }} />
            <span>{t('knowledge.typeConvention')}</span>
          </label>
        </div>
        {fieldError !== null ? <div className={styles.fieldError}>{fieldError}</div> : null}
      </div>
    </Modal>
  )
}
