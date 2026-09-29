/**
 * Workbench UI store: per-requirement slots keyed by requirementId.
 *
 * Lifecycle follows the repos-pool closure precedent — created in the
 * registration closure, destroyed with the apply disposer. The keyed main
 * slot has no keep-alive: a panel switch unmounts the seat component and
 * its useState dies, while this store survives the round-trip — switching
 * tabs and coming back re-renders the last snapshot instantly (the SWR
 * anti-flash contract) while a background revalidation lands.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PlanFileExistsRow, ReviewFileExistsRow, WorkbenchRecord } from '../../workbench-shared/protocol.js'

export interface RequirementWorkbenchState {
  phase: 'loading' | 'ready' | 'degraded' | 'load-error'
  /** The workbench ledger revision this slot last saw (write bookkeeping). */
  revision: number
  record: WorkbenchRecord | null
  /** Response-plane existence rows (never ledger fields — decisions/0005 细化④). */
  planFileExists: readonly PlanFileExistsRow[]
  reviewFileExists: readonly ReviewFileExistsRow[]
  degraded?: { reason: 'parse' | 'schema' | 'io'; hasBackup: boolean }
  busy: boolean
  banner?: {
    code: 'conflict' | 'network' | 'unreadable-file' | 'not-found' | 'bad-request' | 'internal'
    revision?: number
  }
}

export interface WorkbenchState {
  readonly byRequirement: Readonly<Record<string, RequirementWorkbenchState>>
}

const INITIAL_STATE: WorkbenchState = { byRequirement: {} }

export function slotFor(state: WorkbenchState, requirementId: string): RequirementWorkbenchState {
  return state.byRequirement[requirementId] ?? {
    phase: 'loading',
    revision: 0,
    record: null,
    planFileExists: [],
    reviewFileExists: [],
    busy: false,
  }
}

export function createWorkbenchStore() {
  return createSnapshotStore<WorkbenchState>(INITIAL_STATE, { flush: 'raf' })
}

export type WorkbenchStore = ReturnType<typeof createWorkbenchStore>
