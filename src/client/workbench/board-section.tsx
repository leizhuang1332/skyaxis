/**
 * S3 execution board: the progress summary line + the five-column kanban
 * (6 statuses folded — 待计划 = planned + plan-draft with a card tag
 * separating 未起草/草拟中; dropped stays off the board, history lives in
 * the detail dialog). v1 has NO drag: column membership is DERIVED from
 * status, and status only moves through actions (dragging into "accepted"
 * would bypass the acceptance prerogative — research §4.2).
 *
 * DOM shape: cards are DIVs with a real BUTTON title area (opens the
 * detail dialog) and action buttons as SIBLINGS — buttons never nest
 * inside buttons (the list.tsx row pattern). The built column's inline
 * [验收通过][不通过] is the verification queue; reject opens a
 * required-reason modal (fail without a reason is unconstructible).
 */
import { useState, type ReactNode } from 'react'
import { Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchWorkPackage } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import { WorkPackageDialog } from './work-package-dialog.js'
import styles from './view.module.css'

/** Card-level plan state: the TAIL of the version chain decides the label. */
function planCardTag(workPackage: WorkbenchWorkPackage): { kind: 'none' } | { kind: 'draft' } | { kind: 'approved'; version: number; missing: boolean } {
  const plans = [...workPackage.plans].sort((a, b) => b.version - a.version)
  const tail = plans[0]
  if (tail === undefined) return { kind: 'none' }
  if (tail.approvedAt === undefined) return { kind: 'draft' }
  return { kind: 'approved', version: tail.version, missing: false }
}

