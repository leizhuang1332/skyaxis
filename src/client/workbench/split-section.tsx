/**
 * S2 breakdown ledger (布局轮 slim-down): the work-package list (editable
 * pre-approval with row menus for edit/remove/move) + hard gate ① (approve
 * with an acknowledge-protected confirm modal carrying the list × coverage
 * stats — the footer button stays HERE by decision: read the proposals,
 * read the list, approve in place). The pending split-proposal column moved
 * out to split-proposals.tsx; the approved banner + SOW entries + revoke
 * moved to the view-level plan bar.
 *
 * [＋工作包] lives HERE and only pre-approval (gate integrity: adding to an
 * approved list without re-approval would void the contract the stamp
 * certifies) — the unified dashed addCard (the S1 add-entry language).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchRecord, WorkbenchWorkPackage } from '../../workbench-shared/protocol.js'
import type { PrdDocSummary } from '../../requirements-shared/protocol.js'
import { type WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import { RowMenu } from './row-menu.js'
import { WorkPackageFormModal } from './work-package-form.js'
import { buildSplitBaseline, splitStaleReasons } from './split-stale.js'
import type { SplitBaselineInput } from './split-stale.js'
import { createRequirementsFetcher } from '../requirements/fetcher.js'
import styles from './view.module.css'

type Editing = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; workPackage: WorkbenchWorkPackage }

/** 布局轮: the coverage stats string — one derivation, two consumers (the
 *  view bar's approved arm + the approve modal's disclosure). */
export function splitCoverageStats(record: WorkbenchRecord, t: WorkbenchT): string {
  const covered = record.criteria.filter((criterion) => criterion.coveredBy.length > 0).length
  const holes = record.criteria.length - covered
  return [
    t('split.statWorkPackages').replaceAll('{n}', String(record.workPackages.length)),
    record.criteria.length > 0
      ? t('split.statCovered').replaceAll('{n}', String(covered)).replaceAll('{m}', String(record.criteria.length))
      : null,
    holes > 0 ? t('split.statHole').replaceAll('{n}', String(holes)) : null,
  ].filter((part) => part !== null).join(' · ')
}

/** Not-yet-started statuses — a re-split is legal only while every active package is one of these. */
const RE_SPLITTABLE_STATUSES: readonly WorkbenchWorkPackage['status'][] = ['planned', 'plan-draft', 'plan-approved']

/** Stale reason → copy key (0007 four arms; 0008 adds requirementDoc; 0012 adds planningDoc). */
const STALE_REASON_KEY: Record<'prd' | 'findings' | 'understand' | 'clarifications' | 'requirementDoc' | 'planningDoc', Parameters<WorkbenchT>[0]> = {
  prd: 'split.stalePrd',
  findings: 'split.staleFindings',
  understand: 'split.staleUnderstand',
  clarifications: 'split.staleClarifications',
  requirementDoc: 'split.staleRequirementDoc',
  planningDoc: 'split.stalePlanning',
}

