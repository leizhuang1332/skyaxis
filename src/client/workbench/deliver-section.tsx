/**
 * S5 deliver section (P3a): the release sheet — go/no-go banner over the
 * five-group list (SQL / 配置 / 开关 / MQ / 其他, empty groups not rendered —
 * the droppedSection precedent; the mockup itself only drew three populated
 * groups). Rows are the wpRow four-piece geometry; status Tags follow §4.5's
 * tone table (pending=warning / verified=success / rolled-back=danger) with
 * confirmed=info and applied=neutral supplied this round (spec left the two
 * middle tones open — recorded in milestones).
 *
 * Governance anchors:
 *  - four counts render even at zero: the gonogo is a CHECKLIST readout, not
 *    a rail badge —「漂移 0」is a checked fact, not a missing datum (spec
 *    §4.2 writes it literally); the banner itself renders only when there is
 *    at least one item (zero items = nothing to conclude, the empty state
 *    guides registration instead).
 *  - drift discloses its only physical cause verbatim (external edit); the
 *    endpoint re-hashes on every write, so in-product editing never drifts.
 *  - locked rows disclose the way out (P1b round-4 discipline): applied+
 *    content is read-only, amendment = register new + roll back.
 *  - [导入声明] is P3b — a marked comment, no dead UI (split-section:67).
 *  - confirm-style modals close BEFORE the call (banner reports failures);
 *    the form modal stays open on a failed save (knowledge-section:15-18).
 */
import { useState, type ReactNode } from 'react'
import { Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReleaseItem, WorkbenchRecord } from '../../workbench-shared/protocol.js'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import { RowMenu, type RowMenuItem } from './row-menu.js'
import { ReleaseItemFormModal } from './deliver-form-modal.js'
import { SheetExportModal } from './sheet-export-modal.js'
import { DeclareImportModal } from './declare-import-modal.js'
import { buildReleaseSheet } from './release-sheet.js'
import type { WorkbenchSessionsFace } from './view.js'
import styles from './view.module.css'

const RELEASE_TYPE_ORDER: readonly ReleaseItem['type'][] = ['sql', 'config', 'flag', 'mq', 'other']

const GROUP_KEY: Record<ReleaseItem['type'], Parameters<WorkbenchT>[0]> = {
  sql: 'release.group.sql',
  config: 'release.group.config',
  flag: 'release.group.flag',
  mq: 'release.group.mq',
  other: 'release.group.other',
}

const STATUS_TAG_TONE: Record<ReleaseItem['status'], 'warning' | 'info' | 'neutral' | 'success' | 'danger'> = {
  pending: 'warning',
  confirmed: 'info',
  applied: 'neutral',
  verified: 'success',
  'rolled-back': 'danger',
}

const STATUS_LABEL_KEY: Record<ReleaseItem['status'], Parameters<WorkbenchT>[0]> = {
  pending: 'release.status.pending',
  confirmed: 'release.status.confirmed',
  applied: 'release.status.applied',
  verified: 'release.status.verified',
  'rolled-back': 'release.status.rolled-back',
}

