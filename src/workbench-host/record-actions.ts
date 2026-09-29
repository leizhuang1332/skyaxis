/**
 * Workbench record actions (second knife): the 16-member mutate union as ONE
 * pure function over the loaded record — all business guards live here
 * (zod only sees the wire shape; referential integrity, state-machine
 * legality and gate locks need the parsed record at hand, which is the
 * "wire validation → … → business guards" ladder's bottom rung).
 *
 * Guard ORDER (the pinned ladder, mirrored by the endpoint shell):
 *   target missing → 404 not-found;
 *   hard gate ① lock → 400 locked-split (everything the split contract
 *     freezes: list CRUD, criteria, plan approvals, lifecycle moves, plan
 *     writes — approveSplit/revokeSplitApproval themselves excepted, and
 *     findings/stage stay outside the gate on purpose);
 *   state-machine legality / referential integrity / required-note → 400
 *     bad-request (409 stays reserved for stale-revision + unreadable
 *     ledger — the client self-heals on 409, and a state violation is not
 *     that);
 *   approvePlan on an all-approved chain → 400 locked-version (the read-side
 *     dual of the write pipeline's tail-draft lock).
 *
 * Host-owned fields are never client-writable: workPackage status/plans/
 * sessions/commits/acceptances/order, criteria.coveredBy (recomputed from
 * covers after every list change), finding id/createdAt, plan approvedAt.
 */
import { randomUUID } from 'node:crypto'
import type {
  ErrorResponse,
  WorkbenchCriterion,
  WorkbenchFinding,
  WorkbenchMutateRequestBody,
  WorkbenchRecord,
  WorkbenchWorkPackage,
} from '../workbench-shared/protocol.js'

export type RecordActionResult =
  | { ok: true; record: WorkbenchRecord }
  | { ok: false; status: number; code: ErrorResponse['code'] }

const NOT_STARTED_STATUSES = ['planned', 'plan-draft', 'plan-approved'] as const

const fail = (status: number, code: ErrorResponse['code']): RecordActionResult => ({ ok: false, status, code })

const now = (): string => new Date().toISOString()

/** criteria[].coveredBy is a projection of workPackages[].covers — recomputed, never client-written. */
function recomputeCoveredBy(criteria: readonly WorkbenchCriterion[], workPackages: readonly WorkbenchWorkPackage[]): readonly WorkbenchCriterion[] {
  return criteria.map((criterion) => ({
    ...criterion,
    coveredBy: workPackages.filter((workPackage) => workPackage.covers.includes(criterion.id)).map((workPackage) => workPackage.id),
  }))
}

/** WP<max+1> / C<max+1> sequence minting — ids are never recycled (the plans-version philosophy). */
function nextSequenceId(ids: readonly string[], prefix: string): string {
  let max = 0
  for (const id of ids) {
    const parsed = Number.parseInt(id.slice(prefix.length), 10)
    if (Number.isInteger(parsed) && parsed > max) max = parsed
  }
  return `${prefix}${max + 1}`
}

function replaceWorkPackage(record: WorkbenchRecord, next: WorkbenchWorkPackage): WorkbenchRecord {
  const workPackages = record.workPackages.map((candidate) => (candidate.id === next.id ? next : candidate))
  return { ...record, workPackages, criteria: recomputeCoveredBy(record.criteria, workPackages) }
}

