/**
 * Repos-pool UI store: the page's projection of the endpoint state.
 *
 * Lifecycle follows the task-graph precedent — created in the registration
 * closure, destroyed with the apply disposer, no store seat. Form-internal
 * state (field values, validate outcome, acknowledged checkbox) deliberately
 * lives in the form component's useState: it is short-lived and has no
 * readers outside the form.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RepoRecord } from '../../repos-pool-shared/protocol.js'

export interface ReposPoolState {
  phase: 'loading' | 'ready' | 'degraded' | 'load-error'
  revision: number
  repos: readonly RepoRecord[]
  degraded?: { reason: 'parse' | 'schema' | 'io'; hasBackup: boolean }
  editing: { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; repo: RepoRecord }
  busy: boolean
  banner?: {
    code: 'conflict' | 'network' | 'unreadable-file' | 'not-found' | 'bad-request' | 'invalid-url' | 'duplicate-url' | 'internal'
    revision?: number
  }
}

const INITIAL_STATE: ReposPoolState = {
  phase: 'loading',
  revision: 0,
  repos: [],
  editing: { kind: 'closed' },
  busy: false,
}

export function createReposPoolStore() {
  return createSnapshotStore<ReposPoolState>(INITIAL_STATE, { flush: 'raf' })
}

export type ReposPoolStore = ReturnType<typeof createReposPoolStore>
