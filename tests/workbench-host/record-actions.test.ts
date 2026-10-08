/**
 * Pure-function matrix for applyRecordAction (0006 P1b second knife): the 16
 * -member mutate union's business guards, pinned directly against the pure
 * core with no HTTP harness. Coverage:
 *   - the guard ladder: split lock → target existence (404) → state machine /
 *     referential integrity / required-note (400) → locked-version (400)
 *   - saveWorkPackage: WP-sequence minting (no recycling), present-overwrite
 *     edits with host-owned fields untouchable, dependsOn/covers referential
 *     integrity, coveredBy reprojection after every list change
 *   - removeWorkPackage: sibling dependsOn stripping + coveredBy reproject
 *   - moveWorkPackage: exact two-row order swap, boundary directions → 400
 *   - approveSplit / revokeSplitApproval: stamp-only approval (no status
 *     changes — pinned), key REMOVAL on revoke, and the user-ratified
 *     "revoke re-locks everything" matrix (six lifecycle actions locked,
 *     findings/stage family untouched)
 *   - approvePlan: tail-draft stamping across the status machine (planned/
 *     plan-draft → plan-approved; in-dev re-baseline and accepted stay put),
 *     empty-chain and all-approved faces
 *   - the lifecycle matrix: start/built/accept(pass|fail)/reopen/drop
 *   - criteria: C-sequence minting, present-overwrite edits, remove with
 *     covers stripping
 *   - isWorkbenchRecord tolerance face for splitApprovedAt (wire guard)
 *   - P2: bindSession (lifecycle gate → 404 → dropped 400 → append-only
 *     bindings with same-session idempotent/different-purpose 400),
 *     editKnowledgeCandidate (pending-only full replace) and
 *     dismiss/activateKnowledgeCandidate (three-state machine + the
 *     dual-ledger knowledgeRow projection: scope coupling, trigger
 *     normalization, provenance birthplace audit)
 *
 * PINNED GATE DIRECTION: the split stamp UNLOCKS the lifecycle (approvePlan /
 * start / built / accept / reopen / drop run on an APPROVED record and are
 * 400 locked-split while unapproved — incl. after an approve→revoke
 * round-trip), while list × coverage CRUD is locked BY the stamp. Sources:
 * protocol.ts splitApprovedAt doc, endpoint planWriteFlow's
 * `splitApprovedAt === undefined → 400 locked-split`, record-actions.ts's own
 * "revoking re-locks the lifecycle until re-approval" comment, research 0006
 * §4.2 「批准后卡片组只读、S3 解锁」.
 */
import { describe, expect, it } from 'vitest'
import type { KnowledgeRecord } from '../../src/workbench-host/types.js'
import { applyRecordAction } from '../../src/workbench-host/record-actions.js'
import { contentHashOf } from '../../src/workbench-host/artifact-store.js'
import { isReleaseItemId, isWorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import type {
  ActivateKnowledgeCandidateRequest,
  ErrorResponse,
  KnowledgeCandidate,
  ReleaseItem,
  ReviewReportEntry,
  ReviewVerdict,
  SaveReviewVerdictRequest,
  SaveReleaseItemRequest,
  WorkbenchCriterion,
  WorkbenchFinding,
  WorkbenchMutateRequestBody,
  WorkbenchRecord,
  WorkbenchWorkPackage,
} from '../../src/workbench-shared/protocol.js'

const RID = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-09-29T09:30:00.000Z'
const FINDING_ID = '44444444-4444-4444-8444-444444444444'
const CAND_ID = '55555555-5555-4555-8555-555555555555'
const GHOST_CAND = '00000000-0000-4000-8000-000000000000'

function baseRecord(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: RID,
    stage: 'plan',
    stageHistory: [{ stage: 'understand', at: NOW }, { stage: 'plan', at: NOW }],
    criteria: [],
    findings: [],
    workPackages: [],
    releaseItems: [],
    reviewReports: [],
    knowledgeCandidates: [],
    ...overrides,
  }
}

function wp(id: string, overrides: Partial<WorkbenchWorkPackage> = {}): WorkbenchWorkPackage {
  return {
    id,
    title: `工作包 ${id}`,
    boundary: `${id} 边界`,
    order: Number(id.slice(2)),
    dependsOn: [],
    covers: [],
    status: 'planned',
    plans: [],
    sessions: [],
    commits: [],
    acceptances: [],
    ...overrides,
  }
}

function criterion(id: string, overrides: Partial<WorkbenchCriterion> = {}): WorkbenchCriterion {
  return { id, text: `准则 ${id}`, coveredBy: [], ...overrides }
}

function finding(overrides: Partial<WorkbenchFinding> = {}): WorkbenchFinding {
  return { id: FINDING_ID, category: 'risk', severity: 'low', title: '慢查询风险', detail: 't_order 无索引', status: 'open', createdAt: NOW, ...overrides }
}

function candidate(overrides: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  return {
    id: CAND_ID,
    title: '候选：大表导出走异步',
    draft: '大表导出禁止一次全量拉取',
    type: 'convention',
    proposedSessionId: 'sess-origin',
    at: NOW,
    status: 'pending',
    ...overrides,
  }
}

/** Applies and unwraps the ok arm — a non-ok result fails the test with its status/code. */
function applyOk(base: WorkbenchRecord, body: WorkbenchMutateRequestBody): WorkbenchRecord {
  const result = applyRecordAction(base, body)
  if (!result.ok) throw new Error(`expected ok, got ${result.status} ${result.code}`)
  return result.record
}

const mutate = (rid = RID, expectedRevision = 0) => ({ expectedRevision, requirementId: rid })

const expectIso = (value: unknown) => {
  expect(typeof value).toBe('string')
  expect(Number.isNaN(Date.parse(value as string))).toBe(false)
}

// ---------------------------------------------------------------------------
// 1. saveWorkPackage
// ---------------------------------------------------------------------------

