/**
 * Requirements UI store: the page's projection of the endpoint state.
 *
 * Lifecycle follows the repos-pool precedent — created in the registration
 * closure, destroyed with the apply disposer, no store seat. Form-internal
 * state (field values, field error) deliberately lives in the form
 * component's useState: it is short-lived and has no readers outside the
 * form.
 *
 * selectedId is a page-level view state like editing, but holds an id
 * reference instead of an inlined record (unlike editing): a refresh swaps
 * the record under it without touching the view, a vanished record falls to
 * the detail view's missing branch, and a future main-slot entry (0003 route
 * decision record) can reuse it verbatim. null = list view, uuid = detail.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'

export interface RequirementsState {
  phase: 'loading' | 'ready' | 'degraded' | 'load-error'
  revision: number
  requirements: readonly RequirementRecord[]
  degraded?: { reason: 'parse' | 'schema' | 'io'; hasBackup: boolean }
  editing: { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; requirement: RequirementRecord }
  selectedId: string | null
  busy: boolean
  banner?: {
    code: 'conflict' | 'network' | 'unreadable-file' | 'not-found' | 'bad-request' | 'internal'
    revision?: number
  }
}

const INITIAL_STATE: RequirementsState = {
  phase: 'loading',
  revision: 0,
  requirements: [],
  editing: { kind: 'closed' },
  selectedId: null,
  busy: false,
}

export function createRequirementsStore() {
  return createSnapshotStore<RequirementsState>(INITIAL_STATE, { flush: 'raf' })
}

export type RequirementsStore = ReturnType<typeof createRequirementsStore>
