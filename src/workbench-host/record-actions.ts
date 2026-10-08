/**
 * Workbench record actions (second knife): the mutate union as ONE pure
 * function over the loaded record — all business guards live here
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
 * covers after every list change), finding id/createdAt, plan approvedAt,
 * releaseItem id/contentHash/status/appliedAt, record rollbackPlanConfirmedAt.
 */
import { randomUUID } from 'node:crypto'
import type {
  ErrorResponse,
  ReleaseItem,
  WorkbenchCriterion,
  WorkbenchFinding,
  WorkbenchMutateRequestBody,
  WorkbenchRecord,
  WorkbenchWorkPackage,
} from '../workbench-shared/protocol.js'
import { contentHashOf } from './artifact-store.js'
import type { KnowledgeRecord } from './types.js'

export type RecordActionResult =
  | {
    ok: true
    record: WorkbenchRecord
    /** The applied action changed nothing (idempotent re-run) — the endpoint skips the ledger save, so the revision does not bump. */
    unchanged?: boolean
    /** activateKnowledgeCandidate only: the ready-to-upsert knowledge.yaml row (the dual-ledger tail write stays in the endpoint). */
    knowledgeRow?: KnowledgeRecord
  }
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

/**
 * R#### release-item minting — deliberately NOT nextSequenceId. Release ids
 * are zero-padded to four digits (`ReleaseItemIdSchema` = /^R\d{4,}$/), and
 * nextSequenceId would mint `R1`: `save()` never re-validates the schema
 * (only `load()` does), so the illegal row lands on disk and the NEXT load
 * degrades the whole workbench.yaml to schema-rejected — every requirement's
 * workbench turns unreadable at once and refuses to write. Same failure mode
 * as the P1b round-2 coveredBy incident (milestones/0006). Padding to four
 * matches research 0006 §6.1 and the mockup's `R0001`.
 */