describe('saveWorkPackage', () => {
  it('mints WP1 with order 1 and the full not-yet-started shell on an empty list', () => {
    const record = applyOk(baseRecord(), {
      ...mutate(),
      action: 'saveWorkPackage',
      workPackage: { title: '导出重构', boundary: '仅导出链路', dependsOn: [], covers: [] },
    })
    expect(record.workPackages).toHaveLength(1)
    expect(record.workPackages[0]).toEqual({
      id: 'WP1',
      title: '导出重构',
      boundary: '仅导出链路',
      order: 1,
      dependsOn: [],
      covers: [],
      status: 'planned',
      plans: [],
      sessions: [],
      commits: [],
      acceptances: [],
    })
  })

  it('mints WP<max+1> — a gap (WP1, WP3 → WP4) is never recycled, and order rides max+1', () => {
    const record = applyOk(baseRecord({ workPackages: [wp('WP1'), wp('WP3')] }), {
      ...mutate(),
      action: 'saveWorkPackage',
      workPackage: { title: '新包', boundary: '', dependsOn: [], covers: [] },
    })
    expect(record.workPackages.map((candidate) => candidate.id)).toEqual(['WP1', 'WP3', 'WP4'])
    expect(record.workPackages[2]?.order).toBe(4)
    expect(record.workPackages[2]?.status).toBe('planned')
  })

  it('edits present-overwrite: title/boundary/dependsOn/covers overwritten, parallel absent keeps the old value, host-owned fields untouchable', () => {
    const base = baseRecord({
      workPackages: [wp('WP1', { parallel: true, status: 'plan-approved', order: 7, plans: [{ version: 1, approvedAt: NOW }], sessions: [{ sessionId: 's1', purpose: 'dev', boundAt: NOW }] })],
    })
    const record = applyOk(base, {
      ...mutate(),
      action: 'saveWorkPackage',
      workPackage: { id: 'WP1', title: '改名', boundary: '新边界', dependsOn: [], covers: [] }, // parallel omitted on purpose
    })
    expect(record.workPackages[0]).toMatchObject({
      id: 'WP1',
      title: '改名',
      boundary: '新边界',
      dependsOn: [],
      covers: [],
      parallel: true, // absent key carries over
      status: 'plan-approved', // host-owned: untouched
      order: 7,
      plans: [{ version: 1, approvedAt: NOW }], // plans survive an edit verbatim
      sessions: [{ sessionId: 's1', purpose: 'dev', boundAt: NOW }],
    })
  })

  it('edits overwrite an explicitly present parallel key too', () => {
    const base = baseRecord({ workPackages: [wp('WP1', { parallel: true })] })
    const record = applyOk(base, {
      ...mutate(),
      action: 'saveWorkPackage',
      workPackage: { id: 'WP1', title: 'x', boundary: '', dependsOn: [], covers: [], parallel: false },
    })
    expect(record.workPackages[0]?.parallel).toBe(false)
  })

  it('rejects dependsOn pointing at a nonexistent work package, at itself, and (on edit) at its own id', () => {
    const withPeers = baseRecord({ workPackages: [wp('WP1'), wp('WP2')] })
    for (const dependsOn of [['WP9']]) {
      const result = applyRecordAction(withPeers, {
        ...mutate(),
        action: 'saveWorkPackage',
        workPackage: { title: 'x', boundary: '', dependsOn, covers: [] },
      })
      expect(result).toEqual({ ok: false, status: 400, code: 'bad-request' })
    }

    const selfCreate = applyRecordAction(withPeers, {
      ...mutate(),
      action: 'saveWorkPackage',
      workPackage: { title: 'x', boundary: '', dependsOn: ['WP1'], covers: [] }, // create with id absent — WP1 is "another" row, so this is legal
    })
    expect(selfCreate.ok).toBe(true)

    const selfEdit = applyRecordAction(withPeers, {
      ...mutate(),
      action: 'saveWorkPackage',
      workPackage: { id: 'WP1', title: 'x', boundary: '', dependsOn: ['WP1'], covers: [] },
    })
    expect(selfEdit).toEqual({ ok: false, status: 400, code: 'bad-request' })

    const ghostEdit = applyRecordAction(withPeers, {
      ...mutate(),
      action: 'saveWorkPackage',
      workPackage: { id: 'WP1', title: 'x', boundary: '', dependsOn: ['WP9'], covers: [] },
    })
    expect(ghostEdit).toEqual({ ok: false, status: 400, code: 'bad-request' })
  })

  it('rejects covers pointing at a nonexistent criterion', () => {
    const result = applyRecordAction(baseRecord({ criteria: [criterion('C1')] }), {
      ...mutate(),
      action: 'saveWorkPackage',
      workPackage: { title: 'x', boundary: '', dependsOn: [], covers: ['C2'] },
    })
    expect(result).toEqual({ ok: false, status: 400, code: 'bad-request' })
  })

  it('answers 404 for an edit naming an unknown id (with otherwise-legal references)', () => {
    const result = applyRecordAction(baseRecord({ workPackages: [wp('WP1')] }), {
      ...mutate(),
      action: 'saveWorkPackage',
      workPackage: { id: 'WP9', title: 'x', boundary: '', dependsOn: [], covers: [] },
    })
    expect(result).toEqual({ ok: false, status: 404, code: 'not-found' })
  })

  it('is locked behind the split gate for both create and edit', () => {
    const locked = baseRecord({ splitApprovedAt: NOW, workPackages: [wp('WP1')] })
    const create = applyRecordAction(locked, {
      ...mutate(),
      action: 'saveWorkPackage',
      workPackage: { title: 'x', boundary: '', dependsOn: [], covers: [] },
    })
    expect(create).toEqual({ ok: false, status: 400, code: 'locked-split' })

    const edit = applyRecordAction(locked, {
      ...mutate(),
      action: 'saveWorkPackage',
      workPackage: { id: 'WP1', title: 'x', boundary: '', dependsOn: [], covers: [] },
    })
    expect(edit).toEqual({ ok: false, status: 400, code: 'locked-split' })
  })

  it('reprojects coveredBy on create and on a covers edit', () => {
    const seeded = baseRecord({ criteria: [criterion('C1'), criterion('C2')] })
    const created = applyOk(seeded, {
      ...mutate(),
      action: 'saveWorkPackage',
      workPackage: { title: 'x', boundary: '', dependsOn: [], covers: ['C1'] },
    })
    expect(created.criteria[0]?.coveredBy).toEqual(['WP1'])
    expect(created.criteria[1]?.coveredBy).toEqual([])

    const edited = applyOk(created, {
      ...mutate(),
      action: 'saveWorkPackage',
      workPackage: { id: 'WP1', title: 'x', boundary: '', dependsOn: [], covers: ['C2'] },
    })
    expect(edited.criteria[0]?.coveredBy).toEqual([])
    expect(edited.criteria[1]?.coveredBy).toEqual(['WP1'])
  })
})

// ---------------------------------------------------------------------------
// 2. removeWorkPackage
// ---------------------------------------------------------------------------

describe('removeWorkPackage', () => {
  it('deletes the row, strips sibling dependsOn references, and reprojects coveredBy', () => {
    const base = baseRecord({
      criteria: [criterion('C1', { coveredBy: ['WP1'] })],
      workPackages: [wp('WP1', { covers: ['C1'] }), wp('WP2', { dependsOn: ['WP1'] }), wp('WP3', { dependsOn: ['WP1', 'WP2'] })],
    })
    const record = applyOk(base, { ...mutate(), action: 'removeWorkPackage', id: 'WP1' })
    expect(record.workPackages.map((candidate) => candidate.id)).toEqual(['WP2', 'WP3'])
    expect(record.workPackages[0]?.dependsOn).toEqual([]) // WP2: reference stripped
    expect(record.workPackages[1]?.dependsOn).toEqual(['WP2']) // WP3: only WP1 stripped
    expect(record.criteria[0]?.coveredBy).toEqual([]) // coverage reprojected
  })

  it('answers 404 for an unknown id and locked-split over an approved contract', () => {
    const ghost = applyRecordAction(baseRecord({ workPackages: [wp('WP1')] }), { ...mutate(), action: 'removeWorkPackage', id: 'WP9' })
    expect(ghost).toEqual({ ok: false, status: 404, code: 'not-found' })

    const locked = applyRecordAction(baseRecord({ splitApprovedAt: NOW, workPackages: [wp('WP1')] }), { ...mutate(), action: 'removeWorkPackage', id: 'WP1' })
    expect(locked).toEqual({ ok: false, status: 400, code: 'locked-split' })
  })
})

// ---------------------------------------------------------------------------
// 3. moveWorkPackage
// ---------------------------------------------------------------------------

describe('moveWorkPackage', () => {
  const three = () => baseRecord({ workPackages: [wp('WP1'), wp('WP2'), wp('WP3')] }) // orders 1/2/3

  it('swaps the order values of exactly the two adjacent rows (WP2 up → 1↔2)', () => {
    const record = applyOk(three(), { ...mutate(), action: 'moveWorkPackage', id: 'WP2', direction: 'up' })
    expect(record.workPackages.find((candidate) => candidate.id === 'WP1')?.order).toBe(2)
    expect(record.workPackages.find((candidate) => candidate.id === 'WP2')?.order).toBe(1)
    expect(record.workPackages.find((candidate) => candidate.id === 'WP3')?.order).toBe(3)
  })

  it('rejects moves off the ends of the order axis and unknown ids', () => {
    const headUp = applyRecordAction(three(), { ...mutate(), action: 'moveWorkPackage', id: 'WP1', direction: 'up' })
    expect(headUp).toEqual({ ok: false, status: 400, code: 'bad-request' })

    const tailDown = applyRecordAction(three(), { ...mutate(), action: 'moveWorkPackage', id: 'WP3', direction: 'down' })
    expect(tailDown).toEqual({ ok: false, status: 400, code: 'bad-request' })

    const ghost = applyRecordAction(three(), { ...mutate(), action: 'moveWorkPackage', id: 'WP9', direction: 'up' })
    expect(ghost).toEqual({ ok: false, status: 404, code: 'not-found' })

    const locked = applyRecordAction(baseRecord({ splitApprovedAt: NOW, workPackages: [wp('WP1'), wp('WP2')] }), { ...mutate(), action: 'moveWorkPackage', id: 'WP1', direction: 'down' })
    expect(locked).toEqual({ ok: false, status: 400, code: 'locked-split' })
  })
})

// ---------------------------------------------------------------------------
// 4. approveSplit — the stamp-only pin
// ---------------------------------------------------------------------------

describe('approveSplit', () => {
  it('stamps an ISO timestamp and changes NO work-package status (pinned)', () => {
    const base = baseRecord({ workPackages: [wp('WP1', { status: 'planned' }), wp('WP2', { status: 'in-dev' })] })
    const record = applyOk(base, { ...mutate(), action: 'approveSplit' })
    expectIso(record.splitApprovedAt)
    expect(record.workPackages[0]?.status).toBe('planned') // the pin: approval moves nothing
    expect(record.workPackages[1]?.status).toBe('in-dev')
  })

  it('rejects an empty list and a second approval', () => {
    const empty = applyRecordAction(baseRecord(), { ...mutate(), action: 'approveSplit' })
    expect(empty).toEqual({ ok: false, status: 400, code: 'bad-request' })

    const twice = applyRecordAction(baseRecord({ splitApprovedAt: NOW, workPackages: [wp('WP1')] }), { ...mutate(), action: 'approveSplit' })
    expect(twice).toEqual({ ok: false, status: 400, code: 'bad-request' })
  })
})

