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
import type { WorkbenchFinding, WorkbenchRecord } from '../../workbench-shared/protocol.js'
import type { WorkbenchStore } from './store.js'
import type { WorkbenchFailure, WorkbenchFetcher, WorkbenchMutateResult } from './fetcher.js'

export function createWorkbenchController(store: WorkbenchStore, fetcher: WorkbenchFetcher) {
  let disposed = false
  const refreshSeqByRequirement = new Map<string, number>()
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
      byRequirement: {
        ...snapshot.byRequirement,
        [requirementId]: { ...current, ...partial },
      },
    })
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

  function failureBanner(result: WorkbenchFailure): { code: 'conflict' | 'network' | 'unreadable-file' | 'not-found' | 'bad-request' | 'internal'; revision?: number } {
    if (result.kind === 'network') return { code: 'network' }
    if (result.status === 409 && result.code === 'conflict') return { code: 'conflict', revision: result.currentRevision }
    if (result.status === 409) return { code: 'unreadable-file' }
    if (result.status === 404) return { code: 'not-found' }
    if (result.code !== undefined) return { code: result.code as 'bad-request' | 'internal' }
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

  return {
    open,
    advanceStage: (requirementId: string, stage: WorkbenchRecord['stage'], signal?: AbortSignal) =>
      mutate(requirementId, () => {
        const revision = store.getSnapshot().byRequirement[requirementId]?.revision ?? 0
        return fetcher.advanceStage(requirementId, revision, stage, undefined, signal)
      }, signal),
    saveFinding: (requirementId: string, finding: Omit<WorkbenchFinding, 'id' | 'createdAt'> & { id?: string }, signal?: AbortSignal) =>
      mutate(requirementId, () => {
        const revision = store.getSnapshot().byRequirement[requirementId]?.revision ?? 0
        return fetcher.saveFinding(requirementId, revision, finding, signal)
      }, signal),
    removeFinding: (requirementId: string, id: string, signal?: AbortSignal) =>
      mutate(requirementId, () => {
        const revision = store.getSnapshot().byRequirement[requirementId]?.revision ?? 0
        return fetcher.removeFinding(requirementId, revision, id, signal)
      }, signal),
    dismissBanner: (requirementId: string) => patchSlot(requirementId, { banner: undefined }),
    dispose: () => {
      disposed = true
    },
  }
}

export type WorkbenchController = ReturnType<typeof createWorkbenchController>
