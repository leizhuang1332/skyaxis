/**
 * S2 split-proposals column (布局轮): the split session's collected
 * suggestions as the single pending-adjudication column — the S1 triptych
 * column chrome reused at full width (head + pending-count badge +
 * internal scroll). Physical move out of split-section.tsx (the WP ledger
 * stays there); seeded-and-empty now shows settledHint (the S1 reversal
 * carried to S2 — a column needs a body).
 *
 * 0012 拆包提议区 semantics unchanged: pending rows are never counted by
 * badges/stale/matrix; registering mints real ids, hard gate ① still
 * approves the LIST. [忽略] stays usable while the split is approved (the
 * dismissFindingProposal family: dropping a pending row is never a contract
 * change); only registering is gated.
 *
 * Keyed by requirementId at the render site: the checked-ref set never
 * crosses a requirement switch.
 */
import { useState, type ReactNode } from 'react'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SeedMissingReason } from '../../workbench-shared/protocol.js'
import { SEED_MISS_KEY, type WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import { RowMenu } from './row-menu.js'
import styles from './view.module.css'

export function SplitProposals(props: {
  t: WorkbenchT
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  requirementId: string
  /** 0012: the split watcher's advisory — due (uncollected) + why-not + retry. */
  splitSeedDue?: boolean
  splitSeedMiss?: SeedMissingReason
  onRetrySplitSeed?: () => void
}): ReactNode {
  const { t, slot, controller, requirementId } = props
  const record = slot.record
  const [selectedRefs, setSelectedRefs] = useState<ReadonlySet<string>>(new Set())
  if (record === null) return null
  const proposals = record.splitProposals
  if (proposals === undefined) return null
  const approved = record.splitApprovedAt !== undefined
  const settled = proposals.workPackages.length === 0 && proposals.seed !== undefined && props.splitSeedDue !== true

  const toggleRef = (ref: string): void => {
    setSelectedRefs((previous) => {
      const next = new Set(previous)
      if (next.has(ref)) next.delete(ref)
      else next.add(ref)
      return next
    })
  }

  return (
    <div className={styles.triptychColumn}>
      <div className={styles.triptychColumnHead}>
        <span>{t('splitProposal.sectionTitle')}</span>
        {proposals.workPackages.length > 0 ? <span className={styles.triptychBadge}>{proposals.workPackages.length}</span> : null}
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
      <div className={styles.triptychColumnBody}>
        {approved ? <div className={styles.fieldError}>{t('splitProposal.lockedHint')}</div> : null}
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
        {settled ? <div className={styles.formHint}>{t('triptych.settledHint')}</div> : null}
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
    </div>
  )
}
