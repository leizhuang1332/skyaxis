/**
 * SOW generation modal (0006 P2; research 0006 §7.1): left pick column
 * (knowledge hits / dev work-package scope) over a right PREVIEW that
 * renders the buildSow markdown by default (0021 渲染轮 — MarkdownText, the
 * work-package-dialog precedent) with an edit toggle into the 0009 textarea
 * editor. The TEXT behind either face is what the copy/deliver verbs use
 * (markdown source — the wire format; a dirty edit survives left-column
 * toggles and view swaps; the 恢复生成内容 button resyncs to the live
 * build).
 *
 * 0009 任务书精简轮: the PRD pick group is dev/review-only (their five-block
 * SOW embeds checked sections); analysis/split/consolidate cite paths — the
 * doc listing rides the input block, no focus doc, no section checkboxes.
 * split additionally fetches NO PRD face at all (the finalized requirement
 * baseline doc is THE requirement source — 0009 D2). 0012: plan joins.
 *
 * 0015: dev/review join the no-PRD-face arm — the section-checkbox group,
 * the focus-doc select, and the doc-body chain (fetchPrdText) RETIRE for
 * every purpose. Only analysis/consolidate still pull the PRD LISTING (the
 * all-docs 必读 rows); dev/review cite the ledger-decided baseline doc line.
 *
 * All IO is injected (the repos-section cross-module fetcher precedent):
 * the PRD list defaults to the requirements fetcher, the approved plan body
 * defaults to the workbench artifacts endpoint, clipboard defaults to
 * writeClipboard. Knowledge rows arrive server-filtered
 * (requirement ∪ global, both statuses) — the active filter + trigger
 * matching happen here via matchKnowledge. Injection caps
 * (KNOWLEDGE_INJECTION_MAX_ENTRIES/BYTES) disable copy with an honest warn.
 *
 * Transient payloads (PRD list, plan body, edited preview) live in
 * component state and die with the dialog — never the store (the plan-body
 * cache precedent).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MarkdownText, Modal, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
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
import { buildSow, knowledgeBytes, matchKnowledge } from './sow.js'
import styles from './view.module.css'

const kbLabel = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`

/** PRD doc listing, defaulting to the requirements endpoint (JSON envelope). */
async function defaultPrdList(requirementId: string): Promise<{ name: string; sizeBytes?: number }[] | null> {
  const result = await createRequirementsFetcher().prdDocs(requirementId)
  return result.kind === 'ok' ? result.docs.map((doc) => ({ name: doc.name, sizeBytes: doc.size })) : null
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
  purpose: 'analysis' | 'plan' | 'split' | 'consolidate' | 'dev' | 'review' | 'wp-plan'
  requirement: RequirementRecord
  record: WorkbenchRecord | null
  /** Server-filtered requirement ∪ global view (may carry archived rows — filtered active here). */
  knowledgeRecords: readonly WorkbenchKnowledgeRecord[]
  revision: number
  workPackage?: WorkbenchWorkPackage
  busy?: boolean
  onClose: () => void
  /** sizeBytes optional so injected fakes can list names only. */
  fetchPrdList?: () => Promise<{ name: string; sizeBytes?: number }[] | null>
  /** dev context: approved plan body; undefined when none approved. */
  fetchPlanText?: () => Promise<string | undefined>
  copy?: (text: string) => Promise<boolean>
  /** P5a delivery face — absent ⇒ no delivery button (copy stays the fallback). */
  deliver?: (text: string, workspacePath: string | undefined) => Promise<{ ok: boolean; sessionId?: string; sent?: boolean; reason?: 'no-service' | 'failed' }>
  /** 回传轮: fired with the delivered session's id + the full SOW text right
   *  before close — the view binds the session with the task-book anchor (the
   *  SOW head content-addresses the real conversation when the created
   *  session proves to be a shell). 0017 刀一: `sent` marks the v3 auto-send
   *  (true) versus the degraded draft tail (false) — the 刀二 dev bind gates
   *  on it; degraded deliveries must not bind at delivery (0016 修订 #95). */
  onDelivered?: (sessionId: string, sowText: string, sent: boolean) => void
}): ReactNode {
  const { t, open, purpose, requirement, record, knowledgeRecords, revision, workPackage } = props
  const busy = props.busy === true

  // --- PRD state (lazy per open; a stale list response must not win) ---
  const prdSeqRef = useRef(0)
  const [prdDocs, setPrdDocs] = useState<readonly { name: string; sizeBytes?: number }[] | null>(null)

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
  // P5a/0017 delivery state — success CLOSES the modal (v3: the prompt went
  // out, the workbench stays put; degraded: the session page opened with the
  // draft and the user sends). Failure keeps the modal with an alert; copy
  // remains the manual fallback.
  const [deliverState, setDeliverState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const copyTimerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
  }, [])

  const [generatedAt, setGeneratedAt] = useState(() => new Date().toISOString())

  // --- edited preview (0009): null = show/copy the live buildSow output;
  // once the user types, the edit wins until 恢复生成内容 resets to null. ---
  const [editedText, setEditedText] = useState<string | null>(null)

  // 0021 渲染轮: the preview face defaults to RENDERED markdown; the toggle
  // button swaps in the 0009 textarea editor. Edits survive the swap — the
  // rendered pane shows `text` (editedText ?? preview), same WYSIWYG text the
  // copy/deliver verbs use.
  const [editMode, setEditMode] = useState(false)

  // Open → reset and lazily pull the PRD listing (analysis/consolidate only);
  // dev pulls the plan.
  useEffect(() => {
    if (!open) return undefined
    const seq = ++prdSeqRef.current
    const dead = (): boolean => prdSeqRef.current !== seq
    setPrdDocs(null)
    setPlanLoaded(purpose !== 'dev')
    setPlanText(undefined)
    setIncludeBoundaryPlan(true)
    setIncludeDeps(false)
    setCheckedKnowledge(null)
    setCopyState('idle')
    setCopyFailed(false)
    setGeneratedAt(new Date().toISOString())
    setEditedText(null)
    setEditMode(false)
    void (async () => {
      // 0009 D2: split has no PRD face at all — no listing, no focus doc (the
      // baseline doc line rides the ledger, the input block carries it).
      // 0012: plan joins verbatim. 0015: dev/review join — the [PRD 节选]
      // embed retired, the baseline-doc 必读 line + repo rows replace it.
      if (purpose !== 'analysis' && purpose !== 'consolidate') return
      let docs: { name: string }[] | null = null
      try {
        docs = await (props.fetchPrdList ?? (() => defaultPrdList(requirement.id)))()
      } catch {
        docs = null
      }
      if (dead()) return
      if (docs === null) return // stays null ⇒ the input block's honest-unknown line
      setPrdDocs(docs)
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
    // 0018: wp-plan joins dev — the knowledge triggers match on the WP's own
    // words too (its boundary IS the planning subject).
    if ((purpose === 'dev' || purpose === 'wp-plan') && workPackage !== undefined) parts.push(workPackage.title, workPackage.boundary)
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
  // Analysis-only inputs (research 0008): linked repos as clone-dir rows —
  // the pool-name join is already here for the path trigger, same fetch,
  // second consumer. Unresolved names count into the honest-absence line
  // instead of a fabricated directory (the contextPaths degradation
  // precedent).
  const analysisRepoRows = useMemo(
    () => requirement.linkedRepos.flatMap((linked) => {
      const name = repoNames.get(linked.repoId)
      return name === undefined ? [] : [{ dirName: repoDirName(name, linked.repoId), poolName: name, branch: linked.branch }]
    }),
    [requirement.linkedRepos, repoNames],
  )
  const analysisRepoUnknown = requirement.linkedRepos.length - analysisRepoRows.length
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
    // 0018: wp-plan carries the WP unconditionally (the boundary is the
    // planning subject, not an optional embed); dev keeps its scope toggle.
    workPackage: purpose === 'wp-plan' ? workPackage : (purpose === 'dev' && includeBoundaryPlan ? workPackage : undefined),
    approvedPlanText: purpose === 'dev' && planLoaded ? planText : undefined,
    knowledgePicks: selectedKnowledge,
    includeDeps,
    // 0015: every purpose cites paths (baseline-doc line + repo rows ride the
    // input block); only analysis/consolidate carry the prds/ listing
    // (all-docs 必读 rows). PRD text itself is never embedded anywhere.
    ...(purpose === 'analysis' || purpose === 'consolidate' ? {
      analysisPrdDocs: prdDocs,
    } : {}),
    analysisRepos: analysisRepoRows,
    analysisUnknownRepos: analysisRepoUnknown,
  }), [purpose, requirement, record, revision, generatedAt, workPackage, includeBoundaryPlan, planLoaded, planText, selectedKnowledge, includeDeps, prdDocs, analysisRepoRows, analysisRepoUnknown])

  // The user edit (if any) wins over the live build; copy/deliver/anchors
  // all use THIS text (0009).
  const text = editedText ?? preview

  // Stable identity — MarkdownText's memo drops its render cache otherwise
  // (the prd-section labels-memo precedent).
  const markdownLabels = useMemo(() => ({
    code: { copyLabel: t('md.copyCode'), copiedLabel: t('md.copiedCode') },
    footnotes: t('md.footnotes'),
  }), [t])

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
    void (props.copy ?? writeClipboard)(text).then((ok) => {
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
    void props.deliver?.(text, requirement.workspacePath).then((outcome) => {
      if (outcome.ok) {
        setDeliverState('idle')
        if (outcome.sessionId !== undefined) props.onDelivered?.(outcome.sessionId, text, outcome.sent === true)
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
            {editedText !== null ? (
              <button type="button" className={styles.ghostButton} onClick={() => { setEditedText(null) }}>{t('sow.resetEdit')}</button>
            ) : null}
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
          {/* 0015: the PRD pick group (doc select + section checkboxes) is
              RETIRED — dev/review were its last consumers. Every purpose's
              requirement basis rides the document's [输入]/## 输入 block:
              the ledger-decided baseline-doc line (split/plan/dev/review) or
              the all-docs 必读 listing (analysis/consolidate). */}
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

        {/* 0021 渲染轮: rendered markdown is the default face; the toggle
            swaps in the 0009 textarea editor (edits survive the swap). The
            column wrapper keeps the toggle bar + face as ONE grid child. */}
        <div className={styles.sowPreviewColumn}>
          <div className={styles.sowEditBar}>
            <button
              type="button"
              className={styles.ghostButton}
              data-testid="sow-view-toggle"
              onClick={() => { setEditMode((prev) => !prev) }}
            >
              {editMode ? t('md.preview') : t('md.edit')}
            </button>
          </div>
          {editMode ? (
            <textarea
              className={styles.sowEditor}
              data-testid="sow-preview"
              value={text}
              spellCheck={false}
              onChange={(event) => { setEditedText(event.target.value) }}
            />
          ) : (
            <div className={styles.sowRendered} data-testid="sow-rendered">
              <MarkdownText text={text} labels={markdownLabels} />
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
