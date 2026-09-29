/**
 * Full endpoint matrix for the workbench route family (0006 P1b), dispatched
 * through the real HostConnectionService with createSharedFetchHandler('/api')
 * over a temp-dir WorkbenchFileStore (the requirements-endpoint harness
 * precedent). Coverage:
 *   - GET /api/skyaxis/workbench: pristine/seeded list + the degraded envelope
 *   - GET ?requirementId=: empty first-use state (GET never creates), the
 *     lowercase-uuid 400 gate, 409 over a corrupt ledger, flat fileExists rows
 *   - POST action union: implicit ledger creation, advanceStage (incl.
 *     terminal 'closed'), saveFinding create/edit field-merge semantics,
 *     removeFinding, 409 stale revisions, zod 400s, the 32K inline cap
 *   - POST artifacts: text/plain + query discrimination, the plan version
 *     lifecycle (approved v1 → v2 opens, tail-draft overwrite stays on the
 *     same version, byte-identical idempotent convergence incl. dangling-file
 *     repair), the 415/400/404/409/413 ladder, and the fully-approved work package
 *     opening max+1 (the locked-version 400 fuse is unreachable by
 *     construction through the API — noted inline at that test)
 *   - review writes: a fresh uuid per write, ledger contentHash, title optional
 *   - GET artifacts: content + contentTampered flip, 404/400 faces, the 1MiB
 *     read cap, review mirror
 *   - GET scan: orphans / missing / trash three-face reconciliation, .trash
 *     skip, absent-root emptiness
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  ErrorResponse,
  PlanEntry,
  ReviewReportEntry,
  WorkbenchDetailResponseOk,
  WorkbenchWorkPackage,
  WorkbenchRecord,
  WorkbenchScanResponseOk,
} from '../../src/workbench-shared/protocol.js'
import {
  WORKBENCH_ARTIFACT_MAX_CHARS,
  WORKBENCH_ARTIFACT_MAX_READ_BYTES,
  WORKBENCH_ARTIFACTS_PATH,
  WORKBENCH_INLINE_MAX_CHARS,
  WORKBENCH_PATH,
  WORKBENCH_SCAN_PATH,
} from '../../src/workbench-shared/protocol.js'
import { planDocPath, reviewDocPath } from '../../src/workbench-host/artifact-path.js'
import { contentHashOf } from '../../src/workbench-host/artifact-store.js'
import { WorkbenchFileStore } from '../../src/workbench-host/workbench-file.js'
import { registerWorkbenchEndpoints } from '../../src/workbench-host/endpoint.js'

const dirs: string[] = []
const disposables: Array<() => unknown> = []
afterEach(async () => {
  while (disposables.length) await disposables.pop()!()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const BASE = 'http://127.0.0.1'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const RID = '11111111-1111-4111-8111-111111111111'
const RID2 = '22222222-2222-4222-8222-222222222222'
const RID3 = '33333333-3333-4333-8333-333333333333'
const GHOST = '00000000-0000-4000-8000-000000000000'
// Letter-bearing so that toUpperCase() actually changes it (a digit-only uuid uppercases to itself).
const RID_UPPER = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'
const FINDING_ID = '44444444-4444-4444-8444-444444444444'
const NOW = '2026-09-29T09:30:00.000Z'

async function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-endpoint-test-'))
  dirs.push(dir)
  const file = new WorkbenchFileStore(join(dir, 'workbench.yaml'))
  const workbenchRoot = join(dir, 'workbench')
  const ctx = new Context()
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], {} as never)
  })
  await fiber.await()
  const connection = ctx.get('connection') as HostConnectionHandle
  registerWorkbenchEndpoints(connection, { file, workbenchRoot })
  const shared = connection.createSharedFetchHandler('/api')
  disposables.push(() => fiber.dispose())
  const get = (path: string) => shared.fetch(new Request(BASE + path))
  const post = (path: string, body: unknown) =>
    shared.fetch(new Request(BASE + path, { method: 'POST', body: JSON.stringify(body) }))
  const postText = (path: string, text: string, contentType = 'text/plain') =>
    shared.fetch(new Request(BASE + path, { method: 'POST', body: text, headers: { 'content-type': contentType } }))
  const seed = async (records: readonly WorkbenchRecord[], expectedRevision = 0) => {
    const saved = await file.save(expectedRevision, [...records])
    if (!saved.ok) throw new Error(`seed failed: ${JSON.stringify(saved)}`)
    return saved.revision
  }
  return { file, dir, workbenchRoot, get, post, postText, seed }
}

type Harness = Awaited<ReturnType<typeof harness>>

function seedRecord(requirementId: string, overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId,
    stage: 'understand',
    stageHistory: [{ stage: 'understand', at: NOW }],
    criteria: [],
    findings: [],
    workPackages: [],
    releaseItems: [],
    reviewReports: [],
    knowledgeCandidates: [],
    ...overrides,
  }
}

function seedWorkPackage(id: string, overrides: Partial<WorkbenchWorkPackage> = {}): WorkbenchWorkPackage {
  return {
    id,
    title: `工作包 ${id}`,
    boundary: '',
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

function planEntry(version: number, contentHash: string, extra: Partial<PlanEntry> = {}): PlanEntry {
  return { version, contentHash, ...extra }
}

function reviewEntry(id: string, extra: Partial<ReviewReportEntry> = {}): ReviewReportEntry {
  return { id, at: NOW, verdicts: [], ...extra }
}

const qs = (params: Record<string, string | number>) =>
  new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()

const artifactsPost = (h: Harness, query: Record<string, string>, text: string, contentType?: string) =>
  h.postText(`${WORKBENCH_ARTIFACTS_PATH}?${new URLSearchParams(query)}`, text, contentType)

const postPlan = (
  h: Harness,
  p: { requirementId: string; workPackageId: string; expectedRevision: number | string; note?: string },
  text: string,
  contentType?: string,
) =>
  artifactsPost(
    h,
    {
      kind: 'plan',
      requirementId: p.requirementId,
      workPackageId: p.workPackageId,
      expectedRevision: String(p.expectedRevision),
      ...(p.note !== undefined ? { note: p.note } : {}),
    },
    text,
    contentType,
  )

const postReview = (
  h: Harness,
  p: { requirementId: string; expectedRevision: number | string; title?: string },
  text: string,
  contentType?: string,
) =>
  artifactsPost(
    h,
    {
      kind: 'review',
      requirementId: p.requirementId,
      expectedRevision: String(p.expectedRevision),
      ...(p.title !== undefined ? { title: p.title } : {}),
    },
    text,
    contentType,
  )

const errorCode = async (res: Response) => ((await res.json()) as ErrorResponse).code

// ---------------------------------------------------------------------------
// GET /api/skyaxis/workbench — list
// ---------------------------------------------------------------------------

describe('GET /api/skyaxis/workbench — list', () => {
  it('lists the pristine store as revision 0 with no records', async () => {
    const h = await harness()
    const res = await h.get(WORKBENCH_PATH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, revision: 0, records: [] })
  })

  it('lists seeded records under the current revision', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID), seedRecord(RID2)])
    const body = (await (await h.get(WORKBENCH_PATH)).json()) as { ok: true; revision: number; records: WorkbenchRecord[] }
    expect(body.ok).toBe(true)
    expect(body.revision).toBe(1)
    expect(body.records.map((record) => record.requirementId)).toEqual([RID, RID2])
  })

  it('degrades to {ok:false, degraded:true} with backup availability over a corrupt ledger (a 200 body, not an error status)', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)])
    await h.seed([seedRecord(RID), seedRecord(RID2)], 1) // second save so a .bak exists
    writeFileSync(h.file.filePath, 'broken: [', 'utf8')

    const res = await h.get(WORKBENCH_PATH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, degraded: true, reason: 'parse', hasBackup: true })
  })
})

// ---------------------------------------------------------------------------
// GET /api/skyaxis/workbench?requirementId= — detail
// ---------------------------------------------------------------------------

describe('GET /api/skyaxis/workbench?requirementId — detail', () => {
  it('answers the first-use empty state and never creates the record', async () => {
    const h = await harness()
    const res = await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, revision: 0, record: null, planFileExists: [], reviewFileExists: [] })
    // GET never creates: the ledger is still pristine after the read.
    expect(h.file.load()).toEqual({ ok: true, value: { version: 1, revision: 0, records: [] } })
  })

  it('rejects malformed requirement ids with 400 (lowercase uuid only)', async () => {
    const h = await harness()
    for (const id of ['not-a-uuid', RID_UPPER, '11111111-1111-4111-8111-11111111111g']) {
      const res = await h.get(`${WORKBENCH_PATH}?requirementId=${id}`)
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('bad-request')
    }
  })

  it('answers 409 unreadable-file over a corrupt ledger', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)])
    writeFileSync(h.file.filePath, 'broken: [', 'utf8')

    const res = await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('unreadable-file')
  })

  it('projects flat fileExists rows as false for ledger references whose files never landed', async () => {
    const h = await harness()
    await h.seed([
      seedRecord(RID, {
        workPackages: [seedWorkPackage('WP1', { plans: [planEntry(1, contentHashOf('v1 body'), { approvedAt: NOW })] })],
        reviewReports: [reviewEntry('seeded-review')],
      }),
    ])

    const detail = (await (await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)).json()) as WorkbenchDetailResponseOk
    expect(detail.ok).toBe(true)
    expect(detail.planFileExists).toEqual([{ workPackageId: 'WP1', version: 1, exists: false }])
    expect(detail.reviewFileExists).toEqual([{ reviewId: 'seeded-review', exists: false }])
  })

  it('flips the rows to true once the documents exist on disk', async () => {
    const h = await harness()
    await h.seed([
      seedRecord(RID, {
        workPackages: [seedWorkPackage('WP1', { plans: [planEntry(1, contentHashOf('V1 BODY'))] })],
        reviewReports: [reviewEntry('r-seed')],
      }),
    ])
    // The byte-identical plan retry repairs the missing v1 file without a save…
    const write = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 1 }, 'V1 BODY')
    expect(write.status).toBe(200)
    // …and the review write mints its document normally (and appends its ledger row).
    const review = await postReview(h, { requirementId: RID, expectedRevision: 1 }, '评审正文')
    expect(review.status).toBe(200)
    const reviewBody = (await review.json()) as { ok: true; reviewId: string }

    const detail = (await (await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)).json()) as WorkbenchDetailResponseOk
    expect(detail.planFileExists).toEqual([{ workPackageId: 'WP1', version: 1, exists: true }])
    expect(detail.reviewFileExists).toEqual([
      { reviewId: 'r-seed', exists: false }, // seeded reference, never written
      { reviewId: reviewBody.reviewId, exists: true }, // minted by the write above
    ])
  })
})

// ---------------------------------------------------------------------------
// POST /api/skyaxis/workbench — action union
// ---------------------------------------------------------------------------

describe('POST /api/skyaxis/workbench — action union', () => {
  it('implicitly creates the record on the first advanceStage (stageHistory grows to 2) and bumps the revision', async () => {
    const h = await harness()
    const res = await h.post(WORKBENCH_PATH, {
      expectedRevision: 0,
      requirementId: RID,
      action: 'advanceStage',
      stage: 'plan',
      note: '开工',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; record: WorkbenchRecord }
    expect(body.revision).toBe(1)
    expect(body.record.stage).toBe('plan')
    expect(body.record.stageHistory).toHaveLength(2)
    expect(body.record.stageHistory[0]).toMatchObject({ stage: 'understand' })
    expect(body.record.stageHistory[1]).toMatchObject({ stage: 'plan', note: '开工' })

    // A different requirement stays untouched — the implicit create is per-record.
    const untouched = (await (await h.get(`${WORKBENCH_PATH}?requirementId=${RID2}`)).json()) as WorkbenchDetailResponseOk
    expect(untouched.record).toBeNull()
  })

  it('accepts advanceStage to the terminal closed stage (note omitted stays absent)', async () => {
    const h = await harness()
    const res = await h.post(WORKBENCH_PATH, {
      expectedRevision: 0,
      requirementId: RID,
      action: 'advanceStage',
      stage: 'closed',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { record: WorkbenchRecord }
    expect(body.record.stage).toBe('closed')
    expect(body.record.stageHistory[1]).toEqual({ stage: 'closed', at: expect.any(String) })
  })

  it('saveFinding without an id creates one (uuid id, host-stamped createdAt), implicitly creating the record', async () => {
    const h = await harness()
    const res = await h.post(WORKBENCH_PATH, {
      expectedRevision: 0,
      requirementId: RID,
      action: 'saveFinding',
      finding: { category: 'risk', severity: 'high', title: '并发保存冲突', detail: '两个窗口同时保存', status: 'open' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; record: WorkbenchRecord }
    expect(body.revision).toBe(1)
    expect(body.record.findings).toHaveLength(1)
    const finding = body.record.findings[0]
    expect(finding.id).toMatch(UUID_RE)
    expect(typeof finding.createdAt).toBe('string')
    expect(finding.title).toBe('并发保存冲突')
    expect(finding.status).toBe('open')
  })

  it('saveFinding with an id overwrites present fields and carries absent ones (resolution survives)', async () => {
    const h = await harness()
    await h.seed([
      seedRecord(RID, {
        findings: [
          {
            id: FINDING_ID,
            category: 'risk',
            severity: 'high',
            title: '原标题',
            detail: '原细节',
            status: 'open',
            resolution: '旧处理意见',
            sessionId: 'session-1',
            createdAt: NOW,
          },
        ],
      }),
    ])

    const res = await h.post(WORKBENCH_PATH, {
      expectedRevision: 1,
      requirementId: RID,
      action: 'saveFinding',
      finding: { id: FINDING_ID, category: 'conflict', severity: 'low', title: '新标题', detail: '新细节', status: 'resolved' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { record: WorkbenchRecord }
    expect(body.record.findings[0]).toEqual({
      id: FINDING_ID,
      category: 'conflict',
      severity: 'low',
      title: '新标题',
      detail: '新细节',
      status: 'resolved',
      resolution: '旧处理意见', // absent in the request — carried over
      sessionId: 'session-1',
      createdAt: NOW, // host-owned, never overwritten
    })
  })

  it('saveFinding with an unknown id answers 404', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)])
    const res = await h.post(WORKBENCH_PATH, {
      expectedRevision: 1,
      requirementId: RID,
      action: 'saveFinding',
      finding: { id: GHOST, category: 'other', severity: 'low', title: 'x', detail: '', status: 'open' },
    })
    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('not-found')
  })

  it('removeFinding deletes by id and answers 404 for unknown ids', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { findings: [{ id: FINDING_ID, category: 'risk', severity: 'high', title: 't', detail: 'd', status: 'open', createdAt: NOW }] })])

    const ghost = await h.post(WORKBENCH_PATH, { expectedRevision: 1, requirementId: RID, action: 'removeFinding', id: GHOST })
    expect(ghost.status).toBe(404)

    const removed = await h.post(WORKBENCH_PATH, { expectedRevision: 1, requirementId: RID, action: 'removeFinding', id: FINDING_ID })
    expect(removed.status).toBe(200)
    const body = (await removed.json()) as { ok: true; revision: number; record: WorkbenchRecord }
    expect(body.revision).toBe(2)
    expect(body.record.findings).toEqual([])
  })

  it('rejects stale revisions with 409 conflict + currentRevision before any business logic', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { findings: [{ id: FINDING_ID, category: 'risk', severity: 'high', title: 't', detail: 'd', status: 'open', createdAt: NOW }] })])

    const staleStage = await h.post(WORKBENCH_PATH, { expectedRevision: 0, requirementId: RID, action: 'advanceStage', stage: 'plan' })
    expect(staleStage.status).toBe(409)
    const stageBody = (await staleStage.json()) as ErrorResponse
    expect(stageBody.code).toBe('conflict')
    expect(stageBody.currentRevision).toBe(1)

    const staleRemove = await h.post(WORKBENCH_PATH, { expectedRevision: 0, requirementId: RID, action: 'removeFinding', id: FINDING_ID })
    expect(staleRemove.status).toBe(409)
    expect(((await staleRemove.json()) as ErrorResponse).currentRevision).toBe(1)
  })

  it('answers 400 bad-request for schema-violating bodies (unknown stage, unknown action, malformed JSON)', async () => {
    const h = await harness()
    const bogusStage = await h.post(WORKBENCH_PATH, { expectedRevision: 0, requirementId: RID, action: 'advanceStage', stage: 'bogus' })
    expect(bogusStage.status).toBe(400)
    expect(await errorCode(bogusStage)).toBe('bad-request')

    const unknownAction = await h.post(WORKBENCH_PATH, { expectedRevision: 0, requirementId: RID, action: 'teleport' })
    expect(unknownAction.status).toBe(400)

    const malformed = await h.postText(WORKBENCH_PATH, '{broken json', 'application/json')
    expect(malformed.status).toBe(400)
  })

  it('rejects a non-lowercase requirementId on the action union (no ghost-record minting)', async () => {
    // z.uuid() tolerates uppercase; artifact paths and the detail route are
    // lowercase-only — the mutate path must not mint what the rest cannot address.
    const h = await harness()
    const res = await h.post(WORKBENCH_PATH, {
      expectedRevision: 0,
      requirementId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
      action: 'advanceStage',
      stage: 'plan',
    })
    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('bad-request')
    const listed = (await (await h.get(WORKBENCH_PATH)).json()) as { records: unknown[] }
    expect(listed.records).toHaveLength(0)
  })

  it('enforces the 32K code-unit inline cap on findings.detail (exactly at cap passes)', async () => {
    const h = await harness()
    const atCap = '好'.repeat(WORKBENCH_INLINE_MAX_CHARS)
    const create = await h.post(WORKBENCH_PATH, {
      expectedRevision: 0,
      requirementId: RID,
      action: 'saveFinding',
      finding: { category: 'other', severity: 'low', title: 'cap', detail: atCap, status: 'open' },
    })
    expect(create.status).toBe(200)

    const overCap = await h.post(WORKBENCH_PATH, {
      expectedRevision: 1,
      requirementId: RID,
      action: 'saveFinding',
      finding: { category: 'other', severity: 'low', title: 'cap2', detail: `${atCap}!`, status: 'open' },
    })
    expect(overCap.status).toBe(400)
    expect(await errorCode(overCap)).toBe('bad-request')

    // The rejected write left no residue.
    const detail = (await (await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)).json()) as WorkbenchDetailResponseOk
    expect(detail.record?.findings).toHaveLength(1)
  })

  it('refuses writes over a corrupt ledger with 409 unreadable-file', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)])
    writeFileSync(h.file.filePath, 'broken: [', 'utf8')

    const res = await h.post(WORKBENCH_PATH, { expectedRevision: 1, requirementId: RID, action: 'advanceStage', stage: 'plan' })
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('unreadable-file')
  })
})

// ---------------------------------------------------------------------------
// POST /api/skyaxis/workbench/artifacts — plan writes
// ---------------------------------------------------------------------------

describe('POST /api/skyaxis/workbench/artifacts — plan writes', () => {
  it('rejects non-text/plain bodies with 415 and malformed queries with 400', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { workPackages: [seedWorkPackage('WP1')] })])

    const wrongType = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 1 }, 'x', 'application/json')
    expect(wrongType.status).toBe(415)
    expect(await errorCode(wrongType)).toBe('bad-content-type')

    const bads: Array<Record<string, string>> = [
      { kind: 'plan', requirementId: RID, workPackageId: 'wp1', expectedRevision: '1' }, // lowercase work package id
      { kind: 'plan', requirementId: RID, workPackageId: 'WP0', expectedRevision: '1' }, // leading zero
      { kind: 'plan', requirementId: RID, workPackageId: 'WP01', expectedRevision: '1' },
      { kind: 'plan', requirementId: RID, expectedRevision: '1' }, // workPackageId missing
      { kind: 'plan', requirementId: 'nope', workPackageId: 'WP1', expectedRevision: '1' }, // not a uuid
      { kind: 'plan', requirementId: RID_UPPER, workPackageId: 'WP1', expectedRevision: '1' }, // uppercase uuid
      { kind: 'plan', requirementId: RID, workPackageId: 'WP1', expectedRevision: 'abc' },
      { kind: 'plan', requirementId: RID, workPackageId: 'WP1', expectedRevision: '-1' },
    ]
    for (const query of bads) {
      const res = await artifactsPost(h, query, 'x')
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('bad-request')
    }

    const bogusKind = await h.postText(`${WORKBENCH_ARTIFACTS_PATH}?${qs({ kind: 'bogus', requirementId: RID, expectedRevision: 1 })}`, 'x')
    expect(bogusKind.status).toBe(400)
  })

  it('rejects bodies over the 512K code-unit cap with 413 too-large', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { workPackages: [seedWorkPackage('WP1')] })])

    const res = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 1 }, '字'.repeat(WORKBENCH_ARTIFACT_MAX_CHARS + 1))
    expect(res.status).toBe(413)
    expect(await errorCode(res)).toBe('too-large')
  })

  it('answers 404 for a missing record and a missing work package, with zero file side effects', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { workPackages: [seedWorkPackage('WP1')] })])

    const ghostRecord = await postPlan(h, { requirementId: GHOST, workPackageId: 'WP1', expectedRevision: 1 }, 'x')
    expect(ghostRecord.status).toBe(404)
    expect(await errorCode(ghostRecord)).toBe('not-found')

    const ghostWorkPackage = await postPlan(h, { requirementId: RID, workPackageId: 'WP9', expectedRevision: 1 }, 'x')
    expect(ghostWorkPackage.status).toBe(404)

    expect(existsSync(join(h.workbenchRoot, GHOST))).toBe(false)
    expect(existsSync(join(h.workbenchRoot, RID, 'plans'))).toBe(false)
  })

  it('opens version 2 after an approved v1, then tail-draft-overwrites v2 in place (version unchanged, hash follows)', async () => {
    const h = await harness()
    await h.seed([
      seedRecord(RID, {
        workPackages: [seedWorkPackage('WP1', { status: 'plan-approved', plans: [planEntry(1, contentHashOf('v1 body'), { approvedAt: NOW })] })],
      }),
    ])

    const first = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 1 }, 'v2 draft a')
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ ok: true, revision: 2, kind: 'plan', workPackageId: 'WP1', version: 2 })

    const second = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 2, note: '改稿' }, 'v2 draft b')
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { ok: true; revision: number; version: number }
    expect(secondBody.revision).toBe(3)
    expect(secondBody.version).toBe(2) // tail draft: the SAME version is overwritten

    const read = await h.get(`${WORKBENCH_ARTIFACTS_PATH}?${qs({ kind: 'plan', requirementId: RID, workPackageId: 'WP1', version: 2 })}`)
    expect(await read.json()).toEqual({ ok: true, content: 'v2 draft b', contentTampered: false })

    const detail = (await (await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)).json()) as WorkbenchDetailResponseOk
    expect(detail.planFileExists).toEqual([
      { workPackageId: 'WP1', version: 1, exists: false }, // seeded reference, file never written
      { workPackageId: 'WP1', version: 2, exists: true },
    ])
    expect(detail.record?.workPackages[0]?.plans[1]?.note).toBe('改稿')
  })

  it('converges byte-identical retransmits without a save, repairing a deleted file at the same revision', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { workPackages: [seedWorkPackage('WP1', { plans: [planEntry(1, contentHashOf('SAME BODY'))] })] })])
    const target = planDocPath(h.workbenchRoot, RID, 'WP1', 1)

    const retry = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 1 }, 'SAME BODY')
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ ok: true, revision: 1, version: 1 }) // no save — revision unchanged
    expect(readFileSync(target, 'utf8')).toBe('SAME BODY') // dangling reference repaired

    rmSync(target)
    const again = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 1 }, 'SAME BODY')
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ ok: true, revision: 1 }) // still no save
    expect(readFileSync(target, 'utf8')).toBe('SAME BODY') // file restored
  })

  it('repairs a STALE on-disk file in the idempotent branch (post-save write failure left old bytes)', async () => {
    // The adversarial-review fix: convergence means disk == ledger, not "file
    // present". A draft-overwrite whose post-save write failed leaves the
    // previous bytes under the new ledger hash — identical retries must
    // rewrite, or the divergence survives forever behind 200-ok answers.
    const h = await harness()
    await h.seed([seedRecord(RID, { workPackages: [seedWorkPackage('WP1', { plans: [planEntry(1, contentHashOf('V2 BODY'))] })] })])
    const target = planDocPath(h.workbenchRoot, RID, 'WP1', 1)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, 'STALE OLD BYTES', 'utf8') // failed-write residue

    const retry = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 1 }, 'V2 BODY')
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ ok: true, revision: 1 }) // ledger untouched — disk converges to it
    expect(readFileSync(target, 'utf8')).toBe('V2 BODY') // stale bytes repaired
  })

  it('persists a note-only edit: byte-identical text with a changed note goes through the save, not the idempotent branch', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { workPackages: [seedWorkPackage('WP1', { plans: [planEntry(1, contentHashOf('SAME'), { note: '初稿' })] })] })])

    const res = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 1, note: '改注' }, 'SAME')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, revision: 2, version: 1 }) // a save DID run
    const detail = await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)
    const body = (await detail.json()) as { record: { workPackages: { plans: { note?: string }[] }[] } }
    expect(body.record.workPackages[0]?.plans[0]?.note).toBe('改注')
  })

  it('answers 409 conflict on a stale expectedRevision with zero file side effects', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { workPackages: [seedWorkPackage('WP1', { plans: [planEntry(1, contentHashOf('seeded v1'))] })] })])

    const res = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 0 }, 'brand new content')
    expect(res.status).toBe(409)
    const body = (await res.json()) as ErrorResponse
    expect(body.code).toBe('conflict')
    expect(body.currentRevision).toBe(1)
    expect(existsSync(planDocPath(h.workbenchRoot, RID, 'WP1', 1))).toBe(false)
  })

  it('opens a NEW version (max+1) on a fully-approved work package — never 400 locked-version', async () => {
    // Why the 400 'locked-version' fuse has no API-level test: the tail-draft
    // selection only considers entries with approvedAt === undefined, so the
    // checked condition (draft.approvedAt !== undefined) is unreachable by
    // construction — no wire request can ever name an approved version as an
    // overwrite target. The fuse is defense-in-depth for future refactors;
    // its only observable endpoint consequence is pinned here: a
    // fully-approved work package re-opens at max(existing)+1.
    const h = await harness()
    await h.seed([
      seedRecord(RID, {
        workPackages: [
          seedWorkPackage('WP1', {
            status: 'plan-approved',
            plans: [planEntry(1, contentHashOf('v1'), { approvedAt: NOW }), planEntry(2, contentHashOf('v2'), { approvedAt: NOW })],
          }),
        ],
      }),
    ])

    const res = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 1 }, 'v3 content')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, revision: 2, kind: 'plan', workPackageId: 'WP1', version: 3 })
  })
})

// ---------------------------------------------------------------------------
// POST /api/skyaxis/workbench/artifacts — review writes
// ---------------------------------------------------------------------------

describe('POST /api/skyaxis/workbench/artifacts — review writes', () => {
  it('mints a fresh uuid reviewId per write with a ledger contentHash + disk file; title optional', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)])

    const first = await postReview(h, { requirementId: RID, expectedRevision: 1, title: '首轮评审' }, '评审正文一')
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as { ok: true; revision: number; kind: string; reviewId: string }
    expect(firstBody.revision).toBe(2)
    expect(firstBody.kind).toBe('review')
    expect(firstBody.reviewId).toMatch(UUID_RE)
    expect(readFileSync(reviewDocPath(h.workbenchRoot, RID, firstBody.reviewId), 'utf8')).toBe('评审正文一')

    const second = await postReview(h, { requirementId: RID, expectedRevision: 2 }, '评审正文二')
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { ok: true; revision: number; reviewId: string }
    expect(secondBody.revision).toBe(3)
    expect(secondBody.reviewId).not.toBe(firstBody.reviewId)

    const detail = (await (await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)).json()) as WorkbenchDetailResponseOk
    const reports = detail.record?.reviewReports ?? []
    expect(reports).toHaveLength(2)
    expect(reports.find((report) => report.id === firstBody.reviewId)).toEqual({
      id: firstBody.reviewId,
      at: expect.any(String),
      title: '首轮评审',
      contentHash: contentHashOf('评审正文一'),
      verdicts: [],
    })
    const secondEntry = reports.find((report) => report.id === secondBody.reviewId)
    expect(secondEntry).toEqual({
      id: secondBody.reviewId,
      at: expect.any(String),
      contentHash: contentHashOf('评审正文二'),
      verdicts: [],
    })
    expect(secondEntry !== undefined && 'title' in secondEntry).toBe(false)
    expect(detail.reviewFileExists).toEqual([
      { reviewId: firstBody.reviewId, exists: true },
      { reviewId: secondBody.reviewId, exists: true },
    ])
  })

  it('answers 409 on a stale revision and 404 for a missing record', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)])

    const stale = await postReview(h, { requirementId: RID, expectedRevision: 0 }, 'x')
    expect(stale.status).toBe(409)
    expect(await errorCode(stale)).toBe('conflict')
    // Zero file side effects (the plan-write sibling's ladder, applied here):
    // the revision gate rejects before any mkdir/write — reviews/ is absent.
    const reviewsDir = join(h.workbenchRoot, RID, 'reviews')
    expect(existsSync(reviewsDir) ? readdirSync(reviewsDir).filter((name) => name.endsWith('.md')) : []).toHaveLength(0)

    const ghost = await postReview(h, { requirementId: GHOST, expectedRevision: 0 }, 'x')
    expect(ghost.status).toBe(404)
    expect(await errorCode(ghost)).toBe('not-found')
  })
})

// ---------------------------------------------------------------------------
// GET /api/skyaxis/workbench/artifacts — content reads
// ---------------------------------------------------------------------------

describe('GET /api/skyaxis/workbench/artifacts — content reads', () => {
  it('plan reads: content + tamper flag flips after a hand edit; 404 for deleted file / unknown version / unknown work package / unknown record', async () => {
    const h = await harness()
    await h.seed([
      seedRecord(RID, {
        workPackages: [seedWorkPackage('WP1', { status: 'plan-approved', plans: [planEntry(1, contentHashOf('v1 body'), { approvedAt: NOW })] })],
      }),
    ])
    const written = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 1 }, 'v2 body')
    expect(written.status).toBe(200)

    const read = (version: number) => h.get(`${WORKBENCH_ARTIFACTS_PATH}?${qs({ kind: 'plan', requirementId: RID, workPackageId: 'WP1', version })}`)

    const ok = await read(2)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, content: 'v2 body', contentTampered: false })

    const target = planDocPath(h.workbenchRoot, RID, 'WP1', 2)
    writeFileSync(target, 'hand-edited', 'utf8')
    const tampered = await read(2)
    expect(tampered.status).toBe(200)
    expect(await tampered.json()).toEqual({ ok: true, content: 'hand-edited', contentTampered: true })

    rmSync(target)
    expect((await read(2)).status).toBe(404) // ledger entry present, file gone
    expect((await read(9)).status).toBe(404) // no ledger entry for that version
    expect((await h.get(`${WORKBENCH_ARTIFACTS_PATH}?${qs({ kind: 'plan', requirementId: RID, workPackageId: 'WP9', version: 1 })}`)).status).toBe(404)
    expect((await h.get(`${WORKBENCH_ARTIFACTS_PATH}?${qs({ kind: 'plan', requirementId: GHOST, workPackageId: 'WP1', version: 1 })}`)).status).toBe(404)
  })

  it('plan reads: 400 on bad versions (0 / 1.5 / missing) and bad work package ids', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { workPackages: [seedWorkPackage('WP1')] })])

    const readWith = (query: Record<string, string>) => h.get(`${WORKBENCH_ARTIFACTS_PATH}?${new URLSearchParams(query)}`)
    for (const version of ['0', '1.5', '']) {
      expect((await readWith({ kind: 'plan', requirementId: RID, workPackageId: 'WP1', version })).status).toBe(400)
    }
    expect((await readWith({ kind: 'plan', requirementId: RID, workPackageId: 'WP0', version: '1' })).status).toBe(400)
    expect((await readWith({ kind: 'plan', requirementId: 'nope', workPackageId: 'WP1', version: '1' })).status).toBe(400)
  })

  it('review reads mirror the plan face: content, tamper flip, missing file, unknown and malformed ids', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { reviewReports: [reviewEntry('seeded-review', { contentHash: contentHashOf('seeded body') })] })])
    const target = reviewDocPath(h.workbenchRoot, RID, 'seeded-review')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, 'seeded body', 'utf8')

    const read = (reviewId: string) => h.get(`${WORKBENCH_ARTIFACTS_PATH}?${qs({ kind: 'review', requirementId: RID, reviewId })}`)

    const ok = await read('seeded-review')
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, content: 'seeded body', contentTampered: false })

    writeFileSync(target, 'tampered review', 'utf8')
    expect(await (await read('seeded-review')).json()).toEqual({ ok: true, content: 'tampered review', contentTampered: true })

    rmSync(target)
    expect((await read('seeded-review')).status).toBe(404) // ledger entry present, file gone
    expect((await read('ghost-review')).status).toBe(404) // no ledger entry
    expect((await read('bad_id')).status).toBe(400) // underscore is not a reviewId token
    expect((await read(`${'x'.repeat(65)}`)).status).toBe(400) // over the 64-char cap
  })

  it('answers 413 too-large for an on-disk file over the read cap (constant-relative boundary)', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { workPackages: [seedWorkPackage('WP1', { plans: [planEntry(1, 'a'.repeat(64))] })] })])
    const target = planDocPath(h.workbenchRoot, RID, 'WP1', 1)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, 'a'.repeat(WORKBENCH_ARTIFACT_MAX_READ_BYTES + 1), 'utf8')

    const res = await h.get(`${WORKBENCH_ARTIFACTS_PATH}?${qs({ kind: 'plan', requirementId: RID, workPackageId: 'WP1', version: 1 })}`)
    expect(res.status).toBe(413)
    expect(await errorCode(res)).toBe('too-large')
  })
})

// ---------------------------------------------------------------------------
// GET /api/skyaxis/workbench/scan — orphan reconciliation
// ---------------------------------------------------------------------------

describe('GET /api/skyaxis/workbench/scan — reconciliation', () => {
  it('reports orphans (disk without ledger), missing (ledger without disk), and .trash rows; .trash contents are skipped', async () => {
    const h = await harness()
    await h.seed([
      seedRecord(RID, {
        workPackages: [seedWorkPackage('WP1', { plans: [planEntry(2, contentHashOf('m1v2'))] })],
        reviewReports: [reviewEntry('rev-2')],
      }),
      seedRecord(RID2, { workPackages: [seedWorkPackage('WP1', { plans: [planEntry(1, contentHashOf('r2m1v1'))] })] }),
    ])

    const plansOf = (rid: string) => join(h.workbenchRoot, rid, 'plans')
    const reviewsOf = (rid: string) => join(h.workbenchRoot, rid, 'reviews')
    mkdirSync(plansOf(RID), { recursive: true })
    writeFileSync(join(plansOf(RID), 'WP3-v1.md'), 'orphan plan body', 'utf8') // on disk, not in the ledger
    writeFileSync(join(plansOf(RID), 'stray.txt'), 'off-convention', 'utf8') // convention-violating file name
    writeFileSync(join(h.workbenchRoot, RID, 'readme.md'), 'off-layout', 'utf8') // directly under <rid>/
    mkdirSync(reviewsOf(RID3), { recursive: true })
    writeFileSync(join(reviewsOf(RID3), 'orphan-review.md'), 'orphan review body', 'utf8')
    mkdirSync(join(h.workbenchRoot, '.trash', `${RID}-2026-09-29T10-00-00-000Z`), { recursive: true })
    writeFileSync(join(h.workbenchRoot, '.trash', 'stray.md'), 'never reported', 'utf8')
    mkdirSync(join(h.workbenchRoot, '.trash', 'junkdir'), { recursive: true })

    const res = await h.get(WORKBENCH_SCAN_PATH)
    expect(res.status).toBe(200)
    const body = (await res.json()) as WorkbenchScanResponseOk
    expect(body.ok).toBe(true)

    expect(body.orphans).toContainEqual({ requirementId: RID, kind: 'plan', workPackageId: 'WP3', version: 1 })
    expect(body.orphans).toContainEqual({ requirementId: RID, kind: 'unknown', name: 'stray.txt' })
    expect(body.orphans).toContainEqual({ requirementId: RID, kind: 'unknown', name: 'readme.md' })
    expect(body.orphans).toContainEqual({ requirementId: RID3, kind: 'review', reviewId: 'orphan-review' })
    expect(body.orphans).toHaveLength(4)
    // .trash is skipped wholesale — nothing inside it leaks into any face.
    expect(body.orphans.every((row) => row.requirementId !== '.trash')).toBe(true)

    expect(body.missing).toContainEqual({ requirementId: RID, kind: 'plan', workPackageId: 'WP1', version: 2 })
    expect(body.missing).toContainEqual({ requirementId: RID, kind: 'review', reviewId: 'rev-2' })
    expect(body.missing).toContainEqual({ requirementId: RID2, kind: 'plan', workPackageId: 'WP1', version: 1 })
    expect(body.missing).toHaveLength(3)

    expect(body.trash).toEqual([{ requirementId: RID, deletedAt: '2026-09-29T10-00-00-000Z' }])
  })

  it('answers three empty faces when the workbench root does not exist', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)]) // a record without any artifact reference

    const res = await h.get(WORKBENCH_SCAN_PATH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, orphans: [], missing: [], trash: [] })
  })
})
