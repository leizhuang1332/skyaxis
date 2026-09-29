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
import { applyRecordAction } from '../../src/workbench-host/record-actions.js'
import { isWorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import type {
  ErrorResponse,
  WorkbenchCriterion,
  WorkbenchFinding,
  WorkbenchMutateRequestBody,
  WorkbenchRecord,
  WorkbenchWorkPackage,
} from '../../src/workbench-shared/protocol.js'

const RID = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-09-29T09:30:00.000Z'
const FINDING_ID = '44444444-4444-4444-8444-444444444444'

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