// ---------------------------------------------------------------------------
// 5. revokeSplitApproval
// ---------------------------------------------------------------------------

describe('revokeSplitApproval', () => {
  it('strips the stamp entirely (no key on the object) and keeps the list', () => {
    const base = baseRecord({ splitApprovedAt: NOW, workPackages: [wp('WP1'), wp('WP2')] })
    const result = applyRecordAction(base, { ...mutate(), action: 'revokeSplitApproval' })
    if (!result.ok) throw new Error('expected ok')
    expect(result.record.splitApprovedAt).toBeUndefined()
    expect('splitApprovedAt' in result.record).toBe(false) // the key is REMOVED, not set to undefined
    expect(result.record.workPackages).toHaveLength(2) // history preserved = the list survives
  })

  it('rejects a revoke over an unapproved record, and unlock list edits again afterwards', () => {
    const unapproved = applyRecordAction(baseRecord({ workPackages: [wp('WP1')] }), { ...mutate(), action: 'revokeSplitApproval' })
    expect(unapproved).toEqual({ ok: false, status: 400, code: 'bad-request' })

    const approved = applyOk(baseRecord({ workPackages: [wp('WP1')] }), { ...mutate(), action: 'approveSplit' })
    const revoked = applyOk(approved, { ...mutate(), action: 'revokeSplitApproval' })
    const edit = applyOk(revoked, {
      ...mutate(),
      action: 'saveWorkPackage',
      workPackage: { id: 'WP1', title: '改回', boundary: '', dependsOn: [], covers: [] },
    })
    expect(edit.workPackages[0]?.title).toBe('改回')
  })
})

// ---------------------------------------------------------------------------
// 6. The revoke re-locks EVERYTHING (user-ratified matrix)
// ---------------------------------------------------------------------------