export function applyRecordAction(base: WorkbenchRecord, body: WorkbenchMutateRequestBody): RecordActionResult {
  // Findings and the stage pointer live OUTSIDE the split contract — the
  // gate freezes the list × coverage, not analysis work.
  if (body.action === 'advanceStage') {
    const at = now()
    return {
      ok: true,
      record: {
        ...base,
        stage: body.stage,
        stageHistory: [
          ...base.stageHistory,
          { stage: body.stage, at, ...(body.note !== undefined ? { note: body.note } : {}) },
        ],
      },
    }
  }
  if (body.action === 'saveFinding') {
    if (body.finding.id !== undefined) {
      const target = base.findings.find((finding) => finding.id === body.finding.id)
      if (target === undefined) return fail(404, 'not-found')
      // Present fields overwrite; absent carry over; id and createdAt are host-owned.
      const { id: _id, ...fields } = body.finding
      return {
        ok: true,
        record: { ...base, findings: base.findings.map((finding) => (finding.id === body.finding.id ? { ...finding, ...fields } : finding)) },
      }
    }
    const created: WorkbenchFinding = { id: randomUUID(), createdAt: now(), ...body.finding }
    return { ok: true, record: { ...base, findings: [...base.findings, created] } }
  }
  if (body.action === 'removeFinding') {
    if (!base.findings.some((finding) => finding.id === body.id)) return fail(404, 'not-found')
    return { ok: true, record: { ...base, findings: base.findings.filter((finding) => finding.id !== body.id) } }
  }

  // Everything below this line is under the split contract's shadow.
  const splitLocked = base.splitApprovedAt !== undefined

  if (body.action === 'approveSplit') {
    if (splitLocked) return fail(400, 'bad-request') // approving twice is a client bug, not a state race
    if (base.workPackages.length === 0) return fail(400, 'bad-request') // an empty list × coverage contract approves nothing
    return { ok: true, record: { ...base, splitApprovedAt: now() } } // stamps ONLY — no work-package status changes (pinned)
  }
  if (body.action === 'revokeSplitApproval') {
    if (!splitLocked) return fail(400, 'bad-request')
    // Strip the stamp, keep the list — "history preserved" means the list
    // survives a revoke; revoking re-locks the lifecycle until re-approval.
    const { splitApprovedAt: _stamp, ...rest } = base
    return { ok: true, record: rest }
  }

  // Target existence precedes the lock check (a missing row is 404 whether
  // or not the gate is shut).
  const findWorkPackage = (id: string): WorkbenchWorkPackage | undefined =>
    base.workPackages.find((candidate) => candidate.id === id)

  if (body.action === 'saveWorkPackage') {
    if (splitLocked) return fail(400, 'locked-split')
    const input = body.workPackage
    // Referential integrity: dependencies must point at existing OTHER
    // work packages; coverage at existing criteria.
    const others = input.id === undefined ? base.workPackages : base.workPackages.filter((candidate) => candidate.id !== input.id)
    if (input.dependsOn.some((dep) => !others.some((candidate) => candidate.id === dep))) return fail(400, 'bad-request')
    if (input.covers.some((covered) => !base.criteria.some((criterion) => criterion.id === covered))) return fail(400, 'bad-request')

    if (input.id !== undefined) {
      const existing = findWorkPackage(input.id)
      if (existing === undefined) return fail(404, 'not-found')
      const next: WorkbenchWorkPackage = {
        ...existing,
        title: input.title,
        boundary: input.boundary,
        dependsOn: [...input.dependsOn],
        covers: [...input.covers],
        ...(input.parallel !== undefined ? { parallel: input.parallel } : {}),
      }
      return { ok: true, record: replaceWorkPackage(base, next) }
    }
    const maxOrder = base.workPackages.reduce((max, workPackage) => Math.max(max, workPackage.order), 0)
    const created: WorkbenchWorkPackage = {
      id: nextSequenceId(base.workPackages.map((workPackage) => workPackage.id), 'WP'),
      title: input.title,
      boundary: input.boundary,
      order: maxOrder + 1,
      dependsOn: [...input.dependsOn],
      ...(input.parallel !== undefined ? { parallel: input.parallel } : {}),
      covers: [...input.covers],
      status: 'planned',
      plans: [],
      sessions: [],
      commits: [],
      acceptances: [],
    }
    const workPackages = [...base.workPackages, created]
    return { ok: true, record: { ...base, workPackages, criteria: recomputeCoveredBy(base.criteria, workPackages) } }
  }
  if (body.action === 'removeWorkPackage') {
    if (splitLocked) return fail(400, 'locked-split')
    const target = findWorkPackage(body.id)
    if (target === undefined) return fail(404, 'not-found')
    const workPackages = base.workPackages
      .filter((candidate) => candidate.id !== body.id)
      .map((candidate) => (candidate.dependsOn.includes(body.id)
        ? { ...candidate, dependsOn: candidate.dependsOn.filter((dep) => dep !== body.id) }
        : candidate))
    return { ok: true, record: { ...base, workPackages, criteria: recomputeCoveredBy(base.criteria, workPackages) } }
  }
  if (body.action === 'moveWorkPackage') {
    if (splitLocked) return fail(400, 'locked-split')
    const target = findWorkPackage(body.id)
    if (target === undefined) return fail(404, 'not-found')
    const sorted = [...base.workPackages].sort((a, b) => a.order - b.order)
    const index = sorted.findIndex((candidate) => candidate.id === body.id)
    const neighborIndex = body.direction === 'up' ? index - 1 : index + 1
    const neighbor = sorted[neighborIndex]
    if (neighbor === undefined) return fail(400, 'bad-request') // no neighbor in that direction
    // Swap the order values of exactly these two rows.
    const workPackages = base.workPackages.map((candidate) => {
      if (candidate.id === target.id) return { ...candidate, order: neighbor.order }
      if (candidate.id === neighbor.id) return { ...candidate, order: target.order }
      return candidate
    })
    return { ok: true, record: { ...base, workPackages } }
  }
  if (body.action === 'approvePlan' || body.action === 'startWorkPackage'
    || body.action === 'markWorkPackageBuilt' || body.action === 'acceptWorkPackage'
    || body.action === 'reopenWorkPackage' || body.action === 'dropWorkPackage') {
    // LIFECYCLE gate — the MIRROR of the list gate above: these actions
    // require the split contract to be ACTIVE. Absence (never approved, or
    // revoked — the user-ratified full re-lock) locks the state machine;
    // `splitLocked` above means "the contract is frozen" (list CRUD must
    // stop), which is precisely when the lifecycle runs. One variable, two
    // opposite gates — read carefully before touching either.
    if (base.splitApprovedAt === undefined) return fail(400, 'locked-split')
    const target = findWorkPackage(body.id)
    if (target === undefined) return fail(404, 'not-found')

    if (body.action === 'approvePlan') {
      // Read-side dual of the write pipeline's tail-draft lock: the approval
      // target is ALWAYS the last unapproved entry; an all-approved chain has
      // nothing left to approve (locked-version), and re-baselining mid-flight
      // (in-dev) is the legitimate rework path — status only moves on the
      // not-yet-started states.
      const draft = [...target.plans].reverse().find((plan) => plan.approvedAt === undefined)
      if (draft === undefined) return fail(400, 'locked-version')
      const stamped = {
        ...target,
        plans: target.plans.map((plan) => (plan.version === draft.version ? { ...plan, approvedAt: now() } : plan)),
        status: target.status === 'planned' || target.status === 'plan-draft' ? ('plan-approved' as const) : target.status,
      }
      return { ok: true, record: replaceWorkPackage(base, stamped) }
    }
    if (body.action === 'startWorkPackage') {
      if (target.status !== 'plan-approved') return fail(400, 'bad-request')
      return { ok: true, record: replaceWorkPackage(base, { ...target, status: 'in-dev' }) }
    }
    if (body.action === 'markWorkPackageBuilt') {
      if (target.status !== 'in-dev') return fail(400, 'bad-request')
      return { ok: true, record: replaceWorkPackage(base, { ...target, status: 'built' }) }
    }
    if (body.action === 'acceptWorkPackage') {
      if (target.status !== 'built') return fail(400, 'bad-request')
      // A failed acceptance MUST carry a rework reason — it is the only
      // trail a future re-approval has (required here, not in zod: see the
      // AcceptWorkPackageSchema note in types.ts).
      const note = body.note?.trim()
      if (body.result === 'fail' && (note === undefined || note.length === 0)) return fail(400, 'bad-request')
      const accepted = {
        ...target,
        status: body.result === 'pass' ? ('accepted' as const) : ('in-dev' as const),
        acceptances: [...target.acceptances, { at: now(), result: body.result, ...(note !== undefined && note.length > 0 ? { note } : {}) }],
      }
      return { ok: true, record: replaceWorkPackage(base, accepted) }
    }
    if (body.action === 'reopenWorkPackage') {
      if (target.status !== 'accepted') return fail(400, 'bad-request')
      return { ok: true, record: replaceWorkPackage(base, { ...target, status: 'in-dev' }) }
    }
    // dropWorkPackage — abandon is a not-yet-started decision.
    if (!NOT_STARTED_STATUSES.includes(target.status as (typeof NOT_STARTED_STATUSES)[number])) return fail(400, 'bad-request')
    return { ok: true, record: replaceWorkPackage(base, { ...target, status: 'dropped' }) }
  }

  // saveCriterion / removeCriterion — under the split lock like the list:
  // the approved contract is "list × coverage", both sides.
  if (body.action === 'saveCriterion') {
    if (splitLocked) return fail(400, 'locked-split')
    const input = body.criterion
    if (input.id !== undefined) {
      const existing = base.criteria.find((criterion) => criterion.id === input.id)
      if (existing === undefined) return fail(404, 'not-found')
      const { id: _id, ...fields } = input
      return {
        ok: true,
        record: { ...base, criteria: base.criteria.map((criterion) => (criterion.id === input.id ? { ...criterion, ...fields } : criterion)) },
      }
    }
    const created: WorkbenchCriterion = {
      id: nextSequenceId(base.criteria.map((criterion) => criterion.id), 'C'),
      text: input.text,
      ...(input.sourceSection !== undefined ? { sourceSection: input.sourceSection } : {}),
      coveredBy: [],
    }
    return { ok: true, record: { ...base, criteria: [...base.criteria, created] } }
  }
  // removeCriterion — strip the row, strip every covers reference, reproject.
  if (splitLocked) return fail(400, 'locked-split')
  if (!base.criteria.some((criterion) => criterion.id === body.id)) return fail(404, 'not-found')
  const strippedWorkPackages = base.workPackages.map((candidate) =>
    candidate.covers.includes(body.id) ? { ...candidate, covers: candidate.covers.filter((covered) => covered !== body.id) } : candidate)
  const remainingCriteria = base.criteria.filter((criterion) => criterion.id !== body.id)
  return {
    ok: true,
    record: { ...base, workPackages: strippedWorkPackages, criteria: recomputeCoveredBy(remainingCriteria, strippedWorkPackages) },
  }
}
