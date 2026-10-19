/**
 * Workbench controller: fetch → store orchestration over per-requirement
 * slots (the requirements controller shape, keyed). Owns no subscriptions —
 * the seat pulls `open(requirementId)` on mount.
 *
 * SWR anti-flash contract: a slot that already holds a ready snapshot keeps
 * rendering it while a revalidation runs in the background, and a FAILED
 * revalidation keeps the old snapshot too (only the banner moves) — the
 * requirements repos-section nonce pattern, lifted into the store layer.
 * Per-requirement refresh sequence numbers keep a late older response from
 * overwriting a newer slot snapshot. Write outcomes update the slot in
 * place; conflict/not-found self-heal by re-pulling the slot.
 */
import type { DevDeclareSeedMissing, SeedMissingReason, WorkbenchFinding, WorkbenchKnowledgeRecord, WorkbenchRecord } from '../../workbench-shared/protocol.js'
import type { WorkbenchStore } from './store.js'
import type { WorkbenchFailure, WorkbenchFetcher, WorkbenchMutateResult } from './fetcher.js'
import type { SplitBaselineInput } from './split-stale.js'

/** seedAnalysisQuiet outcome — the zero-write advisory triple (reason + scan fingerprint + shell flag). */
export interface SeedOutcome {
  readonly miss?: SeedMissingReason
  readonly scan?: string
  readonly shell?: boolean
}

/** seedDevDeclareQuiet outcome — landed = a slot exists after the call (miss = the disclosed zero-write reason);
 *  revision = the response's post-call value (the register watcher threads it through its sequential sweep). */
export interface DevSeedOutcome {
  readonly landed: boolean
  readonly miss?: DevDeclareSeedMissing
  readonly revision?: number
}

/** importReview outcome — ok carries the seeded count + advisory blockError for honest disclosure. */
export type ReviewImportOutcome =
  | { readonly ok: true; readonly reviewId: string | null; readonly seeded: number; readonly blockError?: 'no-review-block' | 'yaml-syntax'; readonly blockErrorLine?: number }
  | { readonly ok: false }

