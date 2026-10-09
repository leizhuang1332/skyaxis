/**
 * Split-stale reconciliation (P5b, research §7.6) — pure helpers, no IO.
 *
 * The CLIENT owns the PRD read (it already lists the requirement's prds/
 * directory via the requirements fetcher — the sow-modal cross-module
 * precedent), so the workbench host never touches the requirements ledger or
 * the filesystem: 0002's「独立文件互不持有状态」read-path boundary stays
 * intact. The baseline is a snapshot the client sends at approve /
 * confirm-still-valid; these helpers build it and diff against it.
 *
 * v1 detects two of §7.6's three triggers: PRD change (name set + per-doc
 * size/mtime) and disposed-findings growth (a monotone count — findings carry
 * no disposition timestamp). The third (an approved plan's manual edit) needs
 * a read-time content re-hash projection面 that P5b defers (recorded in
 * milestones); it is already surfaced separately as contentTampered on the
 * plan body, so the user still sees it there.
 */
import type { PrdDocSummary } from '../../requirements-shared/protocol.js'
import type { SplitBaselinePrd, WorkbenchRecord } from '../../workbench-shared/protocol.js'

/** The baseline input the client sends (host mints `at`). */
/**
 * The baseline INPUT the client sends at approve / confirm-still-valid. It
 * carries only the PRD snapshot — the disposed-findings count is host-derived
 * (the host reads it off the very record it stamps), so the client never
 * sends it and it can never disagree with the ledger.
 */
export interface SplitBaselineInput {
  readonly prd: readonly SplitBaselinePrd[]
}

/** A finding is disposed once it leaves 'open' (resolved or wont-fix). */
export function disposedFindingsCount(record: WorkbenchRecord): number {
  return record.findings.filter((finding) => finding.status !== 'open').length
}

/** Snapshot the current PRD listing into a baseline input. */
export function buildSplitBaseline(prd: readonly PrdDocSummary[]): SplitBaselineInput {
  return { prd: prd.map((doc) => ({ name: doc.name, size: doc.size, modifiedAt: doc.modifiedAt })) }
}

export type SplitStaleReason = 'prd' | 'findings'

/**
 * Why the approved split may be stale. Empty = not stale, OR no baseline to
 * compare / PRD listing still loading (honest absence — never a false alarm,
 * and never a badge over data we don't have).
 */
export function splitStaleReasons(record: WorkbenchRecord, prd: readonly PrdDocSummary[] | null): readonly SplitStaleReason[] {
  const baseline = record.splitBaseline
  if (baseline === undefined) return []
  const reasons: SplitStaleReason[] = []
  if (prd !== null) {
    const baselineByName = new Map(baseline.prd.map((doc) => [doc.name, doc]))
    const currentByName = new Map(prd.map((doc) => [doc.name, doc]))
    const prdChanged = baselineByName.size !== currentByName.size
      || [...currentByName].some(([name, doc]) => {
        const before = baselineByName.get(name)
        return before === undefined || before.size !== doc.size || before.modifiedAt !== doc.modifiedAt
      })
    if (prdChanged) reasons.push('prd')
  }
  if (disposedFindingsCount(record) > baseline.disposedFindings) reasons.push('findings')
  return reasons
}