describe('revoke → the full lock matrix', () => {
  const revokedRecord = () => {
    const approved = applyOk(baseRecord({
      workPackages: [wp('WP1', { status: 'plan-approved', plans: [{ version: 1 }] })],
      findings: [finding()],
    }), { ...mutate(), action: 'approveSplit' })
    return applyOk(approved, { ...mutate(), action: 'revokeSplitApproval' })
  }

  it('locks all six lifecycle actions with 400 locked-split after an approve→revoke round-trip', () => {
    const locked = revokedRecord()
    const bodies: WorkbenchMutateRequestBody[] = [
      { ...mutate(), action: 'approvePlan', id: 'WP1' },
      { ...mutate(), action: 'startWorkPackage', id: 'WP1' },
      { ...mutate(), action: 'markWorkPackageBuilt', id: 'WP1' },
      { ...mutate(), action: 'acceptWorkPackage', id: 'WP1', result: 'pass' },
      { ...mutate(), action: 'reopenWorkPackage', id: 'WP1' },
      { ...mutate(), action: 'dropWorkPackage', id: 'WP1' },
    ]
    for (const body of bodies) {
      expect(applyRecordAction(locked, body)).toEqual({ ok: false, status: 400, code: 'locked-split' })
    }
  })

  it('leaves the findings/stage family OUTSIDE the gate — all three actions stay ok', () => {
    const locked = revokedRecord()
    const advanced = applyOk(locked, { ...mutate(), action: 'advanceStage', stage: 'implement', note: '开工' })
    expect(advanced.stage).toBe('implement')
    expect(advanced.stageHistory).toHaveLength(3)

    const saved = applyOk(locked, {
      ...mutate(),
      action: 'saveFinding',
      finding: { category: 'conflict', severity: 'high', title: '新发现', detail: '细节', status: 'open' },
    })
    expect(saved.findings).toHaveLength(2)

    const removed = applyOk(locked, { ...mutate(), action: 'removeFinding', id: FINDING_ID })
    expect(removed.findings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 7. approvePlan
// ---------------------------------------------------------------------------

describe('approvePlan', () => {
  // Gate direction (pinned contract): the split stamp UNLOCKS the lifecycle —
  // plan approval runs on an APPROVED record and is locked-split while
  // unapproved. protocol.ts's splitApprovedAt doc, endpoint planWriteFlow
  // (`splitApprovedAt === undefined → 400 locked-split`) and the research
  // doc (批准后…S3 解锁) all state this direction.
  it('stamps the LAST unapproved entry only and moves planned → plan-approved', () => {
    const base = baseRecord({ splitApprovedAt: NOW, workPackages: [wp('WP1', { plans: [{ version: 1, approvedAt: NOW }, { version: 2 }] })] })
    const record = applyOk(base, { ...mutate(), action: 'approvePlan', id: 'WP1' })
    const plans = record.workPackages[0]?.plans ?? []
    expect(plans[0]?.approvedAt).toBe(NOW) // earlier approved entry untouched
    expectIso(plans[1]?.approvedAt)
    expect(record.workPackages[0]?.status).toBe('plan-approved')
  })

  it('moves plan-draft → plan-approved', () => {
    const base = baseRecord({ splitApprovedAt: NOW, workPackages: [wp('WP1', { status: 'plan-draft', plans: [{ version: 1 }] })] })
    const record = applyOk(base, { ...mutate(), action: 'approvePlan', id: 'WP1' })
    expect(record.workPackages[0]?.status).toBe('plan-approved')
    expectIso(record.workPackages[0]?.plans[0]?.approvedAt)
  })

  it('re-baselines in-dev WITHOUT moving the status (pinned), and accepted stays accepted', () => {
    const inDev = baseRecord({ splitApprovedAt: NOW, workPackages: [wp('WP1', { status: 'in-dev', plans: [{ version: 1, approvedAt: NOW }, { version: 2 }] })] })
    const rebaselined = applyOk(inDev, { ...mutate(), action: 'approvePlan', id: 'WP1' })
    expect(rebaselined.workPackages[0]?.status).toBe('in-dev') // the pin
    expectIso(rebaselined.workPackages[0]?.plans[1]?.approvedAt)

    const accepted = baseRecord({ splitApprovedAt: NOW, workPackages: [wp('WP1', { status: 'accepted', plans: [{ version: 1, approvedAt: NOW }, { version: 2 }] })] })
    const restamped = applyOk(accepted, { ...mutate(), action: 'approvePlan', id: 'WP1' })
    expect(restamped.workPackages[0]?.status).toBe('accepted')
    expectIso(restamped.workPackages[0]?.plans[1]?.approvedAt)
  })

  it('rejects an empty plan chain and an all-approved chain with 400 (locked-version face) and an unknown id with 404', () => {
    const approved = { splitApprovedAt: NOW } as const
    // The contract pins only the 400 for an empty chain; the implementation's
    // unified "nothing left to approve" face is locked-version for both it and
    // the all-approved chain — satisfying the pinned 400.
    const noPlans = applyRecordAction(baseRecord({ ...approved, workPackages: [wp('WP1')] }), { ...mutate(), action: 'approvePlan', id: 'WP1' })
    expect(noPlans).toMatchObject({ ok: false, status: 400 })

    const allApproved = applyRecordAction(
      baseRecord({ ...approved, workPackages: [wp('WP1', { plans: [{ version: 1, approvedAt: NOW }] })] }),
      { ...mutate(), action: 'approvePlan', id: 'WP1' },
    )
    expect(allApproved).toEqual({ ok: false, status: 400, code: 'locked-version' })

    const ghost = applyRecordAction(baseRecord({ ...approved, workPackages: [wp('WP1')] }), { ...mutate(), action: 'approvePlan', id: 'WP9' })
    expect(ghost).toEqual({ ok: false, status: 404, code: 'not-found' })
  })

  it('is locked-split while the split contract is UNapproved (未批准时)', () => {
    const unapproved = baseRecord({ workPackages: [wp('WP1', { plans: [{ version: 1 }] })] })
    const result = applyRecordAction(unapproved, { ...mutate(), action: 'approvePlan', id: 'WP1' })
    expect(result).toEqual({ ok: false, status: 400, code: 'locked-split' })
  })
})

// ---------------------------------------------------------------------------
// 8/9. The lifecycle matrix
// ---------------------------------------------------------------------------

describe('lifecycle matrix', () => {
  // Every scenario runs on an APPROVED record: the split stamp unlocks the
  // lifecycle (pinned direction — see the approvePlan describe).
  const approved = (workPackages: WorkbenchWorkPackage[]) => baseRecord({ splitApprovedAt: NOW, workPackages })

  it('startWorkPackage: plan-approved → in-dev only; planned / plan-draft / in-dev are illegal', () => {
    const started = applyOk(approved([wp('WP1', { status: 'plan-approved' })]), { ...mutate(), action: 'startWorkPackage', id: 'WP1' })
    expect(started.workPackages[0]?.status).toBe('in-dev')

    for (const status of ['planned', 'plan-draft', 'in-dev'] as const) {
      const result = applyRecordAction(approved([wp('WP1', { status })]), { ...mutate(), action: 'startWorkPackage', id: 'WP1' })
      expect(result).toEqual({ ok: false, status: 400, code: 'bad-request' })
    }
  })

  it('markWorkPackageBuilt: in-dev → built only', () => {
    const built = applyOk(approved([wp('WP1', { status: 'in-dev' })]), { ...mutate(), action: 'markWorkPackageBuilt', id: 'WP1' })
    expect(built.workPackages[0]?.status).toBe('built')

    for (const from of ['plan-approved', 'built'] as const) {
      const result = applyRecordAction(approved([wp('WP1', { status: from })]), { ...mutate(), action: 'markWorkPackageBuilt', id: 'WP1' })
      expect(result).toEqual({ ok: false, status: 400, code: 'bad-request' })
    }
  })

  it('acceptWorkPackage pass: built → accepted with the verdict entering the acceptance history (note optional, trimmed)', () => {
    const plain = applyOk(approved([wp('WP1', { status: 'built' })]), { ...mutate(), action: 'acceptWorkPackage', id: 'WP1', result: 'pass' })
    expect(plain.workPackages[0]?.status).toBe('accepted')
    expect(plain.workPackages[0]?.acceptances).toEqual([{ at: expect.any(String), result: 'pass' }])

    const noted = applyOk(approved([wp('WP1', { status: 'built' })]), { ...mutate(), action: 'acceptWorkPackage', id: 'WP1', result: 'pass', note: '  客户确认  ' })
    expect(noted.workPackages[0]?.acceptances).toEqual([{ at: expect.any(String), result: 'pass', note: '客户确认' }])
  })

  it('acceptWorkPackage fail: built → in-dev with a REQUIRED rework note (missing and blank both 400)', () => {
    const failed = applyOk(approved([wp('WP1', { status: 'built' })]), { ...mutate(), action: 'acceptWorkPackage', id: 'WP1', result: 'fail', note: '导出超时，返工' })
    expect(failed.workPackages[0]?.status).toBe('in-dev')
    expect(failed.workPackages[0]?.acceptances).toEqual([{ at: expect.any(String), result: 'fail', note: '导出超时，返工' }])

    const noNote = applyRecordAction(approved([wp('WP1', { status: 'built' })]), { ...mutate(), action: 'acceptWorkPackage', id: 'WP1', result: 'fail' })
    expect(noNote).toEqual({ ok: false, status: 400, code: 'bad-request' })

    const blankNote = applyRecordAction(approved([wp('WP1', { status: 'built' })]), { ...mutate(), action: 'acceptWorkPackage', id: 'WP1', result: 'fail', note: '   ' })
    expect(blankNote).toEqual({ ok: false, status: 400, code: 'bad-request' })

    const notBuilt = applyRecordAction(approved([wp('WP1', { status: 'in-dev' })]), { ...mutate(), action: 'acceptWorkPackage', id: 'WP1', result: 'pass' })
    expect(notBuilt).toEqual({ ok: false, status: 400, code: 'bad-request' })
  })

  it('reopenWorkPackage: accepted → in-dev only', () => {
    const reopened = applyOk(approved([wp('WP1', { status: 'accepted' })]), { ...mutate(), action: 'reopenWorkPackage', id: 'WP1' })
    expect(reopened.workPackages[0]?.status).toBe('in-dev')

    const built = applyRecordAction(approved([wp('WP1', { status: 'built' })]), { ...mutate(), action: 'reopenWorkPackage', id: 'WP1' })
    expect(built).toEqual({ ok: false, status: 400, code: 'bad-request' })
  })

  it('dropWorkPackage: the three not-yet-started states → dropped; in-dev / built / accepted are illegal', () => {
    for (const status of ['planned', 'plan-draft', 'plan-approved'] as const) {
      const dropped = applyOk(approved([wp('WP1', { status })]), { ...mutate(), action: 'dropWorkPackage', id: 'WP1' })
      expect(dropped.workPackages[0]?.status).toBe('dropped')
    }
    for (const status of ['in-dev', 'built', 'accepted'] as const) {
      const result = applyRecordAction(approved([wp('WP1', { status })]), { ...mutate(), action: 'dropWorkPackage', id: 'WP1' })
      expect(result).toEqual({ ok: false, status: 400, code: 'bad-request' })
    }
  })

  it('every lifecycle action answers 404 for an unknown work package before any state check', () => {
    const base = approved([wp('WP1')])
    for (const action of ['approvePlan', 'startWorkPackage', 'markWorkPackageBuilt', 'reopenWorkPackage', 'dropWorkPackage'] as const) {
      const result = applyRecordAction(base, { ...mutate(), action, id: 'WP9' })
      expect(result).toEqual({ ok: false, status: 404, code: 'not-found' })
    }
    const accept = applyRecordAction(base, { ...mutate(), action: 'acceptWorkPackage', id: 'WP9', result: 'pass' })
    expect(accept).toEqual({ ok: false, status: 404, code: 'not-found' })
  })
})

// ---------------------------------------------------------------------------
// 10. Criteria
// ---------------------------------------------------------------------------

describe('saveCriterion / removeCriterion', () => {
  it('mints C1 on an empty list and skips gaps without recycling (C3 present → C4)', () => {
    const first = applyOk(baseRecord(), { ...mutate(), action: 'saveCriterion', criterion: { text: '导出 ≤ 5s' } })
    expect(first.criteria[0]).toEqual({ id: 'C1', text: '导出 ≤ 5s', coveredBy: [] })

    const afterGap = applyOk(baseRecord({ criteria: [criterion('C3')] }), { ...mutate(), action: 'saveCriterion', criterion: { text: '新准则', sourceSection: '§2.1' } })
    expect(afterGap.criteria[1]).toEqual({ id: 'C4', text: '新准则', sourceSection: '§2.1', coveredBy: [] })
  })

  it('edits present-overwrite: text overwritten, sourceSection absent carries over, coveredBy preserved', () => {
    const base = baseRecord({ criteria: [criterion('C1', { text: '旧文本', sourceSection: '§1', coveredBy: ['WP1'] })] })
    const record = applyOk(base, { ...mutate(), action: 'saveCriterion', criterion: { id: 'C1', text: '新文本' } })
    expect(record.criteria[0]).toEqual({ id: 'C1', text: '新文本', sourceSection: '§1', coveredBy: ['WP1'] })
  })

  it('removeCriterion strips the row, strips every WP covers reference, and reprojects coveredBy', () => {
    const base = baseRecord({
      criteria: [criterion('C1', { coveredBy: ['WP1'] }), criterion('C2', { coveredBy: ['WP1'] })],
      workPackages: [wp('WP1', { covers: ['C1', 'C2'] })],
    })
    const record = applyOk(base, { ...mutate(), action: 'removeCriterion', id: 'C1' })
    expect(record.criteria.map((row) => row.id)).toEqual(['C2'])
    expect(record.workPackages[0]?.covers).toEqual(['C2']) // reference stripped
    expect(record.criteria[0]?.coveredBy).toEqual(['WP1']) // reprojection of what remains
  })

  it('answers 404 for unknown ids and locked-split for both actions', () => {
    const ghostEdit = applyRecordAction(baseRecord({ criteria: [criterion('C1')] }), { ...mutate(), action: 'saveCriterion', criterion: { id: 'C9', text: 'x' } })
    expect(ghostEdit).toEqual({ ok: false, status: 404, code: 'not-found' })

    const ghostRemove = applyRecordAction(baseRecord({ criteria: [criterion('C1')] }), { ...mutate(), action: 'removeCriterion', id: 'C9' })
    expect(ghostRemove).toEqual({ ok: false, status: 404, code: 'not-found' })

    const lockedBase = baseRecord({ splitApprovedAt: NOW, criteria: [criterion('C1')], workPackages: [wp('WP1')] })
    const lockedSave = applyRecordAction(lockedBase, { ...mutate(), action: 'saveCriterion', criterion: { text: 'x' } })
    expect(lockedSave).toEqual({ ok: false, status: 400, code: 'locked-split' })

    const lockedRemove = applyRecordAction(lockedBase, { ...mutate(), action: 'removeCriterion', id: 'C1' })
    expect(lockedRemove).toEqual({ ok: false, status: 400, code: 'locked-split' })
  })
})

// ---------------------------------------------------------------------------
// 11. Wire guard tolerance face for splitApprovedAt
// ---------------------------------------------------------------------------

describe('isWorkbenchRecord × splitApprovedAt', () => {
  it('tolerates an absent stamp and a legal ISO string', () => {
    expect(isWorkbenchRecord(baseRecord())).toBe(true)
    expect(isWorkbenchRecord(baseRecord({ splitApprovedAt: NOW }))).toBe(true)
  })

  it('rejects non-string and empty-string stamps', () => {
    expect(isWorkbenchRecord({ ...baseRecord(), splitApprovedAt: 123 } as unknown as WorkbenchRecord)).toBe(false)
    expect(isWorkbenchRecord({ ...baseRecord(), splitApprovedAt: '' })).toBe(false)
  })
})

// ErrorResponse code vocabulary keeps the two gate codes (drift pin)
describe('gate error codes exist in the wire vocabulary', () => {
  it("ErrorResponse['code'] carries locked-split and locked-version", () => {
    const codes: ErrorResponse['code'][] = ['locked-split', 'locked-version']
    expect(codes).toContain('locked-split')
    expect(codes).toContain('locked-version')
  })
})

describe('restoreWorkPackage（已放弃回收站化——验收轮三）', () => {
  const restore = (id: string) => ({ expectedRevision: 1, requirementId: RID, action: 'restoreWorkPackage' as const, id })

  it('未批准：dropped → planned（无计划链的最简恢复）', () => {
    const base = baseRecord({ workPackages: [wp('WP1', { status: 'dropped' })] })
    const result = applyRecordAction(base, restore('WP1'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.workPackages[0]?.status).toBe('planned')
  })

  it('恢复状态随计划链推导：尾版已批准 → plan-approved（不会卡死在不能开工又无可批）', () => {
    const base = baseRecord({ workPackages: [wp('WP1', { status: 'dropped', plans: [{ version: 1, approvedAt: NOW }] })] })
    const result = applyRecordAction(base, restore('WP1'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.workPackages[0]?.status).toBe('plan-approved')
  })

  it('恢复状态随计划链推导：尾草稿 → plan-draft', () => {
    const base = baseRecord({ workPackages: [wp('WP1', { status: 'dropped', plans: [{ version: 1 }] })] })
    const result = applyRecordAction(base, restore('WP1'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.workPackages[0]?.status).toBe('plan-draft')
  })

  it('已批准 → 400 locked-split（清单编辑门）；撤销后恢复放行', () => {
    const approvedBase = baseRecord({ splitApprovedAt: NOW, workPackages: [wp('WP1', { status: 'dropped' })] })
    expect(applyRecordAction(approvedBase, restore('WP1'))).toEqual({ ok: false, status: 400, code: 'locked-split' })
    const { splitApprovedAt: _stamp, ...open } = approvedBase
    const reopened = applyRecordAction(open, restore('WP1'))
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.record.workPackages[0]?.status).toBe('planned')
  })

  it('非 dropped 态恢复 → 400 bad-request；未知 id → 404', () => {
    expect(applyRecordAction(baseRecord({ workPackages: [wp('WP1')] }), restore('WP1'))).toEqual({ ok: false, status: 400, code: 'bad-request' })
    expect(applyRecordAction(baseRecord({ workPackages: [] }), restore('WP9'))).toEqual({ ok: false, status: 404, code: 'not-found' })
  })
})

// ---------------------------------------------------------------------------
// 12. P2: bindSession
// ---------------------------------------------------------------------------

describe('bindSession (P2 session binding)', () => {
  const bind = (id: string, sessionId: string, purpose: 'analysis' | 'dev' | 'review') => ({
    ...mutate(),
    action: 'bindSession' as const,
    id,
    sessionId,
    purpose,
  })

  it('split 未批 → 400 locked-split（绑定属执行期关联，生命周期门先于一切）', () => {
    const result = applyRecordAction(baseRecord({ workPackages: [wp('WP1')] }), bind('WP1', 'sess-1', 'dev'))
    expect(result).toEqual({ ok: false, status: 400, code: 'locked-split' })
  })

  it('未知工作包 → 404 not-found（门在先、存在性其次，与生命周期家族同梯次）', () => {
    const base = baseRecord({ splitApprovedAt: NOW, workPackages: [wp('WP1')] })
    expect(applyRecordAction(base, bind('WP9', 'sess-1', 'dev'))).toEqual({ ok: false, status: 404, code: 'not-found' })
  })

  it('dropped 工作包 → 400 bad-request（弃止包不再接会话）', () => {
    const base = baseRecord({ splitApprovedAt: NOW, workPackages: [wp('WP1', { status: 'dropped' })] })
    expect(applyRecordAction(base, bind('WP1', 'sess-1', 'dev'))).toEqual({ ok: false, status: 400, code: 'bad-request' })
  })

  it('append：绑定行 {sessionId, purpose, boundAt: ISO} 追加且既有绑定保留', () => {
    const base = baseRecord({
      splitApprovedAt: NOW,
      workPackages: [wp('WP1', { sessions: [{ sessionId: 'sess-0', purpose: 'analysis', boundAt: NOW }] })],
    })
    const result = applyRecordAction(base, bind('WP1', 'sess-1', 'dev'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const sessions = result.record.workPackages[0]?.sessions ?? []
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toEqual({ sessionId: 'sess-0', purpose: 'analysis', boundAt: NOW })
    expect(sessions[1]).toEqual({ sessionId: 'sess-1', purpose: 'dev', boundAt: expect.any(String) })
    expectIso(sessions[1]?.boundAt)
  })

  it('同 sessionId 同 purpose ⇒ 幂等 {record: base, unchanged: true}（sessions 不动、revision 面无新账）', () => {
    const base = baseRecord({
      splitApprovedAt: NOW,
      workPackages: [wp('WP1', { sessions: [{ sessionId: 'sess-1', purpose: 'dev', boundAt: NOW }] })],
    })
    const result = applyRecordAction(base, bind('WP1', 'sess-1', 'dev'))
    expect(result).toEqual({ ok: true, record: base, unchanged: true })
    if (!result.ok) return
    expect(result.record).toBe(base) // 引用即 base —— 端点凭 unchanged 跳过 save
    expect(result.record.workPackages[0]?.sessions).toHaveLength(1)
  })

  it('同 sessionId 异 purpose ⇒ 400 bad-request（双 chip / 静默改史都不允许）', () => {
    const base = baseRecord({
      splitApprovedAt: NOW,
      workPackages: [wp('WP1', { sessions: [{ sessionId: 'sess-1', purpose: 'dev', boundAt: NOW }] })],
    })
    expect(applyRecordAction(base, bind('WP1', 'sess-1', 'analysis'))).toEqual({ ok: false, status: 400, code: 'bad-request' })
  })
})

// ---------------------------------------------------------------------------
// 13. P2: editKnowledgeCandidate
// ---------------------------------------------------------------------------

describe('editKnowledgeCandidate (P2 候选编辑)', () => {
  const edit = (id: string, candidate: { title: string; draft: string; type: 'business' | 'convention' }) => ({
    ...mutate(),
    action: 'editKnowledgeCandidate' as const,
    id,
    candidate,
  })

  it('pending：title/draft/type 三字段全替换，id/at/proposedSessionId/status 承接', () => {
    const base = baseRecord({ knowledgeCandidates: [candidate()] })
    const record = applyOk(base, edit(CAND_ID, { title: '改题', draft: '改稿内容', type: 'business' }))
    expect(record.knowledgeCandidates[0]).toEqual({
      id: CAND_ID,
      title: '改题',
      draft: '改稿内容',
      type: 'business',
      proposedSessionId: 'sess-origin',
      at: NOW,
      status: 'pending',
    })
  })

  it('非 pending（promoted / dismissed）→ 400 bad-request（编辑只属于待沉淀队列）', () => {
    for (const status of ['promoted', 'dismissed'] as const) {
      const base = baseRecord({ knowledgeCandidates: [candidate({ status })] })
      expect(applyRecordAction(base, edit(CAND_ID, { title: 'x', draft: 'y', type: 'business' })))
        .toEqual({ ok: false, status: 400, code: 'bad-request' })
    }
  })

  it('未知 id → 404 not-found', () => {
    const base = baseRecord({ knowledgeCandidates: [candidate()] })
    expect(applyRecordAction(base, edit(GHOST_CAND, { title: 'x', draft: 'y', type: 'business' })))
      .toEqual({ ok: false, status: 404, code: 'not-found' })
  })
})

// ---------------------------------------------------------------------------
// 14. P2: dismissKnowledgeCandidate
// ---------------------------------------------------------------------------

describe('dismissKnowledgeCandidate (P2 候选弃置)', () => {
  const dismiss = (id: string) => ({ ...mutate(), action: 'dismissKnowledgeCandidate' as const, id })

  it('pending → dismissed（其余字段原样保留）', () => {
    const base = baseRecord({ knowledgeCandidates: [candidate()] })
    const record = applyOk(base, dismiss(CAND_ID))
    expect(record.knowledgeCandidates[0]).toEqual({ ...candidate(), status: 'dismissed' })
  })

  it('已 dismissed ⇒ 幂等 {record: base, unchanged: true}', () => {
    const base = baseRecord({ knowledgeCandidates: [candidate({ status: 'dismissed' })] })
    const result = applyRecordAction(base, dismiss(CAND_ID))
    expect(result).toEqual({ ok: true, record: base, unchanged: true })
    if (!result.ok) return
    expect(result.record).toBe(base)
  })

  it('promoted → 400 bad-request；未知 id → 404', () => {
    const promoted = baseRecord({ knowledgeCandidates: [candidate({ status: 'promoted' })] })
    expect(applyRecordAction(promoted, dismiss(CAND_ID))).toEqual({ ok: false, status: 400, code: 'bad-request' })
    const base = baseRecord({ knowledgeCandidates: [candidate()] })
    expect(applyRecordAction(base, dismiss(GHOST_CAND))).toEqual({ ok: false, status: 404, code: 'not-found' })
  })
})

// ---------------------------------------------------------------------------
// 15. P2: activateKnowledgeCandidate — the dual-ledger projection
// ---------------------------------------------------------------------------

describe('activateKnowledgeCandidate (P2 双账本推进)', () => {
  type ActivateKnowledge = ActivateKnowledgeCandidateRequest['knowledge']
  const activate = (id: string, knowledge: ActivateKnowledge) => ({
    ...mutate(),
    action: 'activateKnowledgeCandidate' as const,
    id,
    knowledge,
  })
  const activateOk = (
    base: WorkbenchRecord,
    id: string,
    knowledge: ActivateKnowledge,
  ): { record: WorkbenchRecord; unchanged?: boolean; knowledgeRow: KnowledgeRecord } => {
    const result = applyRecordAction(base, activate(id, knowledge))
    if (!result.ok || result.knowledgeRow === undefined) throw new Error('expected ok + knowledgeRow')
    return { record: result.record, unchanged: result.unchanged, knowledgeRow: result.knowledgeRow }
  }

  it('pending → promoted：knowledgeRow 全字段（id=候选 id、title=候选 title、content=候选 draft、provenance.sessionId=proposedSessionId、keyword value trim）', () => {
    const base = baseRecord({ knowledgeCandidates: [candidate()] })
    const result = activateOk(base, CAND_ID, { scope: 'global', type: 'convention', trigger: { mode: 'keyword', value: '  导出  ' } })
    expect(result.record.knowledgeCandidates[0]?.status).toBe('promoted')
    expect(result.knowledgeRow).toEqual({
      id: CAND_ID,
      scope: 'global',
      type: 'convention',
      title: '候选：大表导出走异步',
      content: '大表导出禁止一次全量拉取',
      trigger: { mode: 'keyword', value: '导出' },
      status: 'active',
      provenance: { requirementId: RID, sessionId: 'sess-origin', at: expect.any(String) },
    })
    expectIso(result.knowledgeRow.provenance.at)
  })

  it('scope=requirement：requirementId=body.requirementId 落 scope 键（provenance.requirementId 同源）', () => {
    const base = baseRecord({ knowledgeCandidates: [candidate()] })
    const { knowledgeRow } = activateOk(base, CAND_ID, { scope: 'requirement', type: 'business', trigger: { mode: 'always' } })
    expect(knowledgeRow.scope).toBe('requirement')
    expect(knowledgeRow.requirementId).toBe(RID)
    expect(knowledgeRow.provenance.requirementId).toBe(RID)
  })

  it('scope=workspace：path trim 后落位', () => {
    const base = baseRecord({ knowledgeCandidates: [candidate()] })
    const { knowledgeRow } = activateOk(base, CAND_ID, { scope: 'workspace', type: 'business', trigger: { mode: 'always' }, path: '  C:/repos/main  ' })
    expect(knowledgeRow.path).toBe('C:/repos/main')
  })

  it('always / manual：value 剥离（脏参数不入 knowledge.yaml 的 trigger）', () => {
    const base = baseRecord({ knowledgeCandidates: [candidate()] })
    const always = activateOk(base, CAND_ID, { scope: 'global', type: 'business', trigger: { mode: 'always', value: 'dirty' } })
    expect(always.knowledgeRow.trigger).toEqual({ mode: 'always' })
    const manual = activateOk(base, CAND_ID, { scope: 'global', type: 'business', trigger: { mode: 'manual' } })
    expect(manual.knowledgeRow.trigger).toEqual({ mode: 'manual' })
  })

  it('候选无 proposedSessionId：provenance 不带 sessionId 键', () => {
    const base = baseRecord({ knowledgeCandidates: [candidate({ proposedSessionId: undefined })] })
    const { knowledgeRow } = activateOk(base, CAND_ID, { scope: 'global', type: 'business', trigger: { mode: 'always' } })
    expect(knowledgeRow.provenance).toEqual({ requirementId: RID, at: expect.any(String) })
    expect('sessionId' in knowledgeRow.provenance).toBe(false)
  })

  it('已 promoted ⇒ {record: base, knowledgeRow, unchanged: true}（行仍随行——端点靠它补写缺失的 knowledge.yaml 条目）', () => {
    const base = baseRecord({ knowledgeCandidates: [candidate({ status: 'promoted' })] })
    const result = applyRecordAction(base, activate(CAND_ID, { scope: 'global', type: 'business', trigger: { mode: 'always' } }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.unchanged).toBe(true)
    expect(result.record).toBe(base) // 候选面零改动
    expect(result.knowledgeRow?.id).toBe(CAND_ID)
    expect(result.knowledgeRow?.status).toBe('active')
  })

  it('不吃 split 门：已批准契约（splitLocked）下照常推进（S6 复盘横跨全生命周期）', () => {
    const locked = baseRecord({ splitApprovedAt: NOW, knowledgeCandidates: [candidate()] })
    const result = activateOk(locked, CAND_ID, { scope: 'global', type: 'business', trigger: { mode: 'always' } })
    expect(result.record.knowledgeCandidates[0]?.status).toBe('promoted')
  })

  it('dismissed → 400 bad-request；未知 id → 404', () => {
    const dismissed = baseRecord({ knowledgeCandidates: [candidate({ status: 'dismissed' })] })
    expect(applyRecordAction(dismissed, activate(CAND_ID, { scope: 'global', type: 'business', trigger: { mode: 'always' } })))
      .toEqual({ ok: false, status: 400, code: 'bad-request' })
    const ghost = baseRecord({ knowledgeCandidates: [candidate()] })
    expect(applyRecordAction(ghost, activate(GHOST_CAND, { scope: 'global', type: 'business', trigger: { mode: 'always' } })))
      .toEqual({ ok: false, status: 404, code: 'not-found' })
  })

  it('参数守卫：workspace 缺 path（undefined / 空白串）→ 400 bad-request', () => {
    const base = baseRecord({ knowledgeCandidates: [candidate()] })
    expect(applyRecordAction(base, activate(CAND_ID, { scope: 'workspace', type: 'business', trigger: { mode: 'always' } })))
      .toEqual({ ok: false, status: 400, code: 'bad-request' })
    expect(applyRecordAction(base, activate(CAND_ID, { scope: 'workspace', type: 'business', trigger: { mode: 'always' }, path: '   ' })))
      .toEqual({ ok: false, status: 400, code: 'bad-request' })
  })

  it('参数守卫：keyword 缺 value（undefined / 空白串）→ 400 bad-request', () => {
    const base = baseRecord({ knowledgeCandidates: [candidate()] })
    expect(applyRecordAction(base, activate(CAND_ID, { scope: 'global', type: 'business', trigger: { mode: 'keyword' } })))
      .toEqual({ ok: false, status: 400, code: 'bad-request' })
    expect(applyRecordAction(base, activate(CAND_ID, { scope: 'global', type: 'business', trigger: { mode: 'keyword', value: '  ' } })))
      .toEqual({ ok: false, status: 400, code: 'bad-request' })
  })
})

// ---------------------------------------------------------------------------
// P3a: release items（S5 上线清单）——门外 + 严格链 + pending-only 改删
// ---------------------------------------------------------------------------

function releaseItem(overrides: Partial<ReleaseItem> = {}): ReleaseItem {
  return {
    id: 'R0001',
    type: 'sql',
    title: 't_order 加索引',
    content: 'ALTER TABLE t_order ADD INDEX idx_created_at (created_at)',
    contentHash: contentHashOf('ALTER TABLE t_order ADD INDEX idx_created_at (created_at)'),
    envs: ['prod'],
    status: 'pending',
    ...overrides,
  }
}

const saveRelease = (item: SaveReleaseItemRequest['releaseItem'], rid = RID) =>
  ({ ...mutate(rid), action: 'saveReleaseItem' as const, releaseItem: item })
const releaseAction = (action: 'removeReleaseItem' | 'confirmReleaseItem' | 'markReleaseItemApplied' | 'markReleaseItemVerified' | 'rollbackReleaseItem', id: string, rid = RID) =>
  ({ ...mutate(rid), action, id } as WorkbenchMutateRequestBody)

describe('release items (P3a)', () => {
  describe('saveReleaseItem', () => {
    it('创建：host 铸四位补零 R 序号 + contentHash + pending 态；序号不回收', () => {
      const empty = applyOk(baseRecord(), saveRelease({ type: 'sql', title: '建表', content: 'CREATE TABLE x', envs: ['prod'] }))
      expect(empty.releaseItems).toHaveLength(1)
      expect(empty.releaseItems[0]?.id).toBe('R0001')
      expect(empty.releaseItems[0]?.status).toBe('pending')
      expect(empty.releaseItems[0]?.contentHash).toBe(contentHashOf('CREATE TABLE x'))

      const grown = applyOk(empty, saveRelease({ type: 'config', title: '并发调参', content: 'max=8', envs: [] }))
      expect(grown.releaseItems[1]?.id).toBe('R0002')

      // 四位边界：R0012 之后是 R0013（不是 R13——毒化事故的回归钉）
      const ledger12 = baseRecord({ releaseItems: [releaseItem({ id: 'R0012' })] })
      const next = applyOk(ledger12, saveRelease({ type: 'flag', title: '开关', content: 'enabled=false', envs: ['prod'] }))
      expect(next.releaseItems[1]?.id).toBe('R0013')
    })

    it('创建携带可选字段：workPackageId / sessionId / note', () => {
      const record = applyOk(baseRecord({ workPackages: [wp('WP1')] }), saveRelease({
        type: 'sql', title: '加列', content: 'ALTER TABLE a ADD b INT', envs: ['prod', 'pre'],
        workPackageId: 'WP1', sessionId: 'sess-9', note: '随 v1.2 上线',
      }))
      const item = record.releaseItems[0]
      expect(item?.workPackageId).toBe('WP1')
      expect(item?.sessionId).toBe('sess-9')
      expect(item?.note).toBe('随 v1.2 上线')
      expect(item?.envs).toEqual(['prod', 'pre'])
    })

    it('编辑：仅 pending 可改；用户字段全量替换、sessionId 承载、contentHash 随 content 重算', () => {
      const target = releaseItem({ sessionId: 'sess-origin', note: '旧备注' })
      const edited = applyOk(baseRecord({ releaseItems: [target] }), saveRelease({
        id: 'R0001', type: 'mq', title: '队列扩容', content: 'concurrency=8', envs: ['prod'], note: '新备注',
      }))
      const next = edited.releaseItems[0]
      expect(next?.type).toBe('mq')
      expect(next?.title).toBe('队列扩容')
      expect(next?.contentHash).toBe(contentHashOf('concurrency=8'))
      expect(next?.note).toBe('新备注')
      expect(next?.workPackageId).toBeUndefined() // 全量替换：清掉归属真能清掉
      expect(next?.sessionId).toBe('sess-origin') // 声明通道溯源字段承载
      expect(next?.status).toBe('pending')

      const locked = baseRecord({ releaseItems: [releaseItem({ status: 'confirmed' })] })
      expect(applyRecordAction(locked, saveRelease({ id: 'R0001', type: 'sql', title: '改不动', content: 'x', envs: [] })))
        .toEqual({ ok: false, status: 400, code: 'bad-request' })
    })

    it('编辑幂等：字段未变 → unchanged 且引用即 base（revision 不空转）', () => {
      const base = baseRecord({ releaseItems: [releaseItem()] })
      const result = applyRecordAction(base, saveRelease({ id: 'R0001', type: 'sql', title: 't_order 加索引', content: 'ALTER TABLE t_order ADD INDEX idx_created_at (created_at)', envs: ['prod'] }))
      expect(result).toEqual({ ok: true, record: base, unchanged: true })
      if (!result.ok) return
      expect(result.record).toBe(base)
    })

    it('未知 id 编辑 → 404', () => {
      expect(applyRecordAction(baseRecord(), saveRelease({ id: 'R0099', type: 'sql', title: 'x', content: 'x', envs: [] })))
        .toEqual({ ok: false, status: 404, code: 'not-found' })
    })

    it('不吃 split 门：批准前后都能登记（阶段可跳过 + R5 手动最短路径）', () => {
      const unapproved = applyOk(baseRecord(), saveRelease({ type: 'other', title: '无门登记', content: 'x', envs: [] }))
      expect(unapproved.releaseItems).toHaveLength(1)
      const locked = baseRecord({ splitApprovedAt: NOW })
      const also = applyOk(locked, saveRelease({ type: 'other', title: '门内也行', content: 'x', envs: [] }))
      expect(also.releaseItems).toHaveLength(1)
    })
  })

  describe('removeReleaseItem', () => {
    it('仅 pending 可删；confirmed 及之后 → 400（修正走 rolled-back 保审计）', () => {
      const removed = applyOk(baseRecord({ releaseItems: [releaseItem()] }), releaseAction('removeReleaseItem', 'R0001'))
      expect(removed.releaseItems).toHaveLength(0)
      for (const status of ['confirmed', 'applied', 'verified', 'rolled-back'] as const) {
        const base = baseRecord({ releaseItems: [releaseItem({ status })] })
        expect(applyRecordAction(base, releaseAction('removeReleaseItem', 'R0001')))
          .toEqual({ ok: false, status: 400, code: 'bad-request' })
      }
    })

    it('未知 id → 404', () => {
      expect(applyRecordAction(baseRecord(), releaseAction('removeReleaseItem', 'R0099')))
        .toEqual({ ok: false, status: 404, code: 'not-found' })
    })
  })

  describe('状态流：严格链 pending→confirmed→applied→verified；任一活态→rolled-back（终态）', () => {
    it('confirm：pending→confirmed；已 confirmed 幂等 unchanged；跳链（applied）→ 400', () => {
      const confirmed = applyOk(baseRecord({ releaseItems: [releaseItem()] }), releaseAction('confirmReleaseItem', 'R0001'))
      expect(confirmed.releaseItems[0]?.status).toBe('confirmed')

      const again = applyRecordAction(confirmed, releaseAction('confirmReleaseItem', 'R0001'))
      expect(again).toEqual({ ok: true, record: confirmed, unchanged: true })

      const skip = baseRecord({ releaseItems: [releaseItem({ status: 'applied' })] })
      expect(applyRecordAction(skip, releaseAction('confirmReleaseItem', 'R0001')))
        .toEqual({ ok: false, status: 400, code: 'bad-request' })
    })

    it('markApplied：confirmed→applied 且铸 appliedAt；pending 直接 applied → 400（严格链）', () => {
      const applied = applyOk(baseRecord({ releaseItems: [releaseItem({ status: 'confirmed' })] }), releaseAction('markReleaseItemApplied', 'R0001'))
      expect(applied.releaseItems[0]?.status).toBe('applied')
      expectIso(applied.releaseItems[0]?.appliedAt)

      const skip = baseRecord({ releaseItems: [releaseItem({ status: 'pending' })] })
      expect(applyRecordAction(skip, releaseAction('markReleaseItemApplied', 'R0001')))
        .toEqual({ ok: false, status: 400, code: 'bad-request' })
    })

    it('markVerified：applied→verified；pending/confirmed 直接 verified → 400', () => {
      const verified = applyOk(baseRecord({ releaseItems: [releaseItem({ status: 'applied', appliedAt: NOW })] }), releaseAction('markReleaseItemVerified', 'R0001'))
      expect(verified.releaseItems[0]?.status).toBe('verified')

      for (const status of ['pending', 'confirmed'] as const) {
        const base = baseRecord({ releaseItems: [releaseItem({ status })] })
        expect(applyRecordAction(base, releaseAction('markReleaseItemVerified', 'R0001')))
          .toEqual({ ok: false, status: 400, code: 'bad-request' })
      }
    })

    it('rollback：四个活态都能滚；已 rolled-back 幂等 unchanged', () => {
      for (const status of ['pending', 'confirmed', 'applied', 'verified'] as const) {
        const rolled = applyOk(baseRecord({ releaseItems: [releaseItem({ status })] }), releaseAction('rollbackReleaseItem', 'R0001'))
        expect(rolled.releaseItems[0]?.status).toBe('rolled-back')
      }
      const terminal = baseRecord({ releaseItems: [releaseItem({ status: 'rolled-back' })] })
      expect(applyRecordAction(terminal, releaseAction('rollbackReleaseItem', 'R0001')))
        .toEqual({ ok: true, record: terminal, unchanged: true })
    })

    it('rolled-back 是终态：confirm / applied / verified 全 → 400；未知 id → 404', () => {
      const dead = baseRecord({ releaseItems: [releaseItem({ status: 'rolled-back' })] })
      for (const action of ['confirmReleaseItem', 'markReleaseItemApplied', 'markReleaseItemVerified'] as const) {
        expect(applyRecordAction(dead, releaseAction(action, 'R0001')))
          .toEqual({ ok: false, status: 400, code: 'bad-request' })
      }
      expect(applyRecordAction(baseRecord(), releaseAction('confirmReleaseItem', 'R0099')))
        .toEqual({ ok: false, status: 404, code: 'not-found' })
    })
  })

  describe('rollbackPlan 戳（go/no-go 第三条件，需求级单戳）', () => {
    const confirmPlan = { ...mutate(), action: 'confirmRollbackPlan' as const }
    const revokePlan = { ...mutate(), action: 'revokeRollbackPlan' as const }

    it('confirm 铸戳 / revoke 摘戳保其余字段', () => {
      const stamped = applyOk(baseRecord(), confirmPlan)
      expectIso(stamped.rollbackPlanConfirmedAt)
      const unstamped = applyOk(stamped, revokePlan)
      expect(unstamped.rollbackPlanConfirmedAt).toBeUndefined()
      expect(unstamped.requirementId).toBe(RID)
    })

    it('重复 confirm / 未确认先 revoke → 400（对齐 approveSplit 的「重复是客户端 bug」）', () => {
      expect(applyRecordAction(baseRecord(), revokePlan)).toEqual({ ok: false, status: 400, code: 'bad-request' })
      const stamped = applyOk(baseRecord(), confirmPlan)
      expect(applyRecordAction(stamped, confirmPlan)).toEqual({ ok: false, status: 400, code: 'bad-request' })
    })

    it('不吃 split 门', () => {
      const locked = baseRecord({ splitApprovedAt: NOW })
      expect(applyOk(locked, confirmPlan).rollbackPlanConfirmedAt).toBeDefined()
    })
  })

  it('wire guard：R1（无补零）整条 releaseItem 被拒——毒化事故回归钉', () => {
    expect(isReleaseItemId('R0001')).toBe(true)
    expect(isReleaseItemId('R1')).toBe(false)
    expect(isReleaseItemId('R001')).toBe(false)
    expect(isReleaseItemId('R12345')).toBe(true)
    const withR1 = baseRecord({ releaseItems: [releaseItem({ id: 'R1' })] })
    expect(isWorkbenchRecord(withR1)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// P4: review verdicts + manual candidate distillation（门外 + rejected-note）
// ---------------------------------------------------------------------------

function reviewReport(id: string, overrides: Partial<ReviewReportEntry> = {}): ReviewReportEntry {
  return { id, at: NOW, verdicts: [], ...overrides }
}
const verdictRow = (id: string, overrides: Partial<ReviewVerdict> = {}): ReviewVerdict =>
  ({ id, title: '导入与校验不在同一事务', severity: 'high', verdict: 'confirmed', ...overrides })

describe('review verdicts (P4)', () => {
  const saveVerdict = (verdict: SaveReviewVerdictRequest['verdict'], reportId = 'rev-a1') =>
    ({ ...mutate(), action: 'saveReviewVerdict' as const, reportId, verdict })

  it('添加：host 铸 uuid；编辑：id 全量替换；均落 reportId 定位的报告', () => {
    const base = baseRecord({ reviewReports: [reviewReport('rev-a1')] })
    const added = applyOk(base, saveVerdict({ title: '空指针', severity: 'medium', verdict: 'confirmed', disposition: 'to-fix' }))
    const row = added.reviewReports[0]?.verdicts[0]
    expect(row?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(row?.title).toBe('空指针')

    const edited = applyOk(added, saveVerdict({ id: row!.id, title: '空指针（改述）', severity: 'medium', verdict: 'confirmed', disposition: 'fixed' }))
    expect(edited.reviewReports[0]?.verdicts).toHaveLength(1)
    expect(edited.reviewReports[0]?.verdicts[0]).toEqual({ id: row!.id, title: '空指针（改述）', severity: 'medium', verdict: 'confirmed', disposition: 'fixed' })
  })

  it('rejected 必填 note（空白也拒）；rejected 带 disposition → 400（驳回即裁决完成）', () => {
    const base = baseRecord({ reviewReports: [reviewReport('rev-a1')] })
    expect(applyRecordAction(base, saveVerdict({ title: 'x', severity: 'low', verdict: 'rejected' })))
      .toEqual({ ok: false, status: 400, code: 'bad-request' })
    expect(applyRecordAction(base, saveVerdict({ title: 'x', severity: 'low', verdict: 'rejected', note: '   ' })))
      .toEqual({ ok: false, status: 400, code: 'bad-request' })
    expect(applyRecordAction(base, saveVerdict({ title: 'x', severity: 'low', verdict: 'rejected', note: '路径不可达', disposition: 'fixed' })))
      .toEqual({ ok: false, status: 400, code: 'bad-request' })
    const ok = applyOk(base, saveVerdict({ title: 'x', severity: 'low', verdict: 'rejected', note: '路径不可达' }))
    expect(ok.reviewReports[0]?.verdicts[0]).toEqual({ id: expect.any(String), title: 'x', severity: 'low', verdict: 'rejected', note: '路径不可达' })
  })

  it('404 阶梯：报告不存在 / 编辑行不存在 / 删除行不存在', () => {
    const base = baseRecord({ reviewReports: [reviewReport('rev-a1', { verdicts: [verdictRow('v1')] })] })
    expect(applyRecordAction(base, saveVerdict({ title: 'x', severity: 'low', verdict: 'confirmed' }, 'rev-ghost')))
      .toEqual({ ok: false, status: 404, code: 'not-found' })
    expect(applyRecordAction(base, saveVerdict({ id: 'v-ghost', title: 'x', severity: 'low', verdict: 'confirmed' })))
      .toEqual({ ok: false, status: 404, code: 'not-found' })
    expect(applyRecordAction(base, { ...mutate(), action: 'removeReviewVerdict', reportId: 'rev-a1', id: 'v-ghost' }))
      .toEqual({ ok: false, status: 404, code: 'not-found' })
  })

  it('removeReviewVerdict / removeReviewReport 落盘面；门外（splitLocked 下照常）', () => {
    const locked = baseRecord({ splitApprovedAt: NOW, reviewReports: [reviewReport('rev-a1', { verdicts: [verdictRow('v1')] })] })
    const removed = applyOk(locked, { ...mutate(), action: 'removeReviewVerdict', reportId: 'rev-a1', id: 'v1' })
    expect(removed.reviewReports[0]?.verdicts).toHaveLength(0)
    const noReport = applyOk(removed, { ...mutate(), action: 'removeReviewReport', id: 'rev-a1' })
    expect(noReport.reviewReports).toHaveLength(0)
  })
})

describe('saveKnowledgeCandidate (P4 手动提炼)', () => {
  it('创建 pending 候选（uuid + at host 铸）；门外', () => {
    const locked = baseRecord({ splitApprovedAt: NOW })
    const created = applyOk(locked, { ...mutate(), action: 'saveKnowledgeCandidate', candidate: { title: '导出走异步', draft: '禁止全量拉取', type: 'convention' } })
    const row = created.knowledgeCandidates[0]
    expect(row?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expectIso(row?.at)
    expect(row?.status).toBe('pending')
    expect(row?.title).toBe('导出走异步')
  })
})