export function createWorkbenchController(store: WorkbenchStore, fetcher: WorkbenchFetcher) {
  let disposed = false
  const refreshSeqByRequirement = new Map<string, number>()
  const knowledgeSeqByRequirement = new Map<string, number>()
  const alive = <T>(value: T | undefined): value is T => value !== undefined && !disposed

  function patchSlot(requirementId: string, partial: Partial<Parameters<WorkbenchStore['set']>[0]['byRequirement'][string]>): void {
    if (disposed) return
    const snapshot = store.getSnapshot()
    const current = snapshot.byRequirement[requirementId] ?? {
      phase: 'loading' as const,
      revision: 0,
      record: null,
      planFileExists: [],
      reviewFileExists: [],
      releaseDrifted: [],
      busy: false,
    }
    store.set({
      ...snapshot,
      byRequirement: {
        ...snapshot.byRequirement,
        [requirementId]: { ...current, ...partial },
      },
    })
  }

  function patchKnowledge(requirementId: string, partial: Partial<Parameters<WorkbenchStore['set']>[0]['knowledgeByRequirement'][string]>): void {
    if (disposed) return
    const snapshot = store.getSnapshot()
    const current = snapshot.knowledgeByRequirement[requirementId] ?? {
      phase: 'loading' as const,
      revision: 0,
      records: [],
    }
    store.set({
      ...snapshot,
      knowledgeByRequirement: {
        ...snapshot.knowledgeByRequirement,
        [requirementId]: { ...current, ...partial },
      },
    })
  }

  /** Knowledge-slice pull (S6 view + SOW modal consumers); mirrors open()'s
   *  seq-guarded SWR so a late older response can't clobber a newer slice.
   *  workspacePath (P5a) carries the requirement's workspace for the
   *  user-ratiated workspace-row visibility filter. */
  async function openKnowledge(requirementId: string, workspacePath?: string, signal?: AbortSignal): Promise<void> {
    const seq = (knowledgeSeqByRequirement.get(requirementId) ?? 0) + 1
    knowledgeSeqByRequirement.set(requirementId, seq)
    if ((store.getSnapshot().knowledgeByRequirement[requirementId]?.phase ?? 'loading') !== 'ready') {
      patchKnowledge(requirementId, { phase: 'loading' })
    }
    const result = await fetcher.knowledgeList(requirementId, workspacePath, signal)
    if (!alive(result) || knowledgeSeqByRequirement.get(requirementId) !== seq) return
    if (result.kind === 'ok') {
      patchKnowledge(requirementId, {
        phase: 'ready',
        revision: result.revision,
        records: result.records,
        degraded: undefined,
      })
      return
    }
    if (result.kind === 'degraded') {
      patchKnowledge(requirementId, { phase: 'degraded', degraded: { reason: result.reason, hasBackup: result.hasBackup }, records: [] })
      return
    }
    const staysReady = store.getSnapshot().knowledgeByRequirement[requirementId]?.phase === 'ready'
    patchKnowledge(requirementId, { ...(staysReady ? {} : { phase: 'load-error' as const }) })
  }

  /** Mount pull / explicit refresh for one requirement's slot. */
  async function open(requirementId: string, signal?: AbortSignal): Promise<void> {
    const seq = (refreshSeqByRequirement.get(requirementId) ?? 0) + 1
    refreshSeqByRequirement.set(requirementId, seq)
    // Anti-flash: only a slot with nothing to show goes to 'loading'.
    if ((store.getSnapshot().byRequirement[requirementId]?.phase ?? 'loading') !== 'ready') {
      patchSlot(requirementId, { phase: 'loading' })
    }
    const result = await fetcher.detail(requirementId, signal)
    if (!alive(result) || refreshSeqByRequirement.get(requirementId) !== seq) return
    if (result.kind === 'ok') {
      patchSlot(requirementId, {
        phase: 'ready',
        revision: result.revision,
        record: result.record,
        planFileExists: result.planFileExists,
        reviewFileExists: result.reviewFileExists,
        releaseDrifted: result.releaseDrifted,
        degraded: undefined,
      })
      return
    }
    if (result.kind === 'http-error' && result.status === 409) {
      // Unreadable ledger — the detail channel carries no reason/hasBackup
      // (the list envelope does); degraded copy stays generic here.
      patchSlot(requirementId, { phase: 'degraded', degraded: undefined, record: null })
      return
    }
    // Failed revalidation keeps a ready snapshot (only the banner moves).
    const staysReady = store.getSnapshot().byRequirement[requirementId]?.phase === 'ready'
    patchSlot(requirementId, { banner: failureBanner(result), ...(staysReady ? {} : { phase: 'load-error' }) })
  }

  function failureBanner(result: WorkbenchFailure): { code: 'conflict' | 'network' | 'unreadable-file' | 'not-found' | 'bad-request' | 'internal' | 'locked-split' | 'locked-version'; revision?: number } {
    if (result.kind === 'network') return { code: 'network' }
    if (result.status === 409 && result.code === 'conflict') return { code: 'conflict', revision: result.currentRevision }
    if (result.status === 409) return { code: 'unreadable-file' }
    if (result.status === 404) return { code: 'not-found' }
    if (result.code !== undefined) return { code: result.code as 'bad-request' | 'internal' | 'locked-split' | 'locked-version' }
    return { code: 'internal' }
  }

  async function mutate(requirementId: string, run: () => Promise<WorkbenchMutateResult>, signal?: AbortSignal): Promise<boolean> {
    patchSlot(requirementId, { busy: true })
    const result = await run()
    if (!alive(result)) return false
    if (result.kind === 'ok') {
      patchSlot(requirementId, { busy: false, revision: result.revision, record: result.record, banner: undefined })
      return true
    }
    patchSlot(requirementId, { busy: false, banner: failureBanner(result) })
    // Self-heal: conflict / not-found realign the slot with the live ledger.
    if (result.kind === 'http-error' && (result.status === 409 || result.status === 404)) {
      await open(requirementId, signal)
    }
    return false
  }

  /** Revision the slot currently holds (0 for an unloaded slot — implicit-create actions still land). */
  const slotRevision = (requirementId: string): number =>
    store.getSnapshot().byRequirement[requirementId]?.revision ?? 0

  return {
    open,
    advanceStage: (requirementId: string, stage: WorkbenchRecord['stage'], signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.advanceStage(requirementId, slotRevision(requirementId), stage, undefined, signal), signal),
    saveFinding: (requirementId: string, finding: Omit<WorkbenchFinding, 'id' | 'createdAt'> & { id?: string }, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.saveFinding(requirementId, slotRevision(requirementId), finding, signal), signal),
    removeFinding: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.removeFinding(requirementId, slotRevision(requirementId), id, signal), signal),

    // Work-package CRUD (hard gate ①).
    saveWorkPackage: (requirementId: string, workPackage: { id?: string; title: string; boundary: string; dependsOn: readonly string[]; parallel?: boolean; covers: readonly string[] }, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.saveWorkPackage(requirementId, slotRevision(requirementId), workPackage, signal), signal),
    removeWorkPackage: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.removeWorkPackage(requirementId, slotRevision(requirementId), id, signal), signal),
    moveWorkPackage: (requirementId: string, id: string, direction: 'up' | 'down', signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.moveWorkPackage(requirementId, slotRevision(requirementId), id, direction, signal), signal),

    // Hard gates + state machine.
    approveSplit: (requirementId: string, baseline?: SplitBaselineInput, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.approveSplit(requirementId, slotRevision(requirementId), baseline, signal), signal),
    revokeSplitApproval: (requirementId: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.revokeSplitApproval(requirementId, slotRevision(requirementId), signal), signal),
    // 0007 定稿软门 (outside the split lock — a content event, not a contract one).
    approveUnderstand: (requirementId: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.approveUnderstand(requirementId, slotRevision(requirementId), signal), signal),
    revokeUnderstand: (requirementId: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.revokeUnderstand(requirementId, slotRevision(requirementId), signal), signal),
    // 0012 采纳软门 (same shape — the plan-stage content event).
    adoptPlan: (requirementId: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.adoptPlan(requirementId, slotRevision(requirementId), signal), signal),
    revokePlanAdoption: (requirementId: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.revokePlanAdoption(requirementId, slotRevision(requirementId), signal), signal),
    // P5b §7.6 stale reconciliation actions.
    reSplit: (requirementId: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.reSplit(requirementId, slotRevision(requirementId), signal), signal),
    confirmSplitStillValid: (requirementId: string, baseline: SplitBaselineInput, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.confirmSplitStillValid(requirementId, slotRevision(requirementId), baseline, signal), signal),
    approvePlan: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.approvePlan(requirementId, slotRevision(requirementId), id, signal), signal),
    startWorkPackage: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.startWorkPackage(requirementId, slotRevision(requirementId), id, signal), signal),
    markWorkPackageBuilt: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.markWorkPackageBuilt(requirementId, slotRevision(requirementId), id, signal), signal),
    acceptWorkPackage: (requirementId: string, id: string, result: 'pass' | 'fail', note?: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.acceptWorkPackage(requirementId, slotRevision(requirementId), id, result, note, signal), signal),
    reopenWorkPackage: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.reopenWorkPackage(requirementId, slotRevision(requirementId), id, signal), signal),
    dropWorkPackage: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.dropWorkPackage(requirementId, slotRevision(requirementId), id, signal), signal),
    restoreWorkPackage: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.restoreWorkPackage(requirementId, slotRevision(requirementId), id, signal), signal),

    // Criteria.
    saveCriterion: (requirementId: string, criterion: { id?: string; text: string; sourceSection?: string }, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.saveCriterion(requirementId, slotRevision(requirementId), criterion, signal), signal),
    removeCriterion: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.removeCriterion(requirementId, slotRevision(requirementId), id, signal), signal),

    // --- P3a: release items + rollback-plan stamp (outside the split gate) ---

    saveReleaseItem: (requirementId: string, releaseItem: { id?: string; type: 'sql' | 'config' | 'flag' | 'mq' | 'other'; title: string; content: string; envs: readonly string[]; workPackageId?: string; sessionId?: string; note?: string }, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.saveReleaseItem(requirementId, slotRevision(requirementId), releaseItem, signal), signal),

    removeReleaseItem: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.removeReleaseItem(requirementId, slotRevision(requirementId), id, signal), signal),

    confirmReleaseItem: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.confirmReleaseItem(requirementId, slotRevision(requirementId), id, signal), signal),

    markReleaseItemApplied: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.markReleaseItemApplied(requirementId, slotRevision(requirementId), id, signal), signal),

    markReleaseItemVerified: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.markReleaseItemVerified(requirementId, slotRevision(requirementId), id, signal), signal),

    rollbackReleaseItem: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.rollbackReleaseItem(requirementId, slotRevision(requirementId), id, signal), signal),

    confirmRollbackPlan: (requirementId: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.confirmRollbackPlan(requirementId, slotRevision(requirementId), signal), signal),

    revokeRollbackPlan: (requirementId: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.revokeRollbackPlan(requirementId, slotRevision(requirementId), signal), signal),

    // --- P4: review verdicts + manual candidate distillation (main-union mutations) ---

    saveReviewVerdict: (requirementId: string, reportId: string, verdict: { id?: string; title: string; severity: 'high' | 'medium' | 'low'; verdict: 'confirmed' | 'rejected'; disposition?: 'to-fix' | 'fixed' | 'wont-fix'; note?: string }, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.saveReviewVerdict(requirementId, slotRevision(requirementId), reportId, verdict, signal), signal),

    removeReviewVerdict: (requirementId: string, reportId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.removeReviewVerdict(requirementId, slotRevision(requirementId), reportId, id, signal), signal),

    removeReviewReport: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.removeReviewReport(requirementId, slotRevision(requirementId), id, signal), signal),

    saveKnowledgeCandidate: (requirementId: string, candidate: { title: string; draft: string; type: 'business' | 'convention' }, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.saveKnowledgeCandidate(requirementId, slotRevision(requirementId), candidate, signal), signal),

    /** Review import: the artifact endpoint answers with the revision but NOT
     *  the record (the writePlan shape) — patch the revision, then re-pull.
     *  The byte-identical idempotency anchor makes retries safe. */
    importReview: async (requirementId: string, title: string | undefined, text: string, signal?: AbortSignal): Promise<ReviewImportOutcome | undefined> => {
      patchSlot(requirementId, { busy: true })
      const result = await fetcher.writeReview(requirementId, text, slotRevision(requirementId), title, signal)
      if (!alive(result)) return undefined
      if (result.kind === 'ok') {
        patchSlot(requirementId, { busy: false, revision: result.revision, banner: undefined })
        await open(requirementId, signal)
        return {
          ok: true,
          reviewId: result.anchor.reviewId ?? null,
          seeded: result.anchor.seeded ?? 0,
          ...(result.anchor.reviewBlockError !== undefined ? { blockError: result.anchor.reviewBlockError, blockErrorLine: result.anchor.reviewBlockErrorLine } : {}),
        }
      }
      patchSlot(requirementId, { busy: false, banner: failureBanner(result) })
      if (result.kind === 'http-error' && (result.status === 409 || result.status === 404)) {
        await open(requirementId, signal)
      }
      return { ok: false }
    },

    /** P5b: fetch a session's review report (whole assistant message). Pure read, no store. */
    reviewFetch: (sessionId: string, signal?: AbortSignal) =>
      fetcher.reviewFetch(sessionId, signal),

    /** 0016 P1b: session-digest tail-window fetch. Pure read, no store, no busy (the declareFetch precedent). */
    sessionDigest: (sessionId: string, signal?: AbortSignal) =>
      fetcher.sessionDigest(sessionId, signal),

    /** 挂账轮: global orphan/missing/trash reconciliation scan. Pure read, no
     *  store — the scan modal owns loading/failed states and filters rows by
     *  the CURRENT requirement (the join stays client-side by design). */
    scan: (signal?: AbortSignal) =>
      fetcher.scan(signal),

    reviewContent: async (requirementId: string, reviewId: string, signal?: AbortSignal) => {
      const result = await fetcher.reviewContent(requirementId, reviewId, signal)
      return alive(result) ? result : undefined
    },

    // --- P3b: declare-block import (the repos-pool importRepos contract:
    // failures are RETURNED for the dialog to present, never bannered; the
    // real import carries the revision the DRY-RUN response returned). ---

    /** Session declare fetch — pure read, no store, no busy. */
    declareFetch: (sessionId: string, signal?: AbortSignal) =>
      fetcher.declareFetch(sessionId, signal),

    /** Parse-only preview — dialog-local state, the store is untouched. The
     *  revision is read internally (the CURRENT slot); the anchor rule applies
     *  to the REAL import, which must carry the revision the dry-run returned.
     *  0016: devDeclare threads the WP-slot key through (declareStale advisory). */
    declarePreview: (requirementId: string, text: string, devDeclare?: { workPackageId: string }, signal?: AbortSignal) =>
      fetcher.declarePreview(requirementId, slotRevision(requirementId), text, devDeclare, signal),

    /**
     * Real import: patches the slot in place on success (the commit response
     * carries the record) and hands the report back for the dialog's done
     * state. conflict/network stay in the RESULT — the dialog owns them.
     * 0016: devDeclare stamps the slot imported + the declarations receipt
     * atomically server-side.
     */
    declareImport: async (requirementId: string, text: string, selected: readonly string[], expectedRevision: number, sessionId: string | undefined, devDeclare?: { workPackageId: string }, signal?: AbortSignal) => {
      patchSlot(requirementId, { busy: true })
      const result = await fetcher.declareImport(requirementId, expectedRevision, text, selected, sessionId, devDeclare, signal)
      if (!alive(result)) return undefined
      if (result.kind === 'ok') {
        patchSlot(requirementId, { busy: false, revision: result.committed.revision, record: result.committed.record, banner: undefined })
        return result.committed.report
      }
      patchSlot(requirementId, { busy: false })
      return result
    },

    /**
     * Plan draft write: the artifact endpoint answers with the revision but
     * NOT the record (the ledger side-effect runs there — plans append /
     * status flips). Patch the revision, then re-pull the slot so the UI
     * converges with the ledger in one round trip. Locked-* 400s only move
     * the banner — the generic self-heal (409/404) already covers races.
     */
    writePlan: async (requirementId: string, workPackageId: string, text: string, signal?: AbortSignal): Promise<boolean> => {
      patchSlot(requirementId, { busy: true })
      const result = await fetcher.writePlan(requirementId, workPackageId, text, slotRevision(requirementId), undefined, signal)
      if (!alive(result)) return false
      if (result.kind === 'ok') {
        patchSlot(requirementId, { busy: false, revision: result.revision, banner: undefined })
        await open(requirementId, signal)
        return true
      }
      patchSlot(requirementId, { busy: false, banner: failureBanner(result) })
      if (result.kind === 'http-error' && (result.status === 409 || result.status === 404)) {
        await open(requirementId, signal)
      }
      return false
    },

    planContent: async (requirementId: string, workPackageId: string, version: number, signal?: AbortSignal) => {
      const result = await fetcher.planContent(requirementId, workPackageId, version, signal)
      return alive(result) ? result : undefined
    },

    /** 文件交付轮: the workspace analysis report file (pure read, the planContent precedent — no slot churn). */
    analysisReportContent: async (requirementId: string, signal?: AbortSignal) => {
      const result = await fetcher.analysisReportContent(requirementId, signal)
      return alive(result) ? result : undefined
    },

    /** 0008: the requirement-baseline doc file (pure read, the analysisReportContent precedent). */
    requirementDocContent: async (requirementId: string, signal?: AbortSignal) => {
      const result = await fetcher.requirementDocContent(requirementId, signal)
      return alive(result) ? result : undefined
    },

    /** 0012: the technical planning doc file (pure read, the requirementDocContent precedent). */
    planningDocContent: async (requirementId: string, signal?: AbortSignal) => {
      const result = await fetcher.planningDocContent(requirementId, signal)
      return alive(result) ? result : undefined
    },

    /** 0012: the split result file (pure read, same precedent). */
    splitResultContent: async (requirementId: string, signal?: AbortSignal) => {
      const result = await fetcher.splitResultContent(requirementId, signal)
      return alive(result) ? result : undefined
    },

    // --- P2: session binding + knowledge candidates (main union mutations) ---

    bindSession: (requirementId: string, id: string, sessionId: string, purpose: 'analysis' | 'dev' | 'review', signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.bindSession(requirementId, slotRevision(requirementId), id, sessionId, purpose, signal), signal),

    // --- 回传轮: analysis proposals ---

    /** Delivery success → bind the watched session. ONE bounded retry: a 409
     *  means the revision moved between open() and the click; mutate() already
     *  self-healed the slot, so the second attempt rides the fresh revision.
     *  A further failure stays with the banner (honest disclosure) — losing
     *  the bind only costs auto-seeding, never data. */
    bindAnalysisSession: async (requirementId: string, sessionId: string, anchor?: string, signal?: AbortSignal): Promise<boolean> => {
      const first = await mutate(requirementId, () => fetcher.bindAnalysisSession(requirementId, slotRevision(requirementId), sessionId, anchor, signal), signal)
      if (first || disposed) return first
      return mutate(requirementId, () => fetcher.bindAnalysisSession(requirementId, slotRevision(requirementId), sessionId, anchor, signal), signal)
    },

    /** Watcher-only seed face — deliberately NOT the mutate() busy/banner
     *  channel: a missing block is an expected transient (the report may not
     *  exist yet) and busy-toggling on every sessions-list flip would flash
     *  the whole stage. ok → patch slot in place; the zero-write advisory
     *  (seedMissing) is RETURNED so the view can disclose why nothing landed
     *  (回传轮 observability — the silent path was the diagnosis blind spot);
     *  409/404 → open() so an anchor another window (or a racing write)
     *  landed becomes visible — without this re-pull, `due` stays true in
     *  this window while the attempted flag already fired; network → silent
     *  (next flip / remount retries). */
    seedAnalysisQuiet: async (requirementId: string, sessionId: string, signal?: AbortSignal): Promise<SeedOutcome | undefined> => {
      const result = await fetcher.seedAnalysis(requirementId, slotRevision(requirementId), sessionId, signal)
      if (!alive(result)) return undefined
      if (result.kind === 'ok') {
        patchSlot(requirementId, { revision: result.revision, record: result.record, banner: undefined })
        return {
          ...(result.seedMissing !== undefined ? { miss: result.seedMissing } : {}),
          ...(result.seedScan !== undefined ? { scan: result.seedScan } : {}),
          ...(result.seedShell === true ? { shell: true } : {}),
        }
      }
      if (result.kind === 'http-error' && (result.status === 409 || result.status === 404)) {
        await open(requirementId, signal)
      }
      return undefined
    },

    adoptFindingProposal: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.adoptFindingProposal(requirementId, slotRevision(requirementId), id, signal), signal),
    dismissFindingProposal: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.dismissFindingProposal(requirementId, slotRevision(requirementId), id, signal), signal),
    adoptCriterionProposal: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.adoptCriterionProposal(requirementId, slotRevision(requirementId), id, signal), signal),
    dismissCriterionProposal: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.dismissCriterionProposal(requirementId, slotRevision(requirementId), id, signal), signal),
    answerAnalysisClarification: (requirementId: string, id: string, answer: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.answerAnalysisClarification(requirementId, slotRevision(requirementId), id, answer, signal), signal),
    dismissAnalysisClarification: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.dismissAnalysisClarification(requirementId, slotRevision(requirementId), id, signal), signal),

    // --- 0012 两步化: split proposals ---

    /** Delivery success → bind the watched split session (the bindAnalysisSession twin: one bounded 409 retry). */
    bindSplitSession: async (requirementId: string, sessionId: string, anchor?: string, signal?: AbortSignal): Promise<boolean> => {
      const first = await mutate(requirementId, () => fetcher.bindSplitSession(requirementId, slotRevision(requirementId), sessionId, anchor, signal), signal)
      if (first || disposed) return first
      return mutate(requirementId, () => fetcher.bindSplitSession(requirementId, slotRevision(requirementId), sessionId, anchor, signal), signal)
    },

    /** Watcher-only seed face (the seedAnalysisQuiet twin — no busy/banner, ok → in-place patch, advisory returned). */
    seedSplitQuiet: async (requirementId: string, sessionId: string, signal?: AbortSignal): Promise<SeedOutcome | undefined> => {
      const result = await fetcher.seedSplit(requirementId, slotRevision(requirementId), sessionId, signal)
      if (!alive(result)) return undefined
      if (result.kind === 'ok') {
        patchSlot(requirementId, { revision: result.revision, record: result.record, banner: undefined })
        return {
          ...(result.seedMissing !== undefined ? { miss: result.seedMissing } : {}),
          ...(result.seedScan !== undefined ? { scan: result.seedScan } : {}),
          ...(result.seedShell === true ? { shell: true } : {}),
        }
      }
      if (result.kind === 'http-error' && (result.status === 409 || result.status === 404)) {
        await open(requirementId, signal)
      }
      return undefined
    },

    adoptSplitProposals: (requirementId: string, refs: readonly string[], signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.adoptSplitProposals(requirementId, slotRevision(requirementId), refs, signal), signal),
    dismissWorkPackageProposal: (requirementId: string, ref: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.dismissWorkPackageProposal(requirementId, slotRevision(requirementId), ref, signal), signal),

    // --- 0016 P1a: dev-declare container ---

    /** Delivery success → bind the dev session to its WP (the bindAnalysisSession twin: one bounded 409 retry). */
    bindDevSession: async (requirementId: string, workPackageId: string, sessionId: string, signal?: AbortSignal): Promise<boolean> => {
      const first = await mutate(requirementId, () => fetcher.bindSession(requirementId, slotRevision(requirementId), workPackageId, sessionId, 'dev', signal), signal)
      if (first || disposed) return first
      return mutate(requirementId, () => fetcher.bindSession(requirementId, slotRevision(requirementId), workPackageId, sessionId, 'dev', signal), signal)
    },

    /** User dismissal of a collected declaration batch (the card's 忽略 button — the mutate channel, unlike the seeds). */
    adjudicateDevDeclare: (requirementId: string, workPackageId: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.adjudicateDevDeclare(requirementId, slotRevision(requirementId), workPackageId, signal), signal),

    /** 0016 P2b: confirm one commit proposal — appends to wp.commits[] (four-power: user confirms). */
    confirmDevDeclareCommit: (requirementId: string, workPackageId: string, hash: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.confirmDevDeclareCommit(requirementId, slotRevision(requirementId), workPackageId, hash, signal), signal),

    /** Card/view quiet seed face (the seedAnalysisQuiet twin): the CURRENT slot's revision, ok → in-place patch, the
     *  zero-write miss returned for the card's disclosure, 409/404 → open() self-heal. */
    seedDevDeclareQuiet: async (requirementId: string, workPackageId: string, signal?: AbortSignal): Promise<DevSeedOutcome | undefined> => {
      const result = await fetcher.seedDevDeclare(requirementId, slotRevision(requirementId), workPackageId, signal)
      if (!alive(result)) return undefined
      if (result.kind === 'ok') {
        patchSlot(requirementId, { revision: result.revision, record: result.record, banner: undefined })
        return {
          landed: result.devSeedMissing === undefined,
          revision: result.revision,
          ...(result.devSeedMissing !== undefined ? { miss: result.devSeedMissing } : {}),
        }
      }
      if (result.kind === 'http-error' && (result.status === 409 || result.status === 404)) {
        await open(requirementId, signal)
      }
      return undefined
    },

    /**
     * REGISTER-LEVEL watcher seed face (decisions/0016 修订 #2 — the global
     * completion signal must fire for requirements nobody is watching): the
     * caller supplies the revision it holds (fetcher.list's global value) and
     * a slot patches ONLY when one already exists — a never-opened requirement
     * must not gain a phantom 'loading' slot here (the next open() reads the
     * fresh ledger). 409/network stay silent: the next flip retries. The
     * response's revision rides the outcome so the watcher's sequential sweep
     * survives a landed write bumping the file revision.
     */
    seedDevDeclareDetached: async (requirementId: string, expectedRevision: number, workPackageId: string, signal?: AbortSignal): Promise<DevSeedOutcome | undefined> => {
      const result = await fetcher.seedDevDeclare(requirementId, expectedRevision, workPackageId, signal)
      if (!alive(result)) return undefined
      if (result.kind === 'ok') {
        if (store.getSnapshot().byRequirement[requirementId] !== undefined) {
          patchSlot(requirementId, { revision: result.revision, record: result.record, banner: undefined })
        }
        return {
          landed: result.devSeedMissing === undefined,
          revision: result.revision,
          ...(result.devSeedMissing !== undefined ? { miss: result.devSeedMissing } : {}),
        }
      }
      return undefined
    },

    editKnowledgeCandidate: (requirementId: string, id: string, candidate: { title: string; draft: string; type: 'business' | 'convention' }, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.editKnowledgeCandidate(requirementId, slotRevision(requirementId), id, candidate, signal), signal),

    dismissKnowledgeCandidate: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.dismissKnowledgeCandidate(requirementId, slotRevision(requirementId), id, signal), signal),

    /** Dual-ledger activate: on success both the main slot AND the knowledge
     *  slice re-pull (the promote wrote workbench.yaml + a knowledge row). */
    activateKnowledgeCandidate: async (requirementId: string, id: string, knowledge: { scope: 'global' | 'workspace' | 'requirement'; type: 'business' | 'convention'; trigger: { mode: 'always' | 'keyword' | 'manual' | 'path'; value?: string }; path?: string }, signal?: AbortSignal): Promise<boolean> => {
      const ok = await mutate(requirementId, () => fetcher.activateKnowledgeCandidate(requirementId, slotRevision(requirementId), id, knowledge, signal), signal)
      if (ok) await openKnowledge(requirementId, undefined, signal)
      return ok
    },

    // --- P2: knowledge.yaml route (its OWN revision lock) ---

    openKnowledge,

    saveKnowledge: async (requirementId: string, knowledge: { id?: string; scope: 'global' | 'workspace' | 'requirement'; type: 'business' | 'convention'; title: string; content: string; path?: string; requirementId?: string; trigger: { mode: 'always' | 'path' | 'keyword' | 'manual'; value?: string } }, signal?: AbortSignal): Promise<boolean> => {
      patchKnowledge(requirementId, { busy: true })
      const revision = store.getSnapshot().knowledgeByRequirement[requirementId]?.revision ?? 0
      const result = await fetcher.saveKnowledge(revision, knowledge, signal)
      if (!alive(result)) return false
      if (result.kind === 'ok') {
        patchKnowledge(requirementId, { busy: false, revision: result.revision, records: replaceKnowledgeRow(store.getSnapshot().knowledgeByRequirement[requirementId]?.records ?? [], result.record) })
        return true
      }
      patchKnowledge(requirementId, { busy: false })
      patchSlot(requirementId, { banner: failureBanner(result) })
      if (result.kind === 'http-error' && (result.status === 409 || result.status === 404)) {
        await openKnowledge(requirementId, undefined, signal)
      }
      return false
    },

    archiveKnowledge: async (requirementId: string, id: string, signal?: AbortSignal): Promise<boolean> => {
      patchKnowledge(requirementId, { busy: true })
      const revision = store.getSnapshot().knowledgeByRequirement[requirementId]?.revision ?? 0
      const result = await fetcher.archiveKnowledge(revision, id, signal)
      if (!alive(result)) return false
      if (result.kind === 'ok') {
        patchKnowledge(requirementId, { busy: false, revision: result.revision, records: replaceKnowledgeRow(store.getSnapshot().knowledgeByRequirement[requirementId]?.records ?? [], result.record) })
        return true
      }
      patchKnowledge(requirementId, { busy: false })
      patchSlot(requirementId, { banner: failureBanner(result) })
      if (result.kind === 'http-error' && (result.status === 409 || result.status === 404)) {
        await openKnowledge(requirementId, undefined, signal)
      }
      return false
    },

    dismissBanner: (requirementId: string) => patchSlot(requirementId, { banner: undefined }),
    dispose: () => {
      disposed = true
    },
  }
}

/** Records array with `next` replacing its id row (or appended when absent). */
function replaceKnowledgeRow(records: readonly WorkbenchKnowledgeRecord[], next: WorkbenchKnowledgeRecord): readonly WorkbenchKnowledgeRecord[] {
  const exists = records.some((row) => row.id === next.id)
  return exists ? records.map((row) => (row.id === next.id ? next : row)) : [...records, next]
}

export type WorkbenchController = ReturnType<typeof createWorkbenchController>
