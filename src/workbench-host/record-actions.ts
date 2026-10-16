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
  KnowledgeCandidate,
  ReleaseItem,
  ReviewVerdict,
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

/**
 * 0007 D3: answered-clarification count, DERIVED from the record being
 * stamped (never trusted from the wire — the approveSplit disposedFindings
 * discipline: it cannot disagree with the ledger). Shared by both baseline
 * mint sites (approveSplit + confirmSplitStillValid) so the compare side's
 *口径 stays identical across a refresh.
 */
function answeredClarificationsOf(record: WorkbenchRecord): number {
  return (record.analysis?.clarifications ?? []).filter((row) => row.answer !== undefined).length
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
export function nextReleaseItemId(ids: readonly string[]): string {
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

  // Analysis proposals (回传轮) — findings-family territory: outside the
  // split contract, EXCEPT adoptCriterionProposal (writing criteria[] is the
  // frozen 清单×coverage contract itself — the user-ratified lock).
  if (body.action === 'bindAnalysisSession') {
    // Same id → unchanged (repeat-bind precedent, no revision churn); a
    // DIFFERENT id only swaps the pointer — the old batch survives until the
    // new seed lands (the replacement window: rows in flight stay rulable).
    // The anchor rides along when supplied; absent keeps the stored one (the
    // shell-repair rebind has no fresh anchor to offer).
    const anchor = body.anchor ?? base.analysis?.session.anchor
    if (base.analysis?.session.sessionId === body.sessionId && base.analysis.session.anchor === anchor) {
      return { ok: true, record: base, unchanged: true }
    }
    if (base.analysis?.session.sessionId === body.sessionId) {
      return {
        ok: true,
        record: { ...base, analysis: { ...base.analysis, session: { ...base.analysis.session, ...(anchor !== undefined ? { anchor } : {}) } } },
      }
    }
    return {
      ok: true,
      record: {
        ...base,
        analysis: {
          session: { sessionId: body.sessionId, boundAt: now(), ...(anchor !== undefined ? { anchor } : {}) },
          ...(base.analysis?.seed !== undefined ? { seed: base.analysis.seed } : {}),
          findings: base.analysis?.findings ?? [],
          criteria: base.analysis?.criteria ?? [],
        },
      },
    }
  }
  if (body.action === 'adoptFindingProposal' || body.action === 'dismissFindingProposal') {
    const container = base.analysis
    if (container === undefined) return fail(404, 'not-found')
    const row = container.findings.find((proposal) => proposal.id === body.id)
    if (row === undefined) return fail(404, 'not-found')
    if (body.action === 'dismissFindingProposal') {
      return {
        ok: true,
        record: { ...base, analysis: { ...container, findings: container.findings.filter((proposal) => proposal.id !== body.id) } },
      }
    }
    // Adopt: a FRESH uuid for the formal row (never the proposal's — the
    // findings-family habit), sessionId unfolds from the batch anchor. In the
    // replacement window (new session bound, old batch still rulable) the
    // anchor names the batch the row actually came from.
    const created: WorkbenchFinding = {
      id: randomUUID(),
      category: row.category,
      severity: row.severity,
      title: row.title,
      detail: row.detail ?? '',
      status: 'open',
      sessionId: container.seed?.sessionId ?? container.session.sessionId,
      createdAt: now(),
    }
    return {
      ok: true,
      record: {
        ...base,
        findings: [...base.findings, created],
        analysis: { ...container, findings: container.findings.filter((proposal) => proposal.id !== body.id) },
      },
    }
  }
  if (body.action === 'adoptCriterionProposal' || body.action === 'dismissCriterionProposal') {
    const container = base.analysis
    if (container === undefined) return fail(404, 'not-found')
    const row = container.criteria.find((proposal) => proposal.id === body.id)
    if (row === undefined) return fail(404, 'not-found')
    if (body.action === 'dismissCriterionProposal') {
      return {
        ok: true,
        record: { ...base, analysis: { ...container, criteria: container.criteria.filter((proposal) => proposal.id !== body.id) } },
      }
    }
    // adoptCriterionProposal sits UNDER the split lock — it writes criteria[],
    // which is exactly the frozen contract (saveCriterion's own gate; ruling
    // ⑤ of the 回传轮: a locked list admits no side door).
    if (base.splitApprovedAt !== undefined) return fail(400, 'locked-split')
    const created: WorkbenchCriterion = {
      id: nextSequenceId(base.criteria.map((criterion) => criterion.id), 'C'),
      text: row.text,
      ...(row.sourceSection !== undefined ? { sourceSection: row.sourceSection } : {}),
      coveredBy: [], // a new row has no covering work package yet (recompute is a no-op at [])
    }
    return {
      ok: true,
      record: {
        ...base,
        criteria: [...base.criteria, created],
        analysis: { ...container, criteria: container.criteria.filter((proposal) => proposal.id !== body.id) },
      },
    }
  }
  // 文件交付轮: clarification rulings — pure pending-row state (an answer
  // never promotes into any formal table), deliberately OUTSIDE the split
  // lock like the findings family: the gate freezes the list × coverage
  // contract, not analysis Q&A.
  if (body.action === 'answerAnalysisClarification' || body.action === 'dismissAnalysisClarification') {
    const container = base.analysis
    if (container === undefined) return fail(404, 'not-found')
    const rows = container.clarifications ?? []
    const row = rows.find((proposal) => proposal.id === body.id)
    if (row === undefined) return fail(404, 'not-found')
    if (body.action === 'dismissAnalysisClarification') {
      return {
        ok: true,
        record: { ...base, analysis: { ...container, clarifications: rows.filter((proposal) => proposal.id !== body.id) } },
      }
    }
    // Re-answering updates in place (answeredAt moves) — the user owns this
    // state for as long as the row lives; a later batch replace keeps
    // answered rows (see applyAnalysisSeed).
    return {
      ok: true,
      record: {
        ...base,
        analysis: {
          ...container,
          clarifications: rows.map((proposal) => (proposal.id === body.id ? { ...proposal, answer: body.answer, answeredAt: now() } : proposal)),
        },
      },
    }
  }

  // 0007 定稿软门 — record-level understand stamps, OUTSIDE the split lock
  // (the finalize is the user's own S1 content event; the split contract
  // freezes list × coverage, not the understanding credential — the
  // confirmRollbackPlan pair is the structural precedent). approveUnderstand
  // itself NO LONGER rides this union (0008 D4): its docHash anchor is an
  // IO-derived value the endpoint shell reads off disk — the endpoint
  // dispatches the action to approveUnderstandWith BEFORE reaching here (the
  // seedAnalysis dedicated-flow pattern); a stray union fallthrough lands on
  // the generic 400 below by construction.
  if (body.action === 'revokeUnderstand') {
    if (base.understandApprovedAt === undefined) return fail(400, 'bad-request')
    // Stamp + credential strip TOGETHER (the revokeSplitApproval key-strip
    // pattern — 'understandApprovedAt' in record is false downstream).
    const { understandApprovedAt: _stamp, understandBaseline: _baseline, ...rest } = base
    return { ok: true, record: rest }
  }

  // 0012 采纳软门 — the planning-adoption stamps, OUTSIDE the split lock
  // (the understand-family precedent: the adoption is the user's own plan-
  // stage content event; the split contract freezes list × coverage, not the
  // planning credential). adoptPlan itself rides the endpoint's dedicated
  // flow (its docHash anchor is IO-derived, the approveUnderstand pattern);
  // a stray union fallthrough lands on the generic 400 by construction.
  if (body.action === 'revokePlanAdoption') {
    if (base.planAdoptedAt === undefined) return fail(400, 'bad-request')
    const { planAdoptedAt: _stamp, planBaseline: _baseline, ...rest } = base
    return { ok: true, record: rest }
  }

  // 0012: split-proposal container pointer + row dismissal — the analysis
  // family discipline (outside the lock; dismissFindingProposal precedent:
  // dropping a pending row is never a contract change).
  if (body.action === 'bindSplitSession') {
    const anchor = body.anchor ?? base.splitProposals?.session.anchor
    if (base.splitProposals?.session.sessionId === body.sessionId && base.splitProposals.session.anchor === anchor) {
      return { ok: true, record: base, unchanged: true }
    }
    if (base.splitProposals?.session.sessionId === body.sessionId) {
      return {
        ok: true,
        record: { ...base, splitProposals: { ...base.splitProposals, session: { ...base.splitProposals.session, ...(anchor !== undefined ? { anchor } : {}) } } },
      }
    }
    return {
      ok: true,
      record: {
        ...base,
        splitProposals: {
          session: { sessionId: body.sessionId, boundAt: now(), ...(anchor !== undefined ? { anchor } : {}) },
          ...(base.splitProposals?.seed !== undefined ? { seed: base.splitProposals.seed } : {}),
          workPackages: base.splitProposals?.workPackages ?? [],
        },
      },
    }
  }
  if (body.action === 'dismissWorkPackageProposal') {
    const container = base.splitProposals
    if (container === undefined) return fail(404, 'not-found')
    if (!container.workPackages.some((row) => row.ref === body.ref)) return fail(404, 'not-found')
    return {
      ok: true,
      record: { ...base, splitProposals: { ...container, workPackages: container.workPackages.filter((row) => row.ref !== body.ref) } },
    }
  }

  // Everything below this line is under the split contract's shadow. (The
  // one analysis-family exception — adoptCriterionProposal — handled above
  // carries its own inline lock check: writing criteria[] IS the frozen
  // 清单×coverage contract, ruling ⑤ of the 回传轮.)
  const splitLocked = base.splitApprovedAt !== undefined

  if (body.action === 'approveSplit') {
    if (splitLocked) return fail(400, 'bad-request') // approving twice is a client bug, not a state race
    if (base.workPackages.length === 0) return fail(400, 'bad-request') // an empty list × coverage contract approves nothing
    const at = now()
    return {
      ok: true,
      // stamps ONLY — no work-package status changes (pinned). The P5b
      // baseline is ALWAYS minted (so the findings arm of stale detection
      // works even for a workspace-less requirement): `at` is host-minted,
      // `disposedFindings` is DERIVED from this same record (never trusted
      // from the wire — it cannot disagree with the ledger), and `prd` is the
      // client's snapshot (empty when it couldn't read the workspace, which
      // simply disables the PRD arm).
      record: {
        ...base,
        splitApprovedAt: at,
        splitBaseline: {
          at,
          prd: body.baseline?.prd ?? [],
          disposedFindings: base.findings.filter((finding) => finding.status !== 'open').length,
          // 0007 D3 arms — both host-derived (never trusted from the wire).
          // understandApprovedAt is spread-conditional so pre-0007 semantics
          // (absent key) hold for a never-finalized requirement; the
          // answered count is always written (0 included) so the arm is
          // armed from the first post-0007 approval on.
          ...(base.understandApprovedAt !== undefined ? { understandApprovedAt: base.understandApprovedAt } : {}),
          answeredClarifications: answeredClarificationsOf(base),
          // 0008 D4: the requirement-baseline doc hash the (finalized)
          // understand carried — conditional for the same never-finalized /
          // pre-0008 semantics.
          ...(base.understandBaseline?.docHash !== undefined ? { requirementDocHash: base.understandBaseline.docHash } : {}),
          // 0012: the planning-doc hash the (adopted) planning carried — the
          // sixth stale arm, minted at BOTH baseline sites (approve + confirm-
          // still-valid re-anchor, the requirementDocHash pattern verbatim).
          ...(base.planBaseline?.docHash !== undefined ? { planningDocHash: base.planBaseline.docHash } : {}),
        },
      },
    }
  }
  if (body.action === 'revokeSplitApproval') {
    if (!splitLocked) return fail(400, 'bad-request')
    // Strip the stamp, keep the list — "history preserved" means the list
    // survives a revoke; revoking re-locks the lifecycle until re-approval.
    // The baseline goes with the stamp (it is only meaningful while approved).
    const { splitApprovedAt: _stamp, splitBaseline: _baseline, ...rest } = base
    return { ok: true, record: rest }
  }
  if (body.action === 'reSplit') {
    if (!splitLocked) return fail(400, 'bad-request') // re-split only applies to an approved list
    const active = base.workPackages.filter((workPackage) => workPackage.status !== 'dropped')
    if (active.length === 0) return fail(400, 'bad-request') // nothing to archive
    // Archive = reuse the dropped state (P1b round-3's ratified「放弃 = 从当前
    // 计划中排除，可恢复」semantics — no second archive mechanism). Legal only
    // while every active package is not-yet-started: an in-dev/built/accepted
    // package carries plans, sessions and acceptances a re-split would orphan.
    if (active.some((workPackage) => !NOT_STARTED_STATUSES.includes(workPackage.status as (typeof NOT_STARTED_STATUSES)[number]))) {
      return fail(400, 'bad-request')
    }
    const at = now()
    // Un-approve (reopen the list for editing) and drop the baseline — both
    // keys REMOVED, not set to undefined (the revokeSplitApproval pattern, so
    // `'splitApprovedAt' in record` is false downstream).
    const { splitApprovedAt: _stamp, splitBaseline: _baseline, ...rest } = base
    return {
      ok: true,
      record: {
        ...rest,
        workPackages: base.workPackages.map((workPackage) =>
          workPackage.status === 'dropped' ? workPackage : { ...workPackage, status: 'dropped' as const }),
        stageHistory: [...base.stageHistory, { stage: base.stage, at, note: 're-split' }],
      },
    }
  }
  if (body.action === 'confirmSplitStillValid') {
    if (!splitLocked) return fail(400, 'bad-request') // §7.6「确认仍有效」presupposes an approval
    const at = now()
    return {
      ok: true,
      // Re-mint the baseline from the client's current PRD snapshot; the
      // disposed-findings count is DERIVED from this same record (never
      // trusted from the wire, same as approveSplit). List untouched.
      record: {
        ...base,
        splitBaseline: {
          at,
          prd: body.baseline.prd,
          disposedFindings: base.findings.filter((finding) => finding.status !== 'open').length,
          // The 0007/0008 arms re-anchor HERE TOO — 确认仍有效 means "checked, the
          // split stands", which re-baselines every arm to NOW (exactly the
          // prd-snapshot refresh semantics; a finalize that moved before the
          // confirm was part of what the user just checked and accepted).
          ...(base.understandApprovedAt !== undefined ? { understandApprovedAt: base.understandApprovedAt } : {}),
          answeredClarifications: answeredClarificationsOf(base),
          ...(base.understandBaseline?.docHash !== undefined ? { requirementDocHash: base.understandBaseline.docHash } : {}),
          // 0012: the planning-doc hash the (adopted) planning carried — the
          // sixth stale arm, minted at BOTH baseline sites (approve + confirm-
          // still-valid re-anchor, the requirementDocHash pattern verbatim).
          ...(base.planBaseline?.docHash !== undefined ? { planningDocHash: base.planBaseline.docHash } : {}),
        },
      },
    }
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
  if (body.action === 'adoptSplitProposals') {
    // 0012: register the CHECKED proposal rows as real work packages —
    // UNDER the split lock (writing workPackages[] is the frozen contract
    // itself, saveWorkPackage's own gate). Ids are HOST-MINTED in container
    // order (the AI's ref is never trusted as an id); dependsOn rewrites
    // batch refs to minted ids, with intra-batch refs taking precedence
    // over a coincidental existing id (the ref names the batch's own row);
    // a dep resolving to neither a selected ref nor an existing id is a
    // dangling reference — 400, never silently dropped (the saveWorkPackage
    // integrity stance).
    if (splitLocked) return fail(400, 'locked-split')
    const container = base.splitProposals
    if (container === undefined) return fail(404, 'not-found')
    const refSet = new Set(body.refs)
    const selected = container.workPackages.filter((row) => refSet.has(row.ref))
    if (selected.length !== refSet.size) return fail(400, 'bad-request') // a ref the container does not carry
    const minted = new Map<string, string>()
    const takenIds = base.workPackages.map((workPackage) => workPackage.id)
    for (const row of selected) {
      const id = nextSequenceId([...takenIds, ...minted.values()], 'WP')
      minted.set(row.ref, id)
    }
    for (const row of selected) {
      const danglingDep = row.dependsOn.some((dep) => !minted.has(dep) && !takenIds.includes(dep))
      if (danglingDep) return fail(400, 'bad-request')
      // Parse-time validation already skipped rows with unknown criteria; a
      // criteria removal SINCE the seed is the only remaining gap — re-check
      // against the live ledger (the adopt-time backstop).
      if (row.covers.some((covered) => !base.criteria.some((criterion) => criterion.id === covered))) return fail(400, 'bad-request')
    }
    const maxOrder = base.workPackages.reduce((max, workPackage) => Math.max(max, workPackage.order), 0)
    const createdRows = selected.map((row, index) => ({
      id: minted.get(row.ref) as string,
      title: row.title,
      boundary: row.boundary,
      order: maxOrder + 1 + index,
      dependsOn: row.dependsOn.map((dep) => minted.get(dep) ?? dep),
      ...(row.parallel !== undefined ? { parallel: row.parallel } : {}),
      covers: [...row.covers],
      status: 'planned' as const,
      plans: [],
      sessions: [],
      commits: [],
      acceptances: [],
    }))
    const workPackages = [...base.workPackages, ...createdRows]
    return {
      ok: true,
      record: {
        ...base,
        workPackages,
        criteria: recomputeCoveredBy(base.criteria, workPackages),
        splitProposals: { ...container, workPackages: container.workPackages.filter((row) => !refSet.has(row.ref)) },
      },
    }
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
    // workspace ⇒ path, keyword/path ⇒ non-empty value; value is stripped
    // for always/manual so no dirty parameter rides into knowledge.yaml.
    // (P5a: mode 'path' joins — the saveKnowledge channel's own guard shape,
    // mirrored here; the path GLOB is the value, the workspace-scope path key
    // is ownership — two different fields, never conflated.)
    const input = body.knowledge
    if (input.scope === 'workspace' && (input.path === undefined || input.path.trim().length === 0)) {
      return fail(400, 'bad-request')
    }
    if ((input.trigger.mode === 'keyword' || input.trigger.mode === 'path') && (input.trigger.value === undefined || input.trigger.value.trim().length === 0)) {
      return fail(400, 'bad-request')
    }
    const normalizedTrigger = input.trigger.mode === 'keyword' || input.trigger.mode === 'path'
      ? { mode: input.trigger.mode, value: input.trigger.value!.trim() }
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

  // --- P4: review reports & verdicts (S4) + manual candidate distillation
  // (S6). ALL outside the split gate — adjudication is the USER's power,
  // reports are review-stage artifacts, and the manual path is the R5
  // shortest route (the findings/candidates/releaseItems gate-free family).
  // Verdict rows enter ONLY by user hand this round: the structured review
  // convention (AI-proposed verdict rows parsed from the report) is deferred
  // to P5 by user ruling (2026-10-08). ---

  if (body.action === 'saveReviewVerdict' || body.action === 'removeReviewVerdict') {
    const report = base.reviewReports.find((entry) => entry.id === body.reportId)
    if (report === undefined) return fail(404, 'not-found')

    if (body.action === 'removeReviewVerdict') {
      if (!report.verdicts.some((row) => row.id === body.id)) return fail(404, 'not-found')
      return {
        ok: true,
        record: {
          ...base,
          reviewReports: base.reviewReports.map((entry) =>
            entry.id === body.reportId ? { ...entry, verdicts: entry.verdicts.filter((row) => row.id !== body.id) } : entry),
        },
      }
    }

    const input = body.verdict
    // A rejected verdict MUST carry its reason — the only trail a future
    // reader has for why a finding was dismissed (the acceptWorkPackage
    // fail-note rule, and research「rejected 需填理由，对齐既有对抗校验习惯」).
    // And a rejected verdict has no disposition to set — rejection IS the
    // resolution (a smuggled disposition is a client bug, not a state race).
    const note = input.note?.trim()
    if (input.verdict === 'rejected' && (note === undefined || note.length === 0)) return fail(400, 'bad-request')
    if (input.verdict === 'rejected' && input.disposition !== undefined) return fail(400, 'bad-request')
    const row: ReviewVerdict = {
      ...(input.id !== undefined ? { id: input.id } : {}),
      title: input.title.trim(),
      severity: input.severity,
      verdict: input.verdict,
      ...(input.disposition !== undefined ? { disposition: input.disposition } : {}),
      ...(note !== undefined && note.length > 0 ? { note } : {}),
    }
    if (input.id !== undefined) {
      const existing = report.verdicts.find((row) => row.id === input.id)
      if (existing === undefined) return fail(404, 'not-found')
      // Idempotent no-op (P5b — this was the union's ONLY write action with no
      // unchanged short-circuit, so a repeat submit appended/rewrote for
      // nothing and bumped the revision). Identity-field compare, mirroring
      // releaseItemEquivalent.
      if (reviewVerdictEquivalent(existing, row)) return { ok: true, record: base, unchanged: true }
      return {
        ok: true,
        record: {
          ...base,
          reviewReports: base.reviewReports.map((entry) =>
            entry.id === body.reportId ? { ...entry, verdicts: entry.verdicts.map((candidate) => (candidate.id === input.id ? row : candidate)) } : entry),
        },
      }
    }
    return {
      ok: true,
      record: {
        ...base,
        reviewReports: base.reviewReports.map((entry) =>
          entry.id === body.reportId ? { ...entry, verdicts: [...entry.verdicts, { ...row, id: randomUUID() }] } : entry),
      },
    }
  }

  if (body.action === 'removeReviewReport') {
    if (!base.reviewReports.some((entry) => entry.id === body.id)) return fail(404, 'not-found')
    // Entry-only removal: the body file stays on disk as a scan-visible
    // orphan (the P1b ledger/reference split — dangling reads degrade, the
    // scan endpoint collects; deleting the file itself is out of scope).
    return { ok: true, record: { ...base, reviewReports: base.reviewReports.filter((entry) => entry.id !== body.id) } }
  }

  if (body.action === 'saveKnowledgeCandidate') {
    const input = body.candidate
    const created: KnowledgeCandidate = {
      id: randomUUID(),
      title: input.title.trim(),
      draft: input.draft,
      type: input.type,
      at: now(),
      status: 'pending',
    }
    return { ok: true, record: { ...base, knowledgeCandidates: [...base.knowledgeCandidates, created] } }
  }

  return fail(400, 'bad-request')
}

/**
 * approveUnderstand (0007 定稿软门 → 0008 D4 dedicated core) — the PURE core
 * of the endpoint's approveUnderstand flow. `docHash` is the disk sha256 of
 * `.skyaxis/requirements/<rid>.md` read by the SHELL (an IO-derived value
 * that never rides the wire — the applyAnalysisSeed division of labor);
 * undefined = no doc / no workspace at finalize: the finalize still stands
 * (软门), the doc simply is not anchored.
 *
 * Guards carried over verbatim: approving twice is a 400 (the approve-family
 * rule); the credential snapshot is DERIVED from this same record (it cannot
 * disagree with the ledger) and stays LIGHT — findings metadata only
 * (detail/resolution live in the live rows), ANSWERED clarifications only.
 */
export function approveUnderstandWith(base: WorkbenchRecord, docHash?: string): RecordActionResult {
  if (base.understandApprovedAt !== undefined) return fail(400, 'bad-request')
  const at = now()
  return {
    ok: true,
    record: {
      ...base,
      understandApprovedAt: at,
      understandBaseline: {
        at,
        criteria: base.criteria.map((criterion) => ({
          id: criterion.id,
          text: criterion.text,
          ...(criterion.sourceSection !== undefined ? { sourceSection: criterion.sourceSection } : {}),
        })),
        findings: base.findings.map((finding) => ({
          id: finding.id,
          status: finding.status,
          category: finding.category,
          severity: finding.severity,
          title: finding.title,
        })),
        clarifications: (base.analysis?.clarifications ?? []).flatMap((row) =>
          row.answer === undefined ? [] : [{ question: row.question, answer: row.answer }]),
        ...(docHash !== undefined ? { docHash } : {}),
      },
    },
  }
}

/**
 * adoptPlan (0012 采纳软门) — the PURE core of the endpoint's adoptPlan flow,
 * approveUnderstandWith's twin. `docHash` is the disk sha256 of
 * `.skyaxis/planning/<rid>.md` read by the SHELL; undefined = no doc / no
 * workspace at adoption: the adoption still stands (软门), the doc simply is
 * not anchored. The credential stays LIGHT — no content snapshot at all
 * (the planning doc IS the content; the ledger needs only the anchors):
 * the docHash plus the UPSTREAM requirementDocHash (the planning's own
 * stale arm — a later requirement-baseline move must surface as stale).
 */
export function adoptPlanWith(base: WorkbenchRecord, docHash?: string): RecordActionResult {
  if (base.planAdoptedAt !== undefined) return fail(400, 'bad-request') // approving twice is a client bug (the approve-family rule)
  const at = now()
  return {
    ok: true,
    record: {
      ...base,
      planAdoptedAt: at,
      planBaseline: {
        at,
        ...(docHash !== undefined ? { docHash } : {}),
        ...(base.understandBaseline?.docHash !== undefined ? { requirementDocHash: base.understandBaseline.docHash } : {}),
      },
    },
  }
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

/**
 * Identity-field equivalence for the saveReviewVerdict no-op short-circuit
 * (P5b). `a` is the stored row (may carry 'proposed'); `b` is the rebuilt row
 * from a two-valued input, so `b.verdict` is never 'proposed' — a stored
 * proposed row therefore never compares equal to an input, which is correct:
 * adjudicating it is a real change.
 */
function reviewVerdictEquivalent(a: ReviewVerdict, b: ReviewVerdict): boolean {
  return a.title === b.title
    && a.severity === b.severity
    && a.verdict === b.verdict
    && a.disposition === b.disposition
    && a.note === b.note
}

/**
 * applyAnalysisSeed (回传轮 + 文件交付轮) — the PURE core of seedAnalysis:
 * the endpoint shell owns the source IO (workspace file first, session log
 * fallback — applyRecordAction stays IO-free) and hands the parsed
 * proposals + the content hash here.
 *
 * Semantics (rulings ①②): an anchor hit (same sessionId AND contentHash)
 * is an UNCHANGED no-op — user-deleted/adopted rows never resurrect on a
 * watcher replay; any other seed REPLACES the AI proposal arrays wholesale
 * (unadjudicated proposals belong to the LATEST analysis; adopted formal
 * rows live in findings[]/criteria[] and are untouched). 文件交付轮 addendum:
 * ANSWERED clarifications are USER-authored state, not AI proposals — the
 * batch replace keeps them (user intent is authoritative, the same reason
 * deleted rows never resurrect) and the next SOW snapshot re-embeds them
 * as settled facts; dismissal is the manual cleanup. An EMPTY batch
 * (e.g. the report carried only knowledge/stageReady) still stamps the
 * anchor — without it, every sessions-list flip would re-read forever.
 * blockError / missing reads never reach this function (the shell returns
 * 200 zero-write for those, keeping the retry path open).
 */
export interface AnalysisSeedInput {
  readonly sessionId: string
  readonly contentHash: string
  /** 0007: the report's stage-ready proposal rides the stamp (consultation only). */
  readonly stageReady: boolean
  readonly findings: readonly {
    readonly category: WorkbenchFinding['category']
    readonly severity: WorkbenchFinding['severity']
    readonly title: string
    readonly detail?: string
  }[]
  readonly criteria: readonly {
    readonly text: string
    readonly sourceSection?: string
  }[]
  readonly clarifications: readonly {
    readonly question: string
    readonly recommendation?: string
    readonly blocks?: string
  }[]
}

export function applyAnalysisSeed(base: WorkbenchRecord, input: AnalysisSeedInput): RecordActionResult {
  const container = base.analysis
  if (container === undefined || container.session.sessionId !== input.sessionId) {
    return fail(404, 'not-found')
  }
  if (container.seed !== undefined && container.seed.sessionId === input.sessionId && container.seed.contentHash === input.contentHash) {
    return { ok: true, record: base, unchanged: true }
  }
  const at = now()
  // User-authored answers survive the batch replace (see the header ruling).
  const keptAnswered = (container.clarifications ?? []).filter((row) => row.answer !== undefined)
  return {
    ok: true,
    record: {
      ...base,
      analysis: {
        ...container,
        seed: { sessionId: input.sessionId, contentHash: input.contentHash, seededAt: at, findings: input.findings.length, criteria: input.criteria.length, clarifications: input.clarifications.length, stageReady: input.stageReady },
        findings: input.findings.map((row) => ({
          id: randomUUID(),
          category: row.category,
          severity: row.severity,
          title: row.title,
          ...(row.detail !== undefined ? { detail: row.detail } : {}),
        })),
        criteria: input.criteria.map((row) => ({
          id: randomUUID(),
          text: row.text,
          ...(row.sourceSection !== undefined ? { sourceSection: row.sourceSection } : {}),
        })),
        clarifications: [
          ...keptAnswered,
          ...input.clarifications.map((row) => ({
            id: randomUUID(),
            question: row.question,
            ...(row.recommendation !== undefined ? { recommendation: row.recommendation } : {}),
            ...(row.blocks !== undefined ? { blocks: row.blocks } : {}),
          })),
        ],
      },
    },
  }
}

/**
 * applySplitSeed (0012 拆分结果文件通道) — the PURE core of seedSplit, the
 * file-channel-only twin of applyAnalysisSeed: the endpoint shell reads the
 * split result file and hands the parsed proposals + the disk sha256 here.
 * Semantics carry over verbatim: an anchor hit (same sessionId AND
 * contentHash) is an UNCHANGED no-op — adopted/dismissed rows never
 * resurrect on a watcher replay; any other seed REPLACES the proposal
 * array wholesale (unregistered proposals belong to the LATEST split;
 * registered rows live in workPackages[] and are untouched — adoption
 * REMOVES its rows from the container, so nothing user-owned survives
 * here to keep). An EMPTY batch still stamps the anchor.
 */
export interface SplitSeedInput {
  readonly sessionId: string
  readonly contentHash: string
  readonly workPackages: readonly {
    readonly ref: string
    readonly title: string
    readonly boundary: string
    readonly dependsOn: readonly string[]
    readonly parallel?: boolean
    readonly covers: readonly string[]
  }[]
}

export function applySplitSeed(base: WorkbenchRecord, input: SplitSeedInput): RecordActionResult {
  const container = base.splitProposals
  if (container === undefined || container.session.sessionId !== input.sessionId) {
    return fail(404, 'not-found')
  }
  if (container.seed !== undefined && container.seed.sessionId === input.sessionId && container.seed.contentHash === input.contentHash) {
    return { ok: true, record: base, unchanged: true }
  }
  const at = now()
  return {
    ok: true,
    record: {
      ...base,
      splitProposals: {
        ...container,
        seed: { sessionId: input.sessionId, contentHash: input.contentHash, seededAt: at },
        workPackages: input.workPackages.map((row) => ({
          ref: row.ref,
          title: row.title,
          boundary: row.boundary,
          dependsOn: [...row.dependsOn],
          ...(row.parallel !== undefined ? { parallel: row.parallel } : {}),
          covers: [...row.covers],
        })),
      },
    },
  }
}