export function SplitSection(props: {
  t: WorkbenchT
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  requirementId: string
  /** Injectable PRD listing (P5b stale baseline); defaults to the requirements fetcher. */
  fetchPrdDocs?: () => Promise<readonly PrdDocSummary[] | null>
}): ReactNode {
  const { t, slot, controller, requirementId } = props
  const record = slot.record
  // Hooks first, unconditionally — the null render below must never change
  // the hook order if the slot flips between record states.
  const [editing, setEditing] = useState<Editing>({ kind: 'closed' })
  const [approveOpen, setApproveOpen] = useState(false)
  const [approveAck, setApproveAck] = useState(false)
  const [reSplitOpen, setReSplitOpen] = useState(false)
  const [reSplitAck, setReSplitAck] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<WorkbenchWorkPackage | null>(null)
  // P5b: the PRD listing, pulled once when S2 mounts (view.tsx renders this
  // section only while viewing==='plan'). null = still loading / unavailable
  // ⇒ stale detection degrades to the findings trigger only (honest absence).
  const [prdDocs, setPrdDocs] = useState<readonly PrdDocSummary[] | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = props.fetchPrdDocs ?? (async () => {
      const result = await createRequirementsFetcher().prdDocs(requirementId)
      return result.kind === 'ok' ? result.docs : null
    })
    void load().then((docs) => {
      if (!cancelled) setPrdDocs(docs)
    })
    return () => {
      cancelled = true
    }
    // Re-pull on requirement switch; the fetcher identity is stable enough to
    // ignore (the sow-modal PRD-chain precedent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirementId])
  if (record === null) return null
  const approved = record.splitApprovedAt !== undefined
  const sorted = [...record.workPackages].sort((a, b) => a.order - b.order)
  // The ACTIVE list is exactly the board's set (dropped excluded) — the two
  // views can never silently disagree; dropped packages live in their own
  // muted section below with restore/remove (pre-approval only: dropping is
  // a plan EXCLUSION, editing it rides the same hard-gate-① rule as the list).
  const active = sorted.filter((workPackage) => workPackage.status !== 'dropped')
  const droppedList = sorted.filter((workPackage) => workPackage.status === 'dropped')

  const stats = splitCoverageStats(record, t)

  // P5b stale reconciliation (only meaningful while approved — the baseline
  // exists exactly then). Reasons drive the badge; re-split eligibility gates
  // the destructive action.
  const staleReasons = approved ? splitStaleReasons(record, prdDocs) : []
  const stale = staleReasons.length > 0
  // A re-split archives every active package; legal only while none has
  // started (an in-dev/built/accepted package carries plans/sessions/
  // acceptances a re-split would orphan — the host 400s, we pre-disable and
  // disclose, the criteria.lockedHint honesty precedent).
  const startedActive = active.filter((workPackage) => !RE_SPLITTABLE_STATUSES.includes(workPackage.status))
  const canReSplit = startedActive.length === 0
  // The client sends only the PRD snapshot; the host derives the findings
  // count. A null PRD listing (still loading / no workspace) sends an empty
  // prd array — the findings arm still works, the PRD arm is simply inert.
  const currentBaseline = (): SplitBaselineInput => buildSplitBaseline(prdDocs ?? [])

  return (
    <div className={styles.splitSection}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{t('split.sectionTitle')}</div>
        {stale ? <Tag tone="warning">{t('split.staleBadge')}</Tag> : null}
      </div>
      {active.map((workPackage) => (
        <div key={workPackage.id} className={styles.wpRow}>
          <div className={styles.wpRowMain}>
            <div className={styles.wpRowTitle}>
              {workPackage.id}　{workPackage.title}
              {workPackage.parallel === true ? <Tag tone="info">{t('wp.parallelTag')}</Tag> : null}
            </div>
            <div className={styles.wpRowBoundary}>{workPackage.boundary}</div>
            <div className={styles.wpRowMeta}>
              {t('wp.dependsLabel')}：{workPackage.dependsOn.length > 0 ? workPackage.dependsOn.join(', ') : t('wp.noneMark')}
              {' · '}
              {t('wp.coversLabel')}：{workPackage.covers.length > 0 ? workPackage.covers.join(', ') : t('wp.noneMark')}
            </div>
          </div>
          {approved ? null : (
            <RowMenu
              menuLabel={workPackage.id}
              items={[
                { id: 'edit', label: t('menu.edit') },
                { id: 'moveUp', label: t('menu.moveUp') },
                { id: 'moveDown', label: t('menu.moveDown') },
                { id: 'remove', label: t('menu.remove'), danger: true },
              ]}
              onSelect={(id) => {
                if (id === 'edit') setEditing({ kind: 'edit', workPackage })
                if (id === 'moveUp') void controller.moveWorkPackage(requirementId, workPackage.id, 'up')
                if (id === 'moveDown') void controller.moveWorkPackage(requirementId, workPackage.id, 'down')
                if (id === 'remove') setPendingRemove(workPackage)
              }}
            />
          )}
        </div>
      ))}
      {droppedList.length > 0 ? (
        <div className={styles.droppedSection}>
          <div className={styles.droppedSectionHead}>{t('split.droppedSectionTitle')}</div>
          {droppedList.map((workPackage) => (
            <div key={workPackage.id} className={`${styles.wpRow} ${styles.wpRowDropped}`}>
              <div className={styles.wpRowMain}>
                <div className={styles.wpRowTitle}>
                  {workPackage.id}　{workPackage.title}
                  <Tag tone="quiet">{t('split.droppedTag')}</Tag>
                </div>
                <div className={styles.wpRowMeta}>
                  {t('wp.coversLabel')}：{workPackage.covers.length > 0 ? workPackage.covers.join(', ') : t('wp.noneMark')}
                </div>
              </div>
              {approved ? null : (
                <RowMenu
                  menuLabel={workPackage.id}
                  items={[
                    { id: 'restore', label: t('split.restore') },
                    { id: 'remove', label: t('menu.remove'), danger: true },
                  ]}
                  onSelect={(id) => {
                    if (id === 'restore') void controller.restoreWorkPackage(requirementId, workPackage.id)
                    if (id === 'remove') setPendingRemove(workPackage)
                  }}
                />
              )}
            </div>
          ))}
        </div>
      ) : null}
      {/* 布局轮统一：添加入口与 S1 台账同款虚线整卡（头 → 行 → 卡），仅未批准时。 */}
      {approved ? null : (
        <button type="button" className={styles.addCard} onClick={() => { setEditing({ kind: 'create' }) }}>{t('split.add')}</button>
      )}
      {approved ? null : (
        /* 拍板①：批准拆分（硬门①）留在清单底部——读完提议、读完清单、就地批准。 */
        <div className={styles.splitFooter}>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={slot.busy || record.workPackages.length === 0}
            onClick={() => { setApproveOpen(true); setApproveAck(false) }}
          >
            {t('split.approve')}
          </button>
        </div>
      )}

      {stale ? (
        <div className={styles.gonogo}>
          <span className={styles.gonogoText}>
            {t('split.staleReason').replaceAll('{reasons}', staleReasons
              .map((reason) => t(STALE_REASON_KEY[reason]))
              .join(' · '))}
          </span>
          <span className={styles.gonogoSpacer} />
          <button
            type="button"
            className={styles.ghostButton}
            disabled={slot.busy}
            onClick={() => { void controller.confirmSplitStillValid(requirementId, currentBaseline()) }}
          >
            {t('split.stillValid')}
          </button>
          <button
            type="button"
            className={`${styles.ghostButton} ${styles.dangerButton}`}
            disabled={slot.busy || !canReSplit}
            onClick={() => { setReSplitOpen(true); setReSplitAck(false) }}
          >
            {t('split.reSplit')}
          </button>
        </div>
      ) : null}
      {stale && !canReSplit ? (
        <div className={styles.formHint}>{t('split.reSplitBlocked')}</div>
      ) : null}

      {editing.kind !== 'closed' ? (
        <WorkPackageFormModal
          key={editing.kind === 'edit' ? editing.workPackage.id : 'create'}
          t={t}
          editing={editing.kind === 'edit' ? editing.workPackage : 'create'}
          siblings={record.workPackages}
          criteria={record.criteria}
          busy={slot.busy}
          onCancel={() => { setEditing({ kind: 'closed' }) }}
          onSubmit={async (input) => {
            const ok = await controller.saveWorkPackage(requirementId, input)
            if (ok) setEditing({ kind: 'closed' })
            return ok
          }}
        />
      ) : null}

      <Modal
        open={approveOpen}
        onClose={() => { setApproveOpen(false) }}
        title={t('split.approveTitle')}
        closeLabel={t('action.cancel')}
        description={stats}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setApproveOpen(false) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={slot.busy || !approveAck}
              onClick={() => {
                setApproveOpen(false)
                // Carry the current upstream snapshot so the approval records
                // what it was based on (P5b stale baseline). Absent PRD list
                // (still loading) ⇒ approve without a baseline; stale
                // detection then falls back to the findings trigger only.
                void controller.approveSplit(requirementId, currentBaseline())
              }}
            >
              {t('split.approveConfirm')}
            </button>
          </>
        }
      >
        <div className={styles.ackRow}>
          <input type="checkbox" checked={approveAck} onChange={() => { setApproveAck(!approveAck) }} />
          <span>{t('split.approveAck')}</span>
        </div>
      </Modal>

      <Modal
        open={reSplitOpen}
        onClose={() => { setReSplitOpen(false) }}
        title={t('split.reSplitTitle')}
        closeLabel={t('action.cancel')}
        description={t('split.reSplitCount').replaceAll('{n}', String(active.length))}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setReSplitOpen(false) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={slot.busy || !reSplitAck}
              onClick={() => {
                setReSplitOpen(false)
                void controller.reSplit(requirementId)
              }}
            >
              {t('split.reSplitConfirm')}
            </button>
          </>
        }
      >
        <div className={styles.ackRow}>
          <input type="checkbox" checked={reSplitAck} onChange={() => { setReSplitAck(!reSplitAck) }} />
          <span>{t('split.reSplitAck')}</span>
        </div>
      </Modal>

      <Modal
        open={pendingRemove !== null}
        onClose={() => { setPendingRemove(null) }}
        title={t('wp.removeTitle')}
        closeLabel={t('action.cancel')}
        description={pendingRemove !== null ? `${pendingRemove.id} ${pendingRemove.title}` : undefined}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setPendingRemove(null) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={slot.busy}
              onClick={() => {
                const target = pendingRemove
                setPendingRemove(null)
                if (target !== undefined && target !== null) void controller.removeWorkPackage(requirementId, target.id)
              }}
            >
              {t('action.confirm')}
            </button>
          </>
        }
      >
        {t('wp.removeDescription')}
      </Modal>
    </div>
  )
}
