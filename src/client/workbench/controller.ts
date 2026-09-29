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
import type { WorkbenchFinding, WorkbenchKnowledgeRecord, WorkbenchRecord } from '../../workbench-shared/protocol.js'
import type { WorkbenchStore } from './store.js'
import type { WorkbenchFailure, WorkbenchFetcher, WorkbenchMutateResult } from './fetcher.js'

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
   *  seq-guarded SWR so a late older response can't clobber a newer slice. */
  async function openKnowledge(requirementId: string, signal?: AbortSignal): Promise<void> {
    const seq = (knowledgeSeqByRequirement.get(requirementId) ?? 0) + 1
    knowledgeSeqByRequirement.set(requirementId, seq)
    if ((store.getSnapshot().knowledgeByRequirement[requirementId]?.phase ?? 'loading') !== 'ready') {
      patchKnowledge(requirementId, { phase: 'loading' })
    }
    const result = await fetcher.knowledgeList(requirementId, signal)
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
    approveSplit: (requirementId: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.approveSplit(requirementId, slotRevision(requirementId), signal), signal),
    revokeSplitApproval: (requirementId: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.revokeSplitApproval(requirementId, slotRevision(requirementId), signal), signal),
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

    // --- P2: session binding + knowledge candidates (main union mutations) ---

    bindSession: (requirementId: string, id: string, sessionId: string, purpose: 'analysis' | 'dev' | 'review', signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.bindSession(requirementId, slotRevision(requirementId), id, sessionId, purpose, signal), signal),

    editKnowledgeCandidate: (requirementId: string, id: string, candidate: { title: string; draft: string; type: 'business' | 'convention' }, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.editKnowledgeCandidate(requirementId, slotRevision(requirementId), id, candidate, signal), signal),

    dismissKnowledgeCandidate: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => fetcher.dismissKnowledgeCandidate(requirementId, slotRevision(requirementId), id, signal), signal),

    /** Dual-ledger activate: on success both the main slot AND the knowledge
     *  slice re-pull (the promote wrote workbench.yaml + a knowledge row). */
    activateKnowledgeCandidate: async (requirementId: string, id: string, knowledge: { scope: 'global' | 'workspace' | 'requirement'; type: 'business' | 'convention'; trigger: { mode: 'always' | 'keyword' | 'manual'; value?: string }; path?: string }, signal?: AbortSignal): Promise<boolean> => {
      const ok = await mutate(requirementId, () => fetcher.activateKnowledgeCandidate(requirementId, slotRevision(requirementId), id, knowledge, signal), signal)
      if (ok) await openKnowledge(requirementId, signal)
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
        await openKnowledge(requirementId, signal)
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
        await openKnowledge(requirementId, signal)
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