export function DeliverSection(props: {
  t: WorkbenchT
  requirement: RequirementRecord
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  requirementId: string
  /** Optional live-session face for the declare-import fetch row (absent ⇒ paste-only). */
  sessions?: WorkbenchSessionsFace
  /** Injectable clipboard for the export modal (the sow-modal IO contract; tests pass fakes). */
  copy?: (text: string) => Promise<boolean>
  /** Injectable download for the export modal (挂账轮 — jsdom cannot click a real anchor). */
  download?: (filename: string, text: string) => boolean
}): ReactNode {
  const { t, slot, controller, requirementId } = props
  const record = slot.record
  // Hooks first, unconditionally — the null render below must never change
  // the hook order if the slot flips between record states.
  const [formTarget, setFormTarget] = useState<'new' | ReleaseItem | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ReleaseItem | null>(null)
  const [rollbackTarget, setRollbackTarget] = useState<ReleaseItem | null>(null)
  const [planConfirmOpen, setPlanConfirmOpen] = useState(false)
  const [planRevokeOpen, setPlanRevokeOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  if (record === null) return null

  const drifted = new Set(slot.releaseDrifted)
  const items = record.releaseItems
  const live = items.filter((item) => item.status !== 'rolled-back')
  const pendingCount = live.filter((item) => item.status === 'pending').length
  const confirmedCount = live.length - pendingCount
  const rollbackConfirmed = record.rollbackPlanConfirmedAt !== undefined
  const go = live.length > 0 && pendingCount === 0 && slot.releaseDrifted.length === 0 && rollbackConfirmed

  const gonogoStats = [
    t('release.gonogoPending').replaceAll('{n}', String(pendingCount)),
    t('release.gonogoConfirmed').replaceAll('{n}', String(confirmedCount)),
    t('release.gonogoDrift').replaceAll('{n}', String(slot.releaseDrifted.length)),
    `${t('release.rollbackPlanPrefix')} ${rollbackConfirmed
      ? `${t('release.rollbackConfirmedShort')}（${(record.rollbackPlanConfirmedAt ?? '').slice(0, 10)}）`
      : t('release.rollbackMissingShort')}`,
  ].join(' · ')

  const menuItems = (item: ReleaseItem): readonly RowMenuItem[] => {
    const menu: RowMenuItem[] = []
    if (item.status === 'pending') {
      menu.push({ id: 'confirm', label: t('release.menuConfirm') })
    }
    if (item.status === 'confirmed') {
      menu.push({ id: 'applied', label: t('release.menuApplied') })
    }
    if (item.status === 'applied') {
      menu.push({ id: 'verified', label: t('release.menuVerified') })
    }
    if (item.status === 'pending') {
      menu.push({ id: 'edit', label: t('menu.edit') })
    }
    if (item.status !== 'rolled-back') {
      menu.push({ id: 'rollback', label: t('release.menuRollback'), danger: true })
    }
    if (item.status === 'pending') {
      menu.push({ id: 'remove', label: t('menu.remove'), danger: true })
    }
    return menu
  }

  const rowMeta = (item: ReleaseItem): string => [
    item.envs.length > 0 ? `env ${item.envs.join(',')}` : null,
    item.workPackageId !== undefined ? `${t('release.sourcePrefix')} ${item.workPackageId}` : null,
    item.appliedAt !== undefined ? `${t('release.appliedAtPrefix')} ${item.appliedAt.slice(0, 10)}` : null,
    item.status === 'applied' || item.status === 'verified' ? t('release.lockedHint') : null,
  ].filter((part) => part !== null).join(' · ')

  const onMenuSelect = (item: ReleaseItem, id: string): void => {
    if (id === 'confirm') void controller.confirmReleaseItem(requirementId, item.id)
    if (id === 'applied') void controller.markReleaseItemApplied(requirementId, item.id)
    if (id === 'verified') void controller.markReleaseItemVerified(requirementId, item.id)
    if (id === 'edit') setFormTarget(item)
    if (id === 'rollback') setRollbackTarget(item)
    if (id === 'remove') setRemoveTarget(item)
  }

  return (
    <div className={styles.deliverSection}>
      {items.length > 0 ? (
        <div className={styles.gonogo}>
          <Tag tone={go ? 'success' : 'warning'}>{t(go ? 'release.gonogoGo' : 'release.gonogoNoGo')}</Tag>
          <span className={styles.gonogoText}>{gonogoStats}</span>
          <span className={styles.gonogoSpacer} />
          {rollbackConfirmed ? (
            <button
              type="button"
              className={`${styles.ghostButton} ${styles.dangerButton}`}
              disabled={slot.busy}
              onClick={() => { setPlanRevokeOpen(true) }}
            >
              {t('release.revokeRollbackPlan')}
            </button>
          ) : (
            <button
              type="button"
              className={styles.ghostButton}
              disabled={slot.busy}
              onClick={() => { setPlanConfirmOpen(true) }}
            >
              {t('release.confirmRollbackPlan')}
            </button>
          )}
        </div>
      ) : null}

      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{t('release.sectionTitle')}</div>
        <button type="button" className={styles.ghostButton} onClick={() => { setFormTarget('new') }}>{t('release.add')}</button>
        <button type="button" className={styles.ghostButton} onClick={() => { setImportOpen(true) }}>{t('declare.importButton')}</button>
        <button
          type="button"
          className={styles.ghostButton}
          disabled={items.length === 0}
          onClick={() => { setExportOpen(true) }}
        >
          {t('release.exportButton')}
        </button>
      </div>
      {items.length === 0 ? <div className={styles.guideHint}>{t('release.empty')}</div> : null}

      {RELEASE_TYPE_ORDER.map((type) => {
        const group = items.filter((item) => item.type === type)
        if (group.length === 0) return null
        return (
          <div key={type} className={styles.criteriaSection}>
            <div className={styles.sectionTitle}>{`${t(GROUP_KEY[type])}（${group.length}）`}</div>
            {group.map((item) => (
              <div key={item.id} className={styles.wpRow}>
                <div className={styles.wpRowMain}>
                  <div className={styles.wpRowTitle}>
                    <Tag tone={STATUS_TAG_TONE[item.status]}>{t(STATUS_LABEL_KEY[item.status])}</Tag>
                    {' '}{item.id}　{item.title}
                    {drifted.has(item.id) ? <span className={styles.driftNote}>⚠ {t('release.driftNote')}</span> : null}
                  </div>
                  {rowMeta(item).length > 0 ? <div className={styles.wpRowMeta}>{rowMeta(item)}</div> : null}
                </div>
                {menuItems(item).length > 0 ? (
                  <RowMenu
                    menuLabel={item.id}
                    items={menuItems(item)}
                    onSelect={(id) => { onMenuSelect(item, id) }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )
      })}

      {formTarget !== null ? (
        <ReleaseItemFormModal
          key={formTarget === 'new' ? 'new' : formTarget.id}
          t={t}
          target={formTarget}
          workPackages={record.workPackages.filter((workPackage) => workPackage.status !== 'dropped')}
          busy={slot.busy}
          onCancel={() => { setFormTarget(null) }}
          onSubmit={(input) => {
            const form = formTarget
            setFormTarget(null)
            if (form === 'new') {
              void controller.saveReleaseItem(requirementId, input)
            } else {
              void controller.saveReleaseItem(requirementId, { id: form.id, ...input })
            }
          }}
        />
      ) : null}

      <Modal
        open={removeTarget !== null}
        onClose={() => { setRemoveTarget(null) }}
        title={t('release.removeTitle')}
        closeLabel={t('action.cancel')}
        description={removeTarget !== null ? `${removeTarget.id}　${removeTarget.title}` : undefined}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setRemoveTarget(null) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={slot.busy}
              onClick={() => {
                const target = removeTarget
                setRemoveTarget(null)
                if (target !== null) void controller.removeReleaseItem(requirementId, target.id)
              }}
            >
              {t('action.confirm')}
            </button>
          </>
        }
      >
        {t('release.removeDescription')}
      </Modal>

      <Modal
        open={rollbackTarget !== null}
        onClose={() => { setRollbackTarget(null) }}
        title={t('release.rollbackTitle')}
        closeLabel={t('action.cancel')}
        description={rollbackTarget !== null ? `${rollbackTarget.id}　${rollbackTarget.title}` : undefined}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setRollbackTarget(null) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={slot.busy}
              onClick={() => {
                const target = rollbackTarget
                setRollbackTarget(null)
                if (target !== null) void controller.rollbackReleaseItem(requirementId, target.id)
              }}
            >
              {t('release.menuRollback')}
            </button>
          </>
        }
      >
        {t('release.rollbackDescription')}
      </Modal>

      <Modal
        open={planConfirmOpen}
        onClose={() => { setPlanConfirmOpen(false) }}
        title={t('release.rollbackPlanTitle')}
        closeLabel={t('action.cancel')}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setPlanConfirmOpen(false) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={slot.busy}
              onClick={() => {
                setPlanConfirmOpen(false)
                void controller.confirmRollbackPlan(requirementId)
              }}
            >
              {t('action.confirm')}
            </button>
          </>
        }
      >
        {t('release.rollbackPlanDescription')}
      </Modal>

      <Modal
        open={planRevokeOpen}
        onClose={() => { setPlanRevokeOpen(false) }}
        title={t('release.rollbackRevokeTitle')}
        closeLabel={t('action.cancel')}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => { setPlanRevokeOpen(false) }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.dangerButton}`}
              disabled={slot.busy}
              onClick={() => {
                setPlanRevokeOpen(false)
                void controller.revokeRollbackPlan(requirementId)
              }}
            >
              {t('action.confirm')}
            </button>
          </>
        }
      >
        {t('release.rollbackRevokeDescription')}
      </Modal>

      <DeclareImportModal
        t={t}
        open={importOpen}
        requirementId={requirementId}
        slot={slot}
        workspacePath={props.requirement.workspacePath}
        controller={controller}
        sessions={props.sessions}
        onClose={() => { setImportOpen(false) }}
      />

      <SheetExportModal
        t={t}
        open={exportOpen}
        sheet={buildReleaseSheet({
          requirement: props.requirement,
          record,
          revision: slot.revision,
          generatedAt: new Date().toISOString(),
          releaseDrifted: slot.releaseDrifted,
        })}
        filename={`release-sheet-${requirementId}.md`}
        copy={props.copy}
        download={props.download}
        onClose={() => { setExportOpen(false) }}
      />
    </div>
  )
}