export function BoardSection(props: {
  t: WorkbenchT
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  requirementId: string
  /** Live-session face (register-injected; absent in tests ⇒ picker/strip degrade). */
  sessions?: { ids: readonly string[]; summariesById: Readonly<Record<string, { id: string; displayTitle: string; running: boolean; blank: boolean } | undefined>> }
  /** SessionIds with a pending approval/question (P2b fourth state). */
  waitingIds?: ReadonlySet<string>
  /** S3 entry: open the work-package SOW modal for the given package. */
  onOpenSow?: (workPackage: WorkbenchWorkPackage) => void
}): ReactNode {
  const { t, slot, controller, requirementId } = props
  const record = slot.record
  const [dialogId, setDialogId] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [rejectError, setRejectError] = useState<string | null>(null)

  if (record === null) return null
  if (record.splitApprovedAt === undefined) {
    // Hard gate ① pending: the board is the state machine's projection and
    // every action behind it is locked — render the guide, not a dead board.
    return <div className={styles.guideSection}><div className={styles.guideHint}>{t('board.lockedHint')}</div></div>
  }

  const active = record.workPackages.filter((workPackage) => workPackage.status !== 'dropped')
  // Progress denominators exclude dropped packages (a dropped package is
  // neither progress nor debt).
  const count = (predicate: (workPackage: WorkbenchWorkPackage) => boolean): number => active.filter(predicate).length
  const accepted = count((workPackage) => workPackage.status === 'accepted')
  const built = count((workPackage) => workPackage.status === 'built')
  const inDev = count((workPackage) => workPackage.status === 'in-dev')
  const planApproved = count((workPackage) => workPackage.status === 'plan-approved')
  const planned = count((workPackage) => workPackage.status === 'planned' || workPackage.status === 'plan-draft')

  const existsOnDisk = (workPackage: WorkbenchWorkPackage, version: number): boolean | undefined =>
    slot.planFileExists.find((row) => row.workPackageId === workPackage.id && row.version === version)?.exists

  type SummaryPart = { text: string; tone: 'success' | 'warning' | 'info' | 'neutral' }
  const parts: Array<SummaryPart | null> = [
    active.length > 0 ? { text: t('board.progressAccepted').replaceAll('{n}', String(accepted)).replaceAll('{m}', String(active.length)), tone: accepted === active.length ? ('success' as const) : ('neutral' as const) } : null,
    built > 0 ? { text: t('board.progressBuilt').replaceAll('{n}', String(built)), tone: 'warning' as const } : null,
    inDev > 0 ? { text: t('board.progressInDev').replaceAll('{n}', String(inDev)), tone: 'info' as const } : null,
    planApproved > 0 ? { text: t('board.progressPlanApproved').replaceAll('{n}', String(planApproved)), tone: 'neutral' as const } : null,
    planned > 0 ? { text: t('board.progressPlanned').replaceAll('{n}', String(planned)), tone: 'neutral' as const } : null,
  ]
  const summary = parts.filter((part): part is SummaryPart => part !== null)

  const columns: Array<{ key: string; title: string; workPackages: readonly WorkbenchWorkPackage[] }> = [
    { key: 'planned', title: t('board.colPlanned'), workPackages: active.filter((wp) => wp.status === 'planned' || wp.status === 'plan-draft') },
    { key: 'planApproved', title: t('board.colPlanApproved'), workPackages: active.filter((wp) => wp.status === 'plan-approved') },
    { key: 'inDev', title: t('board.colInDev'), workPackages: active.filter((wp) => wp.status === 'in-dev') },
    { key: 'built', title: t('board.colBuilt'), workPackages: active.filter((wp) => wp.status === 'built') },
    { key: 'accepted', title: t('board.colAccepted'), workPackages: active.filter((wp) => wp.status === 'accepted') },
  ]

  const rejectTarget = record.workPackages.find((wp) => wp.id === rejectId) ?? null
  const dialogTarget = record.workPackages.find((wp) => wp.id === dialogId) ?? null

  return (
    <div className={styles.boardSection}>
      {summary.length > 0 ? (
        <div className={styles.progressLine}>
          {summary.map((part, index) => <Tag key={index} tone={part.tone}>{part.text}</Tag>)}
        </div>
      ) : null}
      <div className={styles.board}>
        {columns.map((column) => (
          <div key={column.key} className={styles.boardCol}>
            <div className={styles.boardColHead}>
              {column.title}
              <span className={styles.boardColCount}>{column.workPackages.length}</span>
            </div>
            {column.workPackages.map((workPackage) => {
              const tag = planCardTag(workPackage)
              const tailMissing = tag.kind === 'approved' ? existsOnDisk(workPackage, tag.version) === false : false
              return (
                <div key={workPackage.id} className={styles.boardCard}>
                  <button type="button" className={styles.boardCardMain} onClick={() => { setDialogId(workPackage.id) }}>
                    <span className={styles.boardCardTitle}>{workPackage.id}　{workPackage.title}</span>
                    <span className={styles.boardCardMeta}>
                      {tag.kind === 'none' ? <Tag tone="neutral">{t('board.notDrafted')}</Tag> : null}
                      {tag.kind === 'draft' ? <Tag tone="warning">{t('board.drafting')}</Tag> : null}
                      {tag.kind === 'approved' ? (
                        <Tag tone={tailMissing ? 'danger' : 'success'}>
                          {t('board.planTag').replaceAll('{n}', String(tag.version))}{tailMissing ? ` · ${t('board.planMissing')}` : ''}
                        </Tag>
                      ) : null}
                      <span className={styles.boardCardMetaText}>
                        {t('board.sessions').replaceAll('{n}', String(workPackage.sessions.length))}
                        {workPackage.commits.length > 0 ? ` · ${t('board.commits').replaceAll('{n}', String(workPackage.commits.length))}` : ''}
                      </span>
                    </span>
                  </button>
                  {workPackage.status === 'built' ? (
                    <div className={styles.boardCardActions}>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        disabled={slot.busy}
                        onClick={() => { void controller.acceptWorkPackage(requirementId, workPackage.id, 'pass') }}
                      >
                        {t('board.accept')}
                      </button>
                      <button
                        type="button"
                        className={`${styles.ghostButton} ${styles.dangerButton}`}
                        disabled={slot.busy}
                        onClick={() => { setRejectId(workPackage.id); setRejectNote(''); setRejectError(null) }}
                      >
                        {t('board.reject')}
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {dialogTarget !== null ? (
        <WorkPackageDialog
          t={t}
          workPackage={dialogTarget}
          slot={slot}
          controller={controller}
          requirementId={requirementId}
          sessions={props.sessions}
          waitingIds={props.waitingIds}
          onOpenSow={props.onOpenSow}
          onClose={() => { setDialogId(null) }}
        />
      ) : null}

      <Modal
        open={rejectTarget !== null}
        onClose={() => { setRejectId(null) }}
        title={t('board.rejectTitle')}
        closeLabel={t('action.cancel')}
        description={rejectTarget !== null ? `${rejectTarget.id} ${rejectTarget.title}` : undefined}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setRejectId(null) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={slot.busy}
              onClick={() => {
                if (rejectNote.trim().length === 0) {
                  setRejectError(t('board.rejectReasonRequired'))
                  return
                }
                const target = rejectTarget
                setRejectId(null)
                if (target !== undefined && target !== null) void controller.acceptWorkPackage(requirementId, target.id, 'fail', rejectNote.trim())
              }}
            >
              {t('board.rejectSubmit')}
            </button>
          </>
        }
      >
        <label className={styles.formField}>
          <span>{t('board.rejectReasonLabel')}</span>
          <textarea
            rows={3}
            value={rejectNote}
            maxLength={2000}
            onChange={(event) => { setRejectNote(event.target.value); setRejectError(null) }}
          />
        </label>
        {rejectError !== null ? <div className={styles.fieldError}>{rejectError}</div> : null}
      </Modal>
    </div>
  )
}
