/**
 * SOW generation modal (0006 P2; research 0006 §7.1): left pick column
 * (PRD sections / knowledge hits / dev work-package scope) over a live
 * right preview — the preview is the exact text the copy button places on
 * the clipboard, assembled by the pure buildSow.
 *
 * All IO is injected (the repos-section cross-module fetcher precedent):
 * PRD list/text default to the requirements fetcher, the approved plan
 * body defaults to the workbench artifacts endpoint, clipboard defaults to
 * writeClipboard. Knowledge rows arrive server-filtered
 * (requirement ∪ global, both statuses) — the active filter + trigger
 * matching happen here via matchKnowledge. Injection caps
 * (KNOWLEDGE_INJECTION_MAX_ENTRIES/BYTES) disable copy with an honest warn.
 *
 * Transient payloads (PRD text, plan body) live in component state and die
 * with the dialog — never the store (the plan-body cache precedent).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Modal, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { createRequirementsFetcher } from '../requirements/fetcher.js'
import { createReposFetcher } from '../repos-pool/fetcher.js'
import { repoDirName } from '../../requirements-shared/repo-dir.js'
import { createWorkbenchFetcher } from './fetcher.js'
import {
  KNOWLEDGE_INJECTION_MAX_BYTES,
  KNOWLEDGE_INJECTION_MAX_ENTRIES,
} from '../../workbench-shared/protocol.js'
import type {
  WorkbenchKnowledgeRecord,
  WorkbenchRecord,
  WorkbenchWorkPackage,
} from '../../workbench-shared/protocol.js'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import { buildSow, knowledgeBytes, matchKnowledge, splitPrdSections } from './sow.js'
import type { PrdSection } from './sow.js'
import styles from './view.module.css'

const kbLabel = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`

/** PRD doc listing, defaulting to the requirements endpoint (JSON envelope). */
async function defaultPrdList(requirementId: string): Promise<{ name: string }[] | null> {
  const result = await createRequirementsFetcher().prdDocs(requirementId)
  return result.kind === 'ok' ? result.docs.map((doc) => ({ name: doc.name })) : null
}

/** PRD body, defaulting to the requirements content route (text/plain). */
async function defaultPrdText(requirementId: string, name: string): Promise<string | null> {
  const result = await createRequirementsFetcher().prdDocContent(requirementId, name)
  return result.kind === 'ok' ? result.text : null
}

/**
 * Approved plan body, defaulting to the artifacts endpoint read of the
 * highest approvedAt version; no approved version (or failed read) → undefined.
 */
async function defaultPlanText(requirementId: string, workPackage: WorkbenchWorkPackage): Promise<string | undefined> {
  const approved = [...workPackage.plans]
    .filter((plan) => plan.approvedAt !== undefined)
    .sort((a, b) => b.version - a.version)[0]
  if (approved === undefined) return undefined
  const result = await createWorkbenchFetcher().planContent(requirementId, workPackage.id, approved.version)
  return result.kind === 'ok' ? result.content : undefined
}

