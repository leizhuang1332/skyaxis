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
import { useState, type ReactNode } from 'react'
import { Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchWorkPackage } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import { RowMenu } from './row-menu.js'
import { WorkPackageFormModal } from './work-package-form.js'
import styles from './view.module.css'

type Editing = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; workPackage: WorkbenchWorkPackage }

export function SplitSection(props: {
  t: WorkbenchT
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  requirementId: string
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
  const [pendingRemove, setPendingRemove] = useState<WorkbenchWorkPackage | null>(null)
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

  return (
    <div className={styles.splitSection}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{t('split.sectionTitle')}</div>
        {/* stale 徽章预留位（research §4.2）：自动化在 P5，无数据不渲染占位。 */}
        {approved ? null : (
          <button type="button" className={styles.ghostButton} onClick={() => { setEditing({ kind: 'create' }) }}>{t('split.add')}</button>
        )}
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
                void controller.approveSplit(requirementId)
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
