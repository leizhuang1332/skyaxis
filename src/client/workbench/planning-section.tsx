/**
 * S2 planning face (0012 两步化轮, decisions/0013 D2) — the 技术规划文档 card:
 * the WorkspaceDocSection generic card plus the 采纳软门 chrome (the 0007
 * understand-finalize twin). [采纳规划] opens an ack modal whose ONLY stat is
 * the doc-presence disclosure (probing the planning file off disk — 软门：无
 * 文档可采纳仍成立，ack 披露；有则盖章即锚定). Post-adoption: the gonogo banner
 * (adoptedTag + date + [撤销采纳], key-strip twin) + the upstream stale badge
 * (planBaseline.requirementDocHash vs the CURRENT understandBaseline.docHash —
 * bare !==, the split-stale fifth-arm semantics: a re-finalize or a revoke
 * flips one side and fires; both-absent compares equal, quiet).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { planningDocRelPath } from '../../workbench-shared/protocol.js'
import type { WorkbenchRecord } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import { WorkspaceDocSection } from './doc-section.js'
import styles from './view.module.css'

/** Row/modal display name — a readable stand-in for the uuid file name. */
const docDisplayName = (requirementId: string): string => `planning/${requirementId.slice(0, 8)}.md`

export function PlanningSection(props: {
  t: WorkbenchT
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  requirementId: string
  /** Bound workspace root ('' = unbound — no file channel, honest hint). */
  workspacePath: string
  record: WorkbenchRecord
  onOpenSow?: () => void
}): ReactNode {
  const { t, slot, controller, requirementId, workspacePath, record, onOpenSow } = props
  const [adoptOpen, setAdoptOpen] = useState(false)
  const [adoptAck, setAdoptAck] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [revokeAck, setRevokeAck] = useState(false)
  // Doc-presence probe (the understand ack probe twin): only while the ack
  // modal is open and the channel is armed; close resets.
  const [docProbe, setDocProbe] = useState<'probing' | 'doc' | 'no-doc'>('probing')

  const adopted = record.planAdoptedAt !== undefined
  // The upstream stale arm — bare !== (a re-finalize OR a revoke flips one
  // side; both-absent compares equal, never a false alarm).
  const upstreamStale = record.planBaseline?.requirementDocHash !== record.understandBaseline?.docHash

  useEffect(() => {
    if (!adoptOpen || workspacePath === '') return
    setDocProbe('probing')
    const abort = new AbortController()
    void controller.planningDocContent(requirementId, abort.signal).then((result) => {
      if (abort.signal.aborted) return
      setDocProbe(result !== undefined && result.kind === 'ok' ? 'doc' : 'no-doc')
    })
    return () => { abort.abort() }
  }, [controller, requirementId, workspacePath, adoptOpen])

  return (
    <div className={styles.findingSection}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{t('planning.title')}</div>
        {adopted && upstreamStale ? <Tag tone="warning">{t('planning.staleBadge')}</Tag> : null}
        <button type="button" className={styles.ghostButton} onClick={() => { onOpenSow?.() }}>{t('sow.planButton')}</button>
        {!adopted ? (
          <button type="button" className={styles.ghostButton} onClick={() => { setAdoptOpen(true); setAdoptAck(false) }}>{t('planning.adoptButton')}</button>
        ) : null}
      </div>
      <WorkspaceDocSection
        t={t}
        controller={controller}
        requirementId={requirementId}
        workspacePath={workspacePath}
        ns="planning"
        displayName={docDisplayName(requirementId)}
        relPath={planningDocRelPath(requirementId)}
        fetchContent={controller.planningDocContent}
      />
      {adopted ? (
        <div className={styles.gonogo}>
          <Tag tone="success">{t('planning.adoptedTag')}</Tag>
          <span className={styles.gonogoText}>
            {t('planning.adoptedAtPrefix')} {record.planAdoptedAt}
          </span>
          <span className={styles.gonogoSpacer} />
          <button
            type="button"
            className={`${styles.ghostButton} ${styles.dangerButton}`}
            disabled={slot.busy}
            onClick={() => { setRevokeOpen(true); setRevokeAck(false) }}
          >
            {t('planning.revokeButton')}
          </button>
        </div>
      ) : null}
      {adoptOpen ? (
        <Modal
          open
          title={t('planning.adoptTitle')}
          closeLabel={t('action.cancel')}
          onClose={() => { setAdoptOpen(false) }}
          footer={(
            <>
              <button type="button" className={styles.ghostButton} onClick={() => { setAdoptOpen(false) }}>{t('action.cancel')}</button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={slot.busy || !adoptAck}
                onClick={() => {
                  setAdoptOpen(false)
                  void controller.adoptPlan(requirementId)
                }}
              >
                {t('planning.adoptConfirm')}
              </button>
            </>
          )}
        >
          <div className={styles.formHint}>
            {workspacePath === ''
              ? t('planning.ackNoDoc')
              : docProbe === 'probing' ? t('page.loading') : docProbe === 'doc' ? t('planning.ackDocWillAnchor') : t('planning.ackNoDoc')}
          </div>
          <div className={styles.ackRow}>
            <input type="checkbox" checked={adoptAck} onChange={() => { setAdoptAck(!adoptAck) }} />
            <span>{t('planning.adoptAck')}</span>
          </div>
        </Modal>
      ) : null}
      {revokeOpen ? (
        <Modal
          open
          title={t('planning.revokeTitle')}
          closeLabel={t('action.cancel')}
          onClose={() => { setRevokeOpen(false) }}
          footer={(
            <>
              <button type="button" className={styles.ghostButton} onClick={() => { setRevokeOpen(false) }}>{t('action.cancel')}</button>
              <button
                type="button"
                className={`${styles.ghostButton} ${styles.dangerButton}`}
                disabled={slot.busy || !revokeAck}
                onClick={() => {
                  setRevokeOpen(false)
                  void controller.revokePlanAdoption(requirementId)
                }}
              >
                {t('planning.revokeConfirm')}
              </button>
            </>
          )}
        >
          <div className={styles.ackRow}>
            <input type="checkbox" checked={revokeAck} onChange={() => { setRevokeAck(!revokeAck) }} />
            <span>{t('planning.revokeAck')}</span>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
