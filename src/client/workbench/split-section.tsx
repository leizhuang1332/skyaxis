/**
 * S2 breakdown section: the work-package list (editable pre-approval with
 * row menus for edit/remove/move), hard gate ① (approve with an
 * acknowledge-protected confirm modal carrying the list × coverage stats;
 * revoke with a confirm modal), and the approved gonogo banner with the
 * read-only rows. The stale badge slot in the header is a marked comment
 * only — no dead UI (stale automation is P5).
 *
 * [＋工作包] lives HERE and only pre-approval (gate integrity: adding to an
 * approved list without re-approval would void the contract the stamp
 * certifies — the mockup's S3 add-card is a v2 wish, resolved per plan).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SeedMissingReason, WorkbenchWorkPackage } from '../../workbench-shared/protocol.js'
import type { PrdDocSummary } from '../../requirements-shared/protocol.js'
import { SEED_MISS_KEY, type WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import { RowMenu } from './row-menu.js'
import { WorkPackageFormModal } from './work-package-form.js'
import { buildSplitBaseline, splitStaleReasons } from './split-stale.js'
import type { SplitBaselineInput } from './split-stale.js'
import { createRequirementsFetcher } from '../requirements/fetcher.js'
import styles from './view.module.css'

type Editing = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; workPackage: WorkbenchWorkPackage }

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
  /** S2 entry: open the split SOW modal (view-owned instance). */
  onOpenSow?: () => void
  /** Injectable PRD listing (P5b stale baseline); defaults to the requirements fetcher. */
  fetchPrdDocs?: () => Promise<readonly PrdDocSummary[] | null>
  /** 0012: the split watcher's advisory — due (uncollected) + why-not + retry. */
  splitSeedDue?: boolean
  splitSeedMiss?: SeedMissingReason
  onRetrySplitSeed?: () => void
}): ReactNode {
  const { t, slot, controller, requirementId } = props
  const record = slot.record
  // Hooks first, unconditionally — the null render below must never change
  // the hook order if the slot flips between record states.
  const [editing, setEditing] = useState<Editing>({ kind: 'closed' })
  const [approveOpen, setApproveOpen] = useState(false)
  const [approveAck, setApproveAck] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [revokeAck, setRevokeAck] = useState(false)
  const [reSplitOpen, setReSplitOpen] = useState(false)
  const [reSplitAck, setReSplitAck] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<WorkbenchWorkPackage | null>(null)
  // 0012: the proposal area's checked-ref set (the register-selected input).
  const [selectedRefs, setSelectedRefs] = useState<ReadonlySet<string>>(new Set())
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

  const covered = record.criteria.filter((criterion) => criterion.coveredBy.length > 0).length
  const holes = record.criteria.length - covered
  const stats = [
    t('split.statWorkPackages').replaceAll('{n}', String(record.workPackages.length)),
    record.criteria.length > 0
      ? t('split.statCovered').replaceAll('{n}', String(covered)).replaceAll('{m}', String(record.criteria.length))
      : null,
    holes > 0 ? t('split.statHole').replaceAll('{n}', String(holes)) : null,
  ].filter((part) => part !== null).join(' · ')

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
        <button type="button" className={styles.ghostButton} onClick={() => { props.onOpenSow?.() }}>{t('sow.splitButton')}</button>
        {approved ? null : (
          <button type="button" className={styles.ghostButton} onClick={() => { setEditing({ kind: 'create' }) }}>{t('split.add')}</button>
        )}
      </div>
      {record.splitProposals !== undefined ? (() => {
        // 0012 拆包提议区: the split session's collected suggestions — pending
        // rows awaiting the user's ruling (never counted by badges/stale/matrix;
        // registering mints real ids, hard gate ① still approves the LIST).
        // [忽略] stays usable while locked (the dismissFindingProposal family:
        // dropping a pending row is never a contract change); only registering
        // is gated.
        const proposals = record.splitProposals
        const toggleRef = (ref: string): void => {
          setSelectedRefs((previous) => {
            const next = new Set(previous)
            if (next.has(ref)) next.delete(ref)
            else next.add(ref)
            return next
          })
        }
        return (
          <div className={styles.splitProposalBlock}>
            <div className={styles.sectionHead}>
              <div className={styles.sectionTitle}>{t('splitProposal.sectionTitle')}</div>
              {approved ? <div className={styles.fieldError}>{t('splitProposal.lockedHint')}</div> : null}
              <button
                type="button"
                className={styles.ghostButton}
                disabled={slot.busy || approved || selectedRefs.size === 0}
                onClick={() => {
                  void controller.adoptSplitProposals(requirementId, proposals.workPackages.filter((row) => selectedRefs.has(row.ref)).map((row) => row.ref))
                  setSelectedRefs(new Set())
                }}
              >
                {t('splitProposal.adoptSelected')}
              </button>
            </div>
            {props.splitSeedDue === true ? (
              <div className={styles.formHint}>
                {t('splitProposal.waiting')}
                {props.splitSeedMiss !== undefined ? (
                  <div className={styles.fieldError}>{t(SEED_MISS_KEY[props.splitSeedMiss]).replaceAll('{n}', '?')}</div>
                ) : null}
                {props.onRetrySplitSeed !== undefined ? (
                  <button type="button" className={styles.ghostButton} onClick={props.onRetrySplitSeed}>{t('splitProposal.retry')}</button>
                ) : null}
              </div>
            ) : null}
            {proposals.workPackages.map((row) => (
              <div key={row.ref} className={`${styles.wpRow} ${styles.wpRowProposed}`}>
                <input
                  type="checkbox"
                  aria-label={row.ref}
                  checked={selectedRefs.has(row.ref)}
                  disabled={approved}
                  onChange={() => { toggleRef(row.ref) }}
                />
                <div className={styles.wpRowMain}>
                  <div className={styles.wpRowTitle}>
                    {row.ref}　{row.title}
                    <Tag tone="info">{t('splitProposal.proposedTag')}</Tag>
                    {row.parallel === true ? <Tag tone="info">{t('wp.parallelTag')}</Tag> : null}
                  </div>
                  <div className={styles.wpRowBoundary}>{row.boundary}</div>
                  <div className={styles.wpRowMeta}>
                    {t('wp.dependsLabel')}：{row.dependsOn.length > 0 ? row.dependsOn.join(', ') : t('wp.noneMark')}
                    {' · '}
                    {t('wp.coversLabel')}：{row.covers.length > 0 ? row.covers.join(', ') : t('wp.noneMark')}
                  </div>
                </div>
                <RowMenu
                  menuLabel={row.ref}
                  items={[{ id: 'ignore', label: t('splitProposal.ignore') }]}
                  onSelect={() => {
                    void controller.dismissWorkPackageProposal(requirementId, row.ref)
                    setSelectedRefs((previous) => {
                      const next = new Set(previous)
                      next.delete(row.ref)
                      return next
                    })
                  }}
                />
              </div>
            ))}
          </div>
        )
      })() : null}
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
      {approved ? (
        <div className={styles.gonogo}>
          <Tag tone="success">{t('split.approvedTag')}</Tag>
          <span className={styles.gonogoText}>
            {t('split.approvedAtPrefix')} {record.splitApprovedAt} · {stats}
          </span>
          <span className={styles.gonogoSpacer} />
          <button
            type="button"
            className={`${styles.ghostButton} ${styles.dangerButton}`}
            disabled={slot.busy}
            onClick={() => { setRevokeOpen(true); setRevokeAck(false) }}
          >
            {t('split.revoke')}
          </button>
        </div>
      ) : (
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
        open={revokeOpen}
        onClose={() => { setRevokeOpen(false) }}
        title={t('split.revokeTitle')}
        closeLabel={t('action.cancel')}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setRevokeOpen(false) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={slot.busy || !revokeAck}
              onClick={() => {
                setRevokeOpen(false)
                void controller.revokeSplitApproval(requirementId)
              }}
            >
              {t('split.revokeConfirm')}
            </button>
          </>
        }
      >
        <div className={styles.ackRow}>
          <input type="checkbox" checked={revokeAck} onChange={() => { setRevokeAck(!revokeAck) }} />
          <span>{t('split.revokeDescription')}</span>
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