function nextReleaseItemId(ids: readonly string[]): string {
  let max = 0
  for (const id of ids) {
    const parsed = Number.parseInt(id.slice(1), 10)
    if (Number.isInteger(parsed) && parsed > max) max = parsed
  }
  return `R${String(max + 1).padStart(4, '0')}`
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
  if (body.action === 'restoreWorkPackage') {
    // Un-drop is a LIST edit (drop = exclude from the plan), so it rides the
    // LIST gate: only while the split contract is open for editing. The
    // restored status DERIVES from the surviving plan chain — restoring a
    // package whose tail plan is approved lands on plan-approved (ready to
    // start), a draft tail on plan-draft, none on planned — so a restored
    // package is never stranded between "cannot start" and "nothing left to
    // approve".
    if (splitLocked) return fail(400, 'locked-split')
    const target = findWorkPackage(body.id)
    if (target === undefined) return fail(404, 'not-found')
    if (target.status !== 'dropped') return fail(400, 'bad-request')
    const tail = [...target.plans].reverse().find((plan) => plan.approvedAt === undefined) ?? [...target.plans].reverse()[0]
    const restored = tail === undefined
      ? ('planned' as const)
      : tail.approvedAt !== undefined ? ('plan-approved' as const) : ('plan-draft' as const)
    return { ok: true, record: replaceWorkPackage(base, { ...target, status: restored }) }
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
  if (body.action === 'removeCriterion') {
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

  // --- P2: session binding (lifecycle gate family — binding is an
  // execution-phase association; the list contract must be active). ---

  if (body.action === 'bindSession') {
    if (base.splitApprovedAt === undefined) return fail(400, 'locked-split')
    const target = findWorkPackage(body.id)
    if (target === undefined) return fail(404, 'not-found')
    if (target.status === 'dropped') return fail(400, 'bad-request')
    // sessions[] is append-only (research 0006 §7.2「解绑不删历史」): same
    // session + same purpose re-binds as a no-op; a DIFFERENT purpose is a
    // client bug (double chips or silent history rewrite — neither flies).
    if (target.sessions.some((binding) => binding.sessionId === body.sessionId)) {
      if (target.sessions.some((binding) => binding.sessionId === body.sessionId && binding.purpose === body.purpose)) {
        return { ok: true, record: base, unchanged: true }
      }
      return fail(400, 'bad-request')
    }
    const bound: WorkbenchRecord['workPackages'][number]['sessions'][number] = {
      sessionId: body.sessionId,
      purpose: body.purpose,
      boundAt: now(),
    }
    return {
      ok: true,
      record: replaceWorkPackage(base, { ...target, sessions: [...target.sessions, bound] }),
    }
  }

  // --- P2: knowledge candidates (OUTSIDE the split gate — S6 retro spans
  // the whole lifecycle, closed included; the gate freezes the list ×
  // coverage contract, not the沉淀 queue). ---

  if (body.action === 'editKnowledgeCandidate') {
    const target = base.knowledgeCandidates.find((candidate) => candidate.id === body.id)
    if (target === undefined) return fail(404, 'not-found')
    if (target.status !== 'pending') return fail(400, 'bad-request')
    return {
      ok: true,
      record: {
        ...base,
        knowledgeCandidates: base.knowledgeCandidates.map((candidate) =>
          candidate.id === body.id ? { ...candidate, ...body.candidate } : candidate),
      },
    }
  }
  if (body.action === 'dismissKnowledgeCandidate') {
    const target = base.knowledgeCandidates.find((candidate) => candidate.id === body.id)
    if (target === undefined) return fail(404, 'not-found')
    if (target.status === 'promoted') return fail(400, 'bad-request')
    if (target.status === 'dismissed') return { ok: true, record: base, unchanged: true }
    return {
      ok: true,
      record: {
        ...base,
        knowledgeCandidates: base.knowledgeCandidates.map((candidate) =>
          candidate.id === body.id ? { ...candidate, status: 'dismissed' } : candidate),
      },
    }
  }
  if (body.action === 'activateKnowledgeCandidate') {
    const target = base.knowledgeCandidates.find((candidate) => candidate.id === body.id)
    if (target === undefined) return fail(404, 'not-found')
    if (target.status === 'dismissed') return fail(400, 'bad-request')
    // Cross-ledger coupling guards (business layer — see the zod note):
    // workspace ⇒ path, keyword ⇒ non-empty value; value is stripped for
    // always/manual so no dirty parameter rides into knowledge.yaml.
    const input = body.knowledge
    if (input.scope === 'workspace' && (input.path === undefined || input.path.trim().length === 0)) {
      return fail(400, 'bad-request')
    }
    if (input.trigger.mode === 'keyword' && (input.trigger.value === undefined || input.trigger.value.trim().length === 0)) {
      return fail(400, 'bad-request')
    }
    const normalizedTrigger = input.trigger.mode === 'keyword'
      ? { mode: 'keyword' as const, value: input.trigger.value!.trim() }
      : { mode: input.trigger.mode }
    // The knowledge row this promote projects into knowledge.yaml. The
    // candidate id IS the row id — activate is an idempotent upsert on the
    // knowledge ledger; provenance carries the birthplace audit (promote
    // may change scope, provenance never moves).
    const knowledgeRow: KnowledgeRecord = {
      id: target.id,
      scope: input.scope,
      type: input.type,
      title: target.title,
      content: target.draft,
      ...(input.scope === 'workspace' ? { path: input.path!.trim() } : {}),
      ...(input.scope === 'requirement' ? { requirementId: body.requirementId } : {}),
      trigger: normalizedTrigger,
      status: 'active',
      provenance: {
        requirementId: body.requirementId,
        ...(target.proposedSessionId !== undefined ? { sessionId: target.proposedSessionId } : {}),
        at: now(),
      },
    }
    if (target.status === 'promoted') {
      // Convergence / no-op: the candidate is already promoted — the row
      // still travels so the endpoint can repair a missing knowledge.yaml
      // entry (the dual-ledger tail write is the only thing that can lag).
      return { ok: true, record: base, knowledgeRow, unchanged: true }
    }
    return {
      ok: true,
      record: {
        ...base,
        knowledgeCandidates: base.knowledgeCandidates.map((candidate) =>
          candidate.id === body.id ? { ...candidate, status: 'promoted' } : candidate),
      },
      knowledgeRow,
    }
  }
  // --- P3a: release items (S5 delivery) and the record-level rollback-plan
  // stamp. BOTH live OUTSIDE the split gate, same side as findings/stage and
  // the knowledge-candidate queue. Three ratified reasons (user 2026-10-08):
  //   ① stages are skippable (research 0006 P3 principle) — a user may push
  //      straight to deliver without ever approving a split, and a gated S5
  //      would render nothing but lockedHint, breaking R5「所有录入有手动
  //      最短路径」;
  //   ② rollback is a SAFETY action; a revoked split approval must not lock
  //      it down mid-delivery;
  //   ③ the §5.3 gate matrix marks「登记上线项」✓ for BOTH columns — it is
  //      not one of the four user-only powers, and the split lock protects
  //      the「清单 × 覆盖」contract, which release items are not part of.
  // The status chain is strict (confirmed → applied → verified, the P1b
  // 「开工严格链」spirit): no skipping rungs, no going back except through
  // rolled-back, which is terminal. Editing and deleting are pending-only —
  // once an item is on the sheet its content is locked (修正 = 新登记一条 +
  // 旧条目 rolled-back, research §7.3), and the S5 row discloses that. ---

  if (body.action === 'saveReleaseItem') {
    const input = body.releaseItem
    if (input.id !== undefined) {
      const target = base.releaseItems.find((item) => item.id === input.id)
      if (target === undefined) return fail(404, 'not-found')
      if (target.status !== 'pending') return fail(400, 'bad-request') // content is locked once on the sheet
      const note = input.note?.trim()
      // Field semantics differ by ownership, deliberately:
      //   - the six USER-EDITABLE fields are FULL REPLACE, so the S5 form's
      //     「无」work-package option and an emptied note actually clear
      //     (carry-over would make both impossible to undo — the form is the
      //     only writer of these fields, so absent means "user cleared it");
      //   - `sessionId` is declare-channel PROVENANCE (P3b writes it, the
      //     manual form never does) so it carries over untouched.
      const next: ReleaseItem = {
        id: target.id,
        type: input.type,
        title: input.title.trim(),
        content: input.content,
        contentHash: contentHashOf(input.content),
        envs: [...input.envs],
        ...(input.workPackageId !== undefined ? { workPackageId: input.workPackageId } : {}),
        ...(target.sessionId !== undefined ? { sessionId: target.sessionId } : {}),
        status: target.status,
        ...(target.appliedAt !== undefined ? { appliedAt: target.appliedAt } : {}),
        ...(note !== undefined && note.length > 0 ? { note } : {}),
      }
      // A no-op edit must not bump the revision (the idempotent-convergence
      // contract, same as repeat-bind / repeat-dismiss).
      if (releaseItemEquivalent(target, next)) return { ok: true, record: base, unchanged: true }
      return {
        ok: true,
        record: {
          ...base,
          releaseItems: base.releaseItems.map((item) => (item.id === input.id ? next : item)),
        },
      }
    }
    const created: ReleaseItem = {
      id: nextReleaseItemId(base.releaseItems.map((item) => item.id)),
      type: input.type,
      title: input.title.trim(),
      content: input.content,
      // Host-minted, never client-writable (the D4-③ discipline for plans):
      // registration hashes the content, so any later mismatch means the
      // ledger was edited OUTSIDE this endpoint.
      contentHash: contentHashOf(input.content),
      envs: [...input.envs],
      ...(input.workPackageId !== undefined ? { workPackageId: input.workPackageId } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.note !== undefined && input.note.trim().length > 0 ? { note: input.note.trim() } : {}),
      status: 'pending',
    }
    return { ok: true, record: { ...base, releaseItems: [...base.releaseItems, created] } }
  }

  if (body.action === 'confirmRollbackPlan' || body.action === 'revokeRollbackPlan') {
    // Record-level stamp, mirroring approveSplit/revokeSplitApproval's
    // "twice is a client bug, not a state race" stance.
    if (body.action === 'confirmRollbackPlan') {
      if (base.rollbackPlanConfirmedAt !== undefined) return fail(400, 'bad-request')
      return { ok: true, record: { ...base, rollbackPlanConfirmedAt: now() } }
    }
    if (base.rollbackPlanConfirmedAt === undefined) return fail(400, 'bad-request')
    const { rollbackPlanConfirmedAt: _stamp, ...rest } = base
    return { ok: true, record: rest }
  }

  if (body.action === 'removeReleaseItem' || body.action === 'confirmReleaseItem'
    || body.action === 'markReleaseItemApplied' || body.action === 'markReleaseItemVerified'
    || body.action === 'rollbackReleaseItem') {
    const target = base.releaseItems.find((item) => item.id === body.id)
    if (target === undefined) return fail(404, 'not-found')

    if (body.action === 'removeReleaseItem') {
      // Pending-only: a confirmed item is on the sheet and leaving it must
      // go through rolled-back (audit trail preserved, research §7.3).
      if (target.status !== 'pending') return fail(400, 'bad-request')
      return { ok: true, record: { ...base, releaseItems: base.releaseItems.filter((item) => item.id !== body.id) } }
    }

    const moveTo = (status: ReleaseItem['status'], extra?: Partial<ReleaseItem>): RecordActionResult => ({
      ok: true,
      record: {
        ...base,
        releaseItems: base.releaseItems.map((item) => (item.id === body.id ? { ...item, ...extra, status } : item)),
      },
    })

    if (body.action === 'confirmReleaseItem') {
      if (target.status === 'confirmed') return { ok: true, record: base, unchanged: true }
      if (target.status !== 'pending') return fail(400, 'bad-request')
      return moveTo('confirmed')
    }
    if (body.action === 'markReleaseItemApplied') {
      if (target.status === 'applied') return { ok: true, record: base, unchanged: true }
      // Strict chain: pending items must be confirmed first (the user
      // accepts an AI-declared item onto the sheet before it can be run).
      if (target.status !== 'confirmed') return fail(400, 'bad-request')
      return moveTo('applied', { appliedAt: now() })
    }
    if (body.action === 'markReleaseItemVerified') {
      if (target.status === 'verified') return { ok: true, record: base, unchanged: true }
      if (target.status !== 'applied') return fail(400, 'bad-request')
      return moveTo('verified')
    }
    // rollbackReleaseItem — any live status may be rolled back; the status
    // is terminal afterwards.
    if (target.status === 'rolled-back') return { ok: true, record: base, unchanged: true }
    return moveTo('rolled-back')
  }

  return fail(400, 'bad-request')
}

/**
 * Identity-field equivalence for the pending-edit no-op short-circuit —
 * mirrors knowledgeRowEquivalent: a byte-identical re-save is not a data
 * change and must not bump the revision. contentHash is derived from
 * content, so comparing content covers it.
 */
function releaseItemEquivalent(a: ReleaseItem, b: ReleaseItem): boolean {
  return a.type === b.type
    && a.title === b.title
    && a.content === b.content
    && a.envs.length === b.envs.length && a.envs.every((env, index) => env === b.envs[index])
    && a.workPackageId === b.workPackageId
    && a.sessionId === b.sessionId
    && a.note === b.note
}