export function SowModal(props: {
  t: WorkbenchT
  open: boolean
  purpose: 'analysis' | 'split' | 'dev' | 'review'
  requirement: RequirementRecord
  record: WorkbenchRecord | null
  /** Server-filtered requirement ∪ global view (may carry archived rows — filtered active here). */
  knowledgeRecords: readonly WorkbenchKnowledgeRecord[]
  revision: number
  workPackage?: WorkbenchWorkPackage
  busy?: boolean
  onClose: () => void
  fetchPrdList?: () => Promise<{ name: string }[] | null>
  fetchPrdText?: (name: string) => Promise<string | null>
  /** dev context: approved plan body; undefined when none approved. */
  fetchPlanText?: () => Promise<string | undefined>
  copy?: (text: string) => Promise<boolean>
  /** P5a delivery face — absent ⇒ no delivery button (copy stays the fallback). */
  deliver?: (text: string, workspacePath: string | undefined) => Promise<{ ok: boolean; sessionId?: string; reason?: 'no-service' | 'failed' }>
}): ReactNode {
  const { t, open, purpose, requirement, record, knowledgeRecords, revision, workPackage } = props
  const busy = props.busy === true

  // --- PRD state (lazy per open; a stale doc response must not win) ---
  const prdSeqRef = useRef(0)
  const [prdDocs, setPrdDocs] = useState<readonly { name: string }[] | null>(null)
  const [prdError, setPrdError] = useState(false)
  const [docName, setDocName] = useState<string | null>(null)
  const [sections, setSections] = useState<readonly PrdSection[]>([])
  const /** null = default (all checked). */
    [checkedSections, setCheckedSections] = useState<ReadonlySet<number> | null>(null)

  // --- dev plan state ---
  const [planLoaded, setPlanLoaded] = useState(purpose !== 'dev')
  const [planText, setPlanText] = useState<string | undefined>(undefined)
  const [includeBoundaryPlan, setIncludeBoundaryPlan] = useState(true)
  const [includeDeps, setIncludeDeps] = useState(false)

  // --- knowledge state (null = defaults: always+keyword checked, manual not) ---
  const [checkedKnowledge, setCheckedKnowledge] = useState<ReadonlySet<string> | null>(null)

  // --- copy feedback (self-implemented, no useCopyFeedback) ---
  const [copyState, setCopyState] = useState<'idle' | 'busy' | 'copied'>('idle')
  const [copyFailed, setCopyFailed] = useState(false)
  // P5a delivery state — success CLOSES the modal (the session is open with
  // the draft prefilled; the user reviews and sends). Failure keeps the
  // modal with an alert; copy remains the manual fallback.
  const [deliverState, setDeliverState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const copyTimerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
  }, [])

  const [generatedAt, setGeneratedAt] = useState(() => new Date().toISOString())

  const loadDoc = (name: string, dead: () => boolean): void => {
    setDocName(name)
    void (async () => {
      let text: string | null = null
      try {
        text = await (props.fetchPrdText ?? ((doc: string) => defaultPrdText(requirement.id, doc)))(name)
      } catch {
        text = null
      }
      if (dead()) return
      if (text === null) {
        setPrdError(true)
        setSections([])
        setCheckedSections(null)
        return
      }
      setPrdError(false)
      setSections(splitPrdSections(text))
      setCheckedSections(null)
    })()
  }

  // Open → reset and lazily pull PRD list → first doc body; dev pulls the plan.
  useEffect(() => {
    if (!open) return undefined
    const seq = ++prdSeqRef.current
    const dead = (): boolean => prdSeqRef.current !== seq
    setPrdDocs(null)
    setPrdError(false)
    setDocName(null)
    setSections([])
    setCheckedSections(null)
    setPlanLoaded(purpose !== 'dev')
    setPlanText(undefined)
    setIncludeBoundaryPlan(true)
    setIncludeDeps(false)
    setCheckedKnowledge(null)
    setCopyState('idle')
    setCopyFailed(false)
    setGeneratedAt(new Date().toISOString())
    void (async () => {
      let docs: { name: string }[] | null = null
      try {
        docs = await (props.fetchPrdList ?? (() => defaultPrdList(requirement.id)))()
      } catch {
        docs = null
      }
      if (dead()) return
      if (docs === null) {
        setPrdError(true)
        return
      }
      setPrdDocs(docs)
      if (docs[0] !== undefined) loadDoc(docs[0].name, dead)
    })()
    if (purpose === 'dev' && workPackage !== undefined) {
      void (props.fetchPlanText ?? (() => defaultPlanText(requirement.id, workPackage)))()
        .then((text) => {
          if (dead()) return
          setPlanText(text)
          setPlanLoaded(true)
        })
        .catch(() => {
          if (dead()) return
          setPlanText(undefined)
          setPlanLoaded(true)
        })
    }
    return () => {
      // Closing invalidates every in-flight PRD chain of this open.
      prdSeqRef.current += 1
    }
    // Reopen re-runs the whole lazy chain; fetcher identities are ignored
    // on purpose (the plan-body effect precedent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // --- knowledge matching (target text: requirement title+description, plus
  // the dev work package's title+boundary; P5a context paths for the path
  // trigger: workspace root + linkedRepo clone dirs, joined against the pool
  // list for repo names — the cross-module fetcher precedent this file
  // already uses for PRDs; failure ⇒ no clone dirs, workspace root alone) ---
  const activeRecords = useMemo(
    () => knowledgeRecords.filter((row) => row.status === 'active'),
    [knowledgeRecords],
  )
  const targetText = useMemo(() => {
    const parts = [requirement.title, requirement.description]
    if (purpose === 'dev' && workPackage !== undefined) parts.push(workPackage.title, workPackage.boundary)
    return parts.join('\n')
  }, [purpose, requirement.title, requirement.description, workPackage])
  // Clone dirs need pool names — fetched once per open (component state, the
  // plan-body cache precedent: transient, never the store).
  const [repoNames, setRepoNames] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (!open) return
    let cancelled = false
    if (requirement.linkedRepos.length === 0) return
    void createReposFetcher().list().then((result) => {
      if (cancelled || result.kind !== 'ok') return
      setRepoNames(new Map(result.repos.map((repo) => [repo.id, repo.name])))
    })
    return () => {
      cancelled = true
    }
    // Reopen re-resolves; fetcher identity ignored (the PRD-chain precedent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requirement.linkedRepos])
  const contextPaths = useMemo(() => {
    const paths: string[] = []
    if (requirement.workspacePath !== '') paths.push(requirement.workspacePath)
    for (const linked of requirement.linkedRepos) {
      const name = repoNames.get(linked.repoId)
      if (name !== undefined && requirement.workspacePath !== '') {
        paths.push(`${requirement.workspacePath}/repos/${repoDirName(name, linked.repoId)}`)
      }
    }
    return paths
  }, [requirement.workspacePath, requirement.linkedRepos, repoNames])
  const picks = useMemo(() => matchKnowledge(activeRecords, targetText, contextPaths), [activeRecords, targetText, contextPaths])
  const defaultKnowledgeIds = useMemo(
    () => new Set(picks.filter((pick) => pick.match !== 'manual').map((pick) => pick.record.id)),
    [picks],
  )
  const selectedKnowledgeIds = checkedKnowledge ?? defaultKnowledgeIds
  const selectedKnowledge = useMemo(
    () => picks.filter((pick) => selectedKnowledgeIds.has(pick.record.id)).map((pick) => pick.record),
    [picks, selectedKnowledgeIds],
  )
  const hitCount = picks.filter((pick) => pick.match !== 'manual').length
  const selectedBytes = knowledgeBytes(selectedKnowledge)
  const overLimit = selectedKnowledge.length > KNOWLEDGE_INJECTION_MAX_ENTRIES || selectedBytes > KNOWLEDGE_INJECTION_MAX_BYTES

  const selectedSections = useMemo(
    () => sections.filter((_, index) => checkedSections === null || checkedSections.has(index)),
    [sections, checkedSections],
  )

  const toggleSection = (index: number): void => {
    const current = checkedSections ?? new Set(sections.map((_, i) => i))
    const next = new Set(current)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setCheckedSections(next)
  }

  const toggleKnowledge = (id: string): void => {
    const current = checkedKnowledge ?? defaultKnowledgeIds
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCheckedKnowledge(next)
    setCopyFailed(false)
  }

  const preview = useMemo(() => buildSow({
    purpose,
    requirement,
    record,
    revision,
    generatedAt,
    workPackage: purpose === 'dev' && includeBoundaryPlan ? workPackage : undefined,
    approvedPlanText: purpose === 'dev' && planLoaded ? planText : undefined,
    prdSections: selectedSections,
    prdDocumentName: docName ?? undefined,
    knowledgePicks: selectedKnowledge,
    includeDeps,
  }), [purpose, requirement, record, revision, generatedAt, workPackage, includeBoundaryPlan, planLoaded, planText, selectedSections, docName, selectedKnowledge, includeDeps])

  const warnText = overLimit
    ? t('sow.knowledgeOverLimit')
      .replaceAll('{entries}', String(selectedKnowledge.length))
      .replaceAll('{size}', kbLabel(selectedBytes))
    : deliverState === 'failed'
      ? t('sow.deliverFailed')
      : copyFailed
        ? t('sow.copyFailed')
        : null

  const onCopy = (): void => {
    if (copyState !== 'idle' || busy || overLimit) return
    setCopyState('busy')
    void (props.copy ?? writeClipboard)(preview).then((ok) => {
      if (ok) {
        setCopyFailed(false)
        setCopyState('copied')
        if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
        copyTimerRef.current = window.setTimeout(() => { setCopyState('idle') }, 1000)
      } else {
        setCopyState('idle')
        setCopyFailed(true)
      }
    })
  }

  const onDeliver = (): void => {
    // Guard busy only — the failed state stays retryable (the alert already
    // told the user why; a dead retry button would strand them).
    if (deliverState === 'busy' || busy || overLimit) return
    setDeliverState('busy')
    void props.deliver?.(preview, requirement.workspacePath).then((outcome) => {
      if (outcome.ok) {
        setDeliverState('idle')
        props.onClose()
        return
      }
      setDeliverState('failed')
    })
  }

  return (
    <Modal
      open={open}
      onClose={props.onClose}
      title={t('sow.title')}
      closeLabel={t('action.cancel')}
      className={styles.sowDialog}
      contentClassName={styles.wpDialogBody}
      footer={
        <>
          {warnText !== null ? <div className={styles.sowWarn} role="alert">{warnText}</div> : null}
          <div className={styles.wpFooterMain}>
            <button type="button" className={styles.ghostButton} onClick={props.onClose}>{t('action.cancel')}</button>
            {props.deliver !== undefined ? (
              <button
                type="button"
                className={styles.primaryButton}
                disabled={busy || overLimit || deliverState === 'busy' || copyState === 'busy'}
                onClick={onDeliver}
              >
                {t('sow.deliver')}
              </button>
            ) : null}
            <button
              type="button"
              className={props.deliver !== undefined ? styles.ghostButton : styles.primaryButton}
              disabled={busy || overLimit || copyState !== 'idle' || deliverState === 'busy'}
              onClick={onCopy}
            >
              {copyState === 'copied' ? t('sow.copied') : t('sow.copy')}
            </button>
          </div>
        </>
      }
    >
      <div className={styles.sowGrid}>
        <div className={styles.sowPick}>
          <div className={styles.sowGroup}>
            <div className={styles.sowGroupTitle}>{t('sow.prdGroup')}</div>
            {prdError ? <div className={styles.fieldError}>{t('sow.prdLoadError')}</div> : null}
            {!prdError && prdDocs === null ? <div className={styles.formHint}>{t('page.loading')}</div> : null}
            {prdDocs !== null && prdDocs.length === 0 ? <div className={styles.formHint}>{t('sow.prdEmpty')}</div> : null}
            {prdDocs !== null && prdDocs.length > 1 ? (
              <label className={styles.sowPickRow}>
                <span>{t('sow.prdDocLabel')}</span>
                <select
                  value={docName ?? ''}
                  onChange={(event) => {
                    const seq = ++prdSeqRef.current
                    loadDoc(event.target.value, () => prdSeqRef.current !== seq)
                  }}
                >
                  {prdDocs.map((doc) => (
                    <option key={doc.name} value={doc.name}>{doc.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {sections.map((section, index) => (
              <label key={index} className={styles.sowPickRow}>
                <input
                  type="checkbox"
                  checked={checkedSections === null || checkedSections.has(index)}
                  onChange={() => { toggleSection(index); setCopyFailed(false) }}
                />
                <span>{section.heading.length > 0 ? section.heading : t('sow.prdPreamble')}</span>
              </label>
            ))}
          </div>

          <div className={styles.sowGroup}>
            <div className={styles.sowGroupTitle}>
              {picks.length > 0
                ? t('sow.knowledgeHit')
                  .replaceAll('{n}', String(hitCount))
                  .replaceAll('{size}', kbLabel(selectedBytes))
                  .replaceAll('{cap}', kbLabel(KNOWLEDGE_INJECTION_MAX_BYTES))
                : t('sow.knowledgeEmpty')}
            </div>
            {picks.map((pick) => (
              <label key={pick.record.id} className={styles.sowPickRow}>
                <input
                  type="checkbox"
                  checked={selectedKnowledgeIds.has(pick.record.id)}
                  onChange={() => { toggleKnowledge(pick.record.id) }}
                />
                <span>[{pick.record.trigger.mode}{pick.record.trigger.value !== undefined && pick.record.trigger.value.length > 0 ? `: ${pick.record.trigger.value}` : ''}] {pick.record.title}</span>
              </label>
            ))}
          </div>

          {purpose === 'dev' && workPackage !== undefined ? (
            <div className={styles.sowGroup}>
              <div className={styles.sowGroupTitle}>{t('sow.wpGroup')}</div>
              <label className={styles.sowPickRow}>
                <input
                  type="checkbox"
                  checked={includeBoundaryPlan}
                  onChange={() => { setIncludeBoundaryPlan(!includeBoundaryPlan); setCopyFailed(false) }}
                />
                <span>{t('sow.wpBoundaryPlan')}</span>
              </label>
              {planLoaded && planText === undefined ? <div className={styles.formHint}>{t('sow.wpNoApprovedPlan')}</div> : null}
              {workPackage.dependsOn.length > 0 ? (
                <label className={styles.sowPickRow}>
                  <input
                    type="checkbox"
                    checked={includeDeps}
                    onChange={() => { setIncludeDeps(!includeDeps); setCopyFailed(false) }}
                  />
                  <span>{t('sow.wpDeps')}</span>
                </label>
              ) : null}
            </div>
          ) : null}
        </div>

        <pre className={styles.sowPreview} data-testid="sow-preview">{preview}</pre>
      </div>
    </Modal>
  )
}
