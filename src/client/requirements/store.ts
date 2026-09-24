/**
 * Requirements UI store: the page's projection of the endpoint state.
 *
 * Lifecycle follows the repos-pool precedent — created in the registration
 * closure, destroyed with the apply disposer, no store seat. Form-internal
 * state (field values, field error) deliberately lives in the form
 * component's useState: it is short-lived and has no readers outside the
 * form.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'

export interface RequirementsState {
  phase: 'loading' | 'ready' | 'degraded' | 'load-error'
  revision: number
  requirements: readonly RequirementRecord[]
  degraded?: { reason: 'parse' | 'schema' | 'io'; hasBackup: boolean }
  editing: { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; requirement: RequirementRecord }
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
  busy: false,
}

export function createRequirementsStore() {
  return createSnapshotStore<RequirementsState>(INITIAL_STATE, { flush: 'raf' })
}

export type RequirementsStore = ReturnType<typeof createRequirementsStore>
