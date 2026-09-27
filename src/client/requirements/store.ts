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
 *
 * detailTabByRequirement and listFilter are the same page-level family
 * (0004): they ride the store because the host's keyed main slot has no
 * keep-alive — a panel switch unmounts the page component and its useState
 * dies, while the store (registration-closure lifetime) survives the
 * round-trip. The tab is a PER-REQUIREMENT memory: every entry path (list
 * or switcher) lands on the requirement's remembered tab, and only remove()
 * retires an entry; tab-seat internals stay component-local (pull-model,
 * self-healing on remount).
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
  /** Per-requirement active-tab memory (0004 follow-up): the last tab each
   *  requirement was viewed on; entering one falls back to the first tab
   *  until it has an entry here. */
  detailTabByRequirement: Readonly<Record<string, string>>
  /** List filter text; survives panel round-trips, cleared never (list-scoped). */
  listFilter: string
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
  detailTabByRequirement: {},
  listFilter: '',
  busy: false,
}

export function createRequirementsStore() {
  return createSnapshotStore<RequirementsState>(INITIAL_STATE, { flush: 'raf' })
}

export type RequirementsStore = ReturnType<typeof createRequirementsStore>
