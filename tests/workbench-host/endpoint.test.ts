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
  KnowledgeCandidate,
  PlanEntry,
  ReleaseItem,
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
  WORKBENCH_DECLARE_PATH,
  WORKBENCH_INLINE_MAX_CHARS,
  WORKBENCH_PATH,
  WORKBENCH_SCAN_PATH,
  DECLARE_MAX_CHARS,
  isReleaseItemId,
} from '../../src/workbench-shared/protocol.js'
import { planDocPath, reviewDocPath } from '../../src/workbench-host/artifact-path.js'
import { contentHashOf } from '../../src/workbench-host/artifact-store.js'
import { KnowledgeFileStore } from '../../src/workbench-host/knowledge-file.js'
import { WorkbenchFileStore } from '../../src/workbench-host/workbench-file.js'
import { SessionDeclareReader } from '../../src/workbench-host/declare-reader.js'
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
const VERDICT_ID = '66666666-6666-4666-8666-666666666666'
const NOW = '2026-09-29T09:30:00.000Z'

const expectIsoString = (value: unknown) => {
  expect(typeof value).toBe('string')
  expect(Number.isNaN(Date.parse(value as string))).toBe(false)
}

async function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-endpoint-test-'))
  dirs.push(dir)
  const file = new WorkbenchFileStore(join(dir, 'workbench.yaml'))
  const knowledgeFile = new KnowledgeFileStore(join(dir, 'knowledge.yaml'))
  const workbenchRoot = join(dir, 'workbench')
  const declareReader = new SessionDeclareReader()
  const ctx = new Context()
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], {} as never)
  })
  await fiber.await()
  const connection = ctx.get('connection') as HostConnectionHandle
  registerWorkbenchEndpoints(connection, { file, knowledgeFile, workbenchRoot, declareReader })
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
  return { file, knowledgeFile, dir, workbenchRoot, declareReader, get, post, postText, seed }
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

function seedReleaseItem(id: string, extra: Partial<ReleaseItem> = {}): ReleaseItem {
  const content = 'ALTER TABLE t_order ADD INDEX idx_created_at (created_at)'
  return {
    id,
    type: 'sql',
    title: `上线项 ${id}`,
    content,
    contentHash: contentHashOf(content),
    envs: ['prod'],
    status: 'pending',
    ...extra,
  }
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
    expect(await res.json()).toEqual({ ok: true, revision: 0, record: null, planFileExists: [], reviewFileExists: [], releaseDrifted: [] })
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
        splitApprovedAt: NOW,
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

describe('acceptance round-2 regressions', () => {
  it('two work packages covering the SAME criterion: both saves 200, ledger reloads clean (coveredBy WP-pattern)', async () => {
    // Live-acceptance repro: the second saveWorkPackage answered 409
    // unreadable-file because the first save wrote coveredBy: [WP1] and the
    // zod schema validated it against the C-pattern — poisoning the ledger
    // on its next load. The schema now validates work-package ids.
    const h = await harness()
    const post = (body: unknown) => h.post(WORKBENCH_PATH, body)
    const rid = RID
    await post({ expectedRevision: 0, requirementId: rid, action: 'saveCriterion', criterion: { text: '标准' } })
    const base = { requirementId: rid, action: 'saveWorkPackage', workPackage: { title: 'WP', boundary: '', dependsOn: [], covers: ['C1'] } }
    const first = await post({ ...base, expectedRevision: 1 })
    expect(first.status).toBe(200)
    const second = await post({ ...base, expectedRevision: 2 })
    expect(second.status).toBe(200)
    // The ledger file on disk reloads clean (this is where it degraded live).
    const detail = await h.get(`${WORKBENCH_PATH}?requirementId=${rid}`)
    expect(detail.status).toBe(200)
    const body = (await detail.json()) as { record: { criteria: { coveredBy: string[] }[] } }
    expect(body.record.criteria[0]?.coveredBy).toEqual(['WP1', 'WP2'])
  })
})

describe('POST /api/skyaxis/workbench/artifacts — plan writes', () => {
  it('rejects non-text/plain bodies with 415 and malformed queries with 400', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1')] })])

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
    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1')] })])

    const res = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 1 }, '字'.repeat(WORKBENCH_ARTIFACT_MAX_CHARS + 1))
    expect(res.status).toBe(413)
    expect(await errorCode(res)).toBe('too-large')
  })

  it('answers 404 for a missing record and a missing work package, with zero file side effects', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1')] })])

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
        splitApprovedAt: NOW,
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
    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1', { plans: [planEntry(1, contentHashOf('SAME BODY'))] })] })])
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
    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1', { plans: [planEntry(1, contentHashOf('V2 BODY'))] })] })])
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
    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1', { plans: [planEntry(1, contentHashOf('SAME'), { note: '初稿' })] })] })])

    const res = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 1, note: '改注' }, 'SAME')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, revision: 2, version: 1 }) // a save DID run
    const detail = await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)
    const body = (await detail.json()) as { record: { workPackages: { plans: { note?: string }[] }[] } }
    expect(body.record.workPackages[0]?.plans[0]?.note).toBe('改注')
  })

  it('answers 409 conflict on a stale expectedRevision with zero file side effects', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1', { plans: [planEntry(1, contentHashOf('seeded v1'))] })] })])

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
        splitApprovedAt: NOW,
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
        splitApprovedAt: NOW,
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
    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1')] })])

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
    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1', { plans: [planEntry(1, 'a'.repeat(64))] })] })])
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

// ---------------------------------------------------------------------------
// POST mutate + plan writes — hard-gate and status-machine smoke (second
// knife): the record-actions guards exercised for real over HTTP. Kept to
// gate-direction-neutral flows; the full lifecycle matrix lives in
// record-actions.test.ts against the pure core.
// ---------------------------------------------------------------------------

describe('POST /api/skyaxis/workbench — gate and status smoke (second knife)', () => {
  const postAction = (h: Harness, body: Record<string, unknown>) => h.post(WORKBENCH_PATH, body)
  const detailStatus = async (h: Harness, rid = RID) => {
    const detail = (await (await h.get(`${WORKBENCH_PATH}?requirementId=${rid}`)).json()) as WorkbenchDetailResponseOk
    return detail.record?.workPackages[0]?.status
  }

  it('answers 404 not-found over HTTP for an action naming a missing work package and leaves the ledger untouched', async () => {
    const h = await harness()
    const res = await postAction(h, { expectedRevision: 0, requirementId: GHOST, action: 'removeWorkPackage', id: 'WP9' })
    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('not-found')
    // The failed action must not persist the implicitly created record.
    const listed = (await (await h.get(WORKBENCH_PATH)).json()) as { records: unknown[] }
    expect(listed.records).toHaveLength(0)
  })

  it('locks list CRUD behind an approved split over HTTP: 400 locked-split, double approve 400, revoke reopens the list', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1')] })])

    const lockedRemove = await postAction(h, { expectedRevision: 1, requirementId: RID, action: 'removeWorkPackage', id: 'WP1' })
    expect(lockedRemove.status).toBe(400)
    expect(await errorCode(lockedRemove)).toBe('locked-split')

    const twice = await postAction(h, { expectedRevision: 1, requirementId: RID, action: 'approveSplit' })
    expect(twice.status).toBe(400) // the seeded stamp means this is a second approval

    const revoke = await postAction(h, { expectedRevision: 1, requirementId: RID, action: 'revokeSplitApproval' })
    expect(revoke.status).toBe(200)
    const unlockedRemove = await postAction(h, { expectedRevision: 2, requirementId: RID, action: 'removeWorkPackage', id: 'WP1' })
    expect(unlockedRemove.status).toBe(200)
  })

  it('plan writes drive the status flips: first draft planned→plan-draft in the same save, rewrites keep it, a plan-approved package keeps its status under new drafts', async () => {
    const h = await harness()
    await h.seed([
      seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1')] }),
      seedRecord(RID2, {
        splitApprovedAt: NOW,
        workPackages: [seedWorkPackage('WP1', { status: 'plan-approved', plans: [planEntry(1, contentHashOf('v1 body'), { approvedAt: NOW })] })],
      }),
    ])

    const first = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 1 }, 'v1 草稿')
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ ok: true, revision: 2, version: 1 })
    expect(await detailStatus(h)).toBe('plan-draft') // same save flipped it

    const rewrite = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 2 }, 'v1 草稿改')
    expect(rewrite.status).toBe(200)
    expect(await rewrite.json()).toMatchObject({ version: 1 }) // tail draft, same version
    expect(await detailStatus(h)).toBe('plan-draft') // no double flip

    const nextOnApproved = await postPlan(h, { requirementId: RID2, workPackageId: 'WP1', expectedRevision: 3 }, 'v2 新稿')
    expect(nextOnApproved.status).toBe(200)
    expect(await nextOnApproved.json()).toMatchObject({ version: 2 })
    expect(await detailStatus(h, RID2)).toBe('plan-approved') // later writes keep the status
  })

  it('an unapproved split shadows plan writes BEFORE the idempotent branch: even a byte-identical retry is 400 locked-split until approval', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { workPackages: [seedWorkPackage('WP1', { plans: [planEntry(1, contentHashOf('SAME BODY'))] })] })])

    const locked = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 1 }, 'SAME BODY')
    expect(locked.status).toBe(400)
    expect(await errorCode(locked)).toBe('locked-split')

    const approve = await postAction(h, { expectedRevision: 1, requirementId: RID, action: 'approveSplit' })
    expect(approve.status).toBe(200)
    const retry = await postPlan(h, { requirementId: RID, workPackageId: 'WP1', expectedRevision: 2 }, 'SAME BODY')
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ ok: true, revision: 2, version: 1 }) // idempotent — no save
  })
})

// ---------------------------------------------------------------------------
// POST /api/skyaxis/workbench — P2 knowledge candidates & session bindings
// （host 面端到端：双账本 activate、降级前置 409、幂等重试、绑定三面）
// ---------------------------------------------------------------------------

describe('POST /api/skyaxis/workbench — P2 knowledge candidates & session bindings', () => {
  const CAND = '55555555-5555-4555-8555-555555555555'
  const CAND_SEED: KnowledgeCandidate = {
    id: CAND,
    title: '候选：大表导出走异步',
    draft: '大表导出禁止一次全量拉取',
    type: 'convention',
    proposedSessionId: 'sess-origin',
    at: NOW,
    status: 'pending',
  }
  const seedCandidate = async (h: Harness, overrides: Partial<KnowledgeCandidate> = {}) =>
    h.seed([seedRecord(RID, { knowledgeCandidates: [{ ...CAND_SEED, ...overrides }] })])
  const activateBody = (expectedRevision: number) => ({
    expectedRevision,
    requirementId: RID,
    action: 'activateKnowledgeCandidate' as const,
    id: CAND,
    knowledge: { scope: 'requirement' as const, type: 'convention' as const, trigger: { mode: 'keyword' as const, value: '  导出  ' } },
  })

  it('activate 端到端双账本：workbench 候选 promoted + knowledge.yaml 行（id=候选 id、trigger 归一化、provenance 带 proposedSessionId）', async () => {
    const h = await harness()
    await seedCandidate(h) // workbench revision 1

    const res = await h.post(WORKBENCH_PATH, activateBody(1))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; record: WorkbenchRecord }
    expect(body.revision).toBe(2)
    expect(body.record.knowledgeCandidates[0]?.status).toBe('promoted')

    const wb = h.file.load()
    expect(wb.ok).toBe(true)
    if (wb.ok) expect(wb.value.records[0]?.knowledgeCandidates[0]?.status).toBe('promoted')

    const kb = h.knowledgeFile.load()
    expect(kb.ok).toBe(true)
    if (!kb.ok) return
    expect(kb.value.revision).toBe(1)
    expect(kb.value.records).toHaveLength(1)
    expect(kb.value.records[0]).toEqual({
      id: CAND,
      scope: 'requirement',
      type: 'convention',
      title: '候选：大表导出走异步',
      content: '大表导出禁止一次全量拉取',
      requirementId: RID,
      trigger: { mode: 'keyword', value: '导出' },
      status: 'active',
      provenance: { requirementId: RID, sessionId: 'sess-origin', at: expect.any(String) },
    })
  })

  it('activate 幂等重试：同 body 再 POST ⇒ 200，workbench revision 不增、行仍单份（replace-or-append 不重复）', async () => {
    const h = await harness()
    await seedCandidate(h)
    const first = await h.post(WORKBENCH_PATH, activateBody(1))
    expect(first.status).toBe(200)

    // 契约注记：workbench 侧跳过 save（revision 冻结在 2）；knowledge 侧
    // unchanged 分支仍执行 upsertKnowledgeRow 尾写（fresh-load replace），
    // 该 store 无 no-op 检测 → knowledge revision 会 +1 且 provenance.at 刷新。
    // 此处按实现钉住「workbench 不增 + 行不重复 + 候选不再翻转」。
    const retry = await h.post(WORKBENCH_PATH, activateBody(2))
    expect(retry.status).toBe(200)
    const body = (await retry.json()) as { ok: true; revision: number; record: WorkbenchRecord }
    expect(body.revision).toBe(2) // workbench 侧不增
    expect(body.record.knowledgeCandidates[0]?.status).toBe('promoted')

    const wb = h.file.load()
    expect(wb.ok).toBe(true)
    if (wb.ok) {
      expect(wb.value.revision).toBe(2) // workbench 文件未被重写
      expect(wb.value.records[0]?.knowledgeCandidates).toHaveLength(1)
    }

    const kb = h.knowledgeFile.load()
    expect(kb.ok).toBe(true)
    if (kb.ok) expect(kb.value.records).toHaveLength(1) // 行不重复（by-id replace）
  })

  it('promoted 重试补写缺失的 knowledge 行（tail-write repair）：workbench 零改动，行落盘', async () => {
    const h = await harness()
    await seedCandidate(h, { status: 'promoted' }) // workbench revision 1；knowledge.yaml 不存在（pristine）

    const res = await h.post(WORKBENCH_PATH, activateBody(1))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number }
    expect(body.revision).toBe(1) // workbench 不增

    const kb = h.knowledgeFile.load()
    expect(kb.ok).toBe(true)
    if (!kb.ok) return
    expect(kb.value.revision).toBe(1)
    expect(kb.value.records[0]?.id).toBe(CAND)
  })

  it('knowledge 账本降级 ⇒ activate 409 unreadable-file 且 workbench 候选仍 pending（save 前置检查，零改动）', async () => {
    const h = await harness()
    await seedCandidate(h)
    writeFileSync(h.knowledgeFile.filePath, 'broken: [', 'utf8')

    const res = await h.post(WORKBENCH_PATH, activateBody(1))
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('unreadable-file')

    const detail = (await (await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)).json()) as WorkbenchDetailResponseOk
    expect(detail.record?.knowledgeCandidates[0]?.status).toBe('pending') // 未被推进

    const wb = h.file.load()
    expect(wb.ok).toBe(true)
    if (wb.ok) expect(wb.value.revision).toBe(1) // 账本零改动
  })

  it('activate 未知候选 ⇒ 404（两账本零落笔）', async () => {
    const h = await harness()
    await seedCandidate(h)
    const res = await h.post(WORKBENCH_PATH, { ...activateBody(1), id: GHOST })
    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('not-found')
    const wb = h.file.load()
    expect(wb.ok).toBe(true)
    if (wb.ok) expect(wb.value.revision).toBe(1)
    expect(h.knowledgeFile.load()).toEqual({ ok: true, value: { version: 1, revision: 0, records: [] } })
  })

  it('activate workspace scope：path trim 落 knowledge 行', async () => {
    const h = await harness()
    await seedCandidate(h)
    const res = await h.post(WORKBENCH_PATH, {
      expectedRevision: 1,
      requirementId: RID,
      action: 'activateKnowledgeCandidate',
      id: CAND,
      knowledge: { scope: 'workspace', type: 'business', trigger: { mode: 'always' }, path: '  C:/repos/main  ' },
    })
    expect(res.status).toBe(200)

    const kb = h.knowledgeFile.load()
    expect(kb.ok).toBe(true)
    if (kb.ok) {
      expect(kb.value.records[0]?.scope).toBe('workspace')
      expect(kb.value.records[0]?.path).toBe('C:/repos/main')
    }
  })

  it('activate 候选无 proposedSessionId：provenance 不带 sessionId 键', async () => {
    const h = await harness()
    await seedCandidate(h, { proposedSessionId: undefined })
    const res = await h.post(WORKBENCH_PATH, {
      expectedRevision: 1,
      requirementId: RID,
      action: 'activateKnowledgeCandidate',
      id: CAND,
      knowledge: { scope: 'global', type: 'convention', trigger: { mode: 'always' } },
    })
    expect(res.status).toBe(200)

    const kb = h.knowledgeFile.load()
    expect(kb.ok).toBe(true)
    if (kb.ok) {
      expect(kb.value.records[0]?.provenance).toEqual({ requirementId: RID, at: expect.any(String) })
      expect('sessionId' in (kb.value.records[0]?.provenance ?? {})).toBe(false)
    }
  })

  it('bindSession：split 未批 ⇒ 400 locked-split', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { workPackages: [seedWorkPackage('WP1')] })])

    const res = await h.post(WORKBENCH_PATH, { expectedRevision: 1, requirementId: RID, action: 'bindSession', id: 'WP1', sessionId: 'sess-a', purpose: 'dev' })
    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('locked-split')
  })

  it('bindSession：批准后 append 落盘；重复绑定 200 且 revision 不增、不产生第二行', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1')] })]) // revision 1

    const first = await h.post(WORKBENCH_PATH, { expectedRevision: 1, requirementId: RID, action: 'bindSession', id: 'WP1', sessionId: 'sess-a', purpose: 'dev' })
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as { ok: true; revision: number; record: WorkbenchRecord }
    expect(firstBody.revision).toBe(2)
    expect(firstBody.record.workPackages[0]?.sessions).toEqual([{ sessionId: 'sess-a', purpose: 'dev', boundAt: expect.any(String) }])

    const retry = await h.post(WORKBENCH_PATH, { expectedRevision: 2, requirementId: RID, action: 'bindSession', id: 'WP1', sessionId: 'sess-a', purpose: 'dev' })
    expect(retry.status).toBe(200)
    expect(((await retry.json()) as { revision: number }).revision).toBe(2) // 幂等：revision 不增

    const loaded = h.file.load()
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      expect(loaded.value.revision).toBe(2)
      expect(loaded.value.records[0]?.workPackages[0]?.sessions).toHaveLength(1)
    }
  })

  it('bindSession：同 sessionId 异 purpose ⇒ 400 bad-request（账本不动）', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, {
      splitApprovedAt: NOW,
      workPackages: [seedWorkPackage('WP1', { sessions: [{ sessionId: 'sess-a', purpose: 'dev', boundAt: NOW }] })],
    })])

    const res = await h.post(WORKBENCH_PATH, { expectedRevision: 1, requirementId: RID, action: 'bindSession', id: 'WP1', sessionId: 'sess-a', purpose: 'analysis' })
    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('bad-request')

    const loaded = h.file.load()
    expect(loaded.ok).toBe(true)
    if (loaded.ok) expect(loaded.value.revision).toBe(1) // 被拒写入零残留
  })
})

describe('POST /api/skyaxis/workbench — P3a release items & rollback plan', () => {
  const saveBody = (rev: number, releaseItem: Record<string, unknown>, requirementId = RID) => ({
    expectedRevision: rev, requirementId, action: 'saveReleaseItem', releaseItem,
  })

  it('隐式建账：无记录的需求首次登记 → R0001 落盘且账本可再读（毒化事故的 HTTP 面回归钉）', async () => {
    const h = await harness()
    const res = await h.post(WORKBENCH_PATH, saveBody(0, { type: 'sql', title: '建表', content: 'CREATE TABLE x', envs: ['prod'] }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; record: WorkbenchRecord }
    expect(body.revision).toBe(1)
    expect(body.record.releaseItems[0]?.id).toBe('R0001')

    // 盘上真源：id 必须是四位补零形态，否则下一次 load 全账本 degrade。
    const loaded = h.file.load()
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      expect(loaded.value.records[0]?.releaseItems[0]?.id).toBe('R0001')
      expect(isReleaseItemId(loaded.value.records[0]?.releaseItems[0]?.id ?? '')).toBe(true)
    }
  })

  it('登记后 detail GET 照常 200（不是 409 unreadable——毒化会在此现形）', async () => {
    const h = await harness()
    await h.post(WORKBENCH_PATH, saveBody(0, { type: 'config', title: '参数', content: 'max=8', envs: ['prod'] }))
    const detail = await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)
    expect(detail.status).toBe(200)
    const detailBody = (await detail.json()) as WorkbenchDetailResponseOk
    expect(detailBody.ok).toBe(true)
    expect(detailBody.record?.releaseItems).toHaveLength(1)
  })

  it('全生命周期链：登记→确认→已执行（带 appliedAt）→已验证，全程落盘', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)]) // revision 1
    const step = async (rev: number, action: string, extra: Record<string, unknown> = {}): Promise<number> => {
      const res = await h.post(WORKBENCH_PATH, { expectedRevision: rev, requirementId: RID, action, id: 'R0001', ...extra })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { revision: number; record: WorkbenchRecord }
      expect(body.record.releaseItems[0]?.status).toBeDefined()
      return body.revision
    }

    let rev = await (async () => {
      const res = await h.post(WORKBENCH_PATH, saveBody(1, { type: 'sql', title: '加索引', content: 'ALTER TABLE t ADD i(c)', envs: ['prod'], note: 'v1.2' }))
      expect(res.status).toBe(200)
      return ((await res.json()) as { revision: number }).revision
    })()
    rev = await step(rev, 'confirmReleaseItem')
    rev = await step(rev, 'markReleaseItemApplied')
    rev = await step(rev, 'markReleaseItemVerified')

    const loaded = h.file.load()
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      const item = loaded.value.records[0]?.releaseItems[0]
      expect(item?.status).toBe('verified')
      expect(item?.appliedAt).toBeDefined()
      expect(item?.note).toBe('v1.2')
    }
  })

  it('严格链 HTTP 面：pending 直接 markApplied → 400 且账本零残留', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { releaseItems: [seedReleaseItem('R0001')] })]) // revision 1

    const res = await h.post(WORKBENCH_PATH, { expectedRevision: 1, requirementId: RID, action: 'markReleaseItemApplied', id: 'R0001' })
    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('bad-request')

    const loaded = h.file.load()
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      expect(loaded.value.revision).toBe(1)
      expect(loaded.value.records[0]?.releaseItems[0]?.status).toBe('pending')
    }
  })

  it('幂等 HTTP 面：重复 confirm → 200 且 revision 不增', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { releaseItems: [seedReleaseItem('R0001', { status: 'confirmed' })] })])

    const res = await h.post(WORKBENCH_PATH, { expectedRevision: 1, requirementId: RID, action: 'confirmReleaseItem', id: 'R0001' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { revision: number }).revision).toBe(1)
  })

  it('rollbackPlan 戳：confirm 落盘 → revoke 摘除；stale revision → 409 带 currentRevision', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)]) // revision 1

    const stale = await h.post(WORKBENCH_PATH, { expectedRevision: 0, requirementId: RID, action: 'confirmRollbackPlan' })
    expect(stale.status).toBe(409)
    expect(await errorCode(stale)).toBe('conflict')

    const confirm = await h.post(WORKBENCH_PATH, { expectedRevision: 1, requirementId: RID, action: 'confirmRollbackPlan' })
    expect(confirm.status).toBe(200)
    expect(((await confirm.json()) as { record: WorkbenchRecord }).record.rollbackPlanConfirmedAt).toBeDefined()

    const revoke = await h.post(WORKBENCH_PATH, { expectedRevision: 2, requirementId: RID, action: 'revokeRollbackPlan' })
    expect(revoke.status).toBe(200)
    const loaded = h.file.load()
    expect(loaded.ok).toBe(true)
    if (loaded.ok) expect(loaded.value.records[0]?.rollbackPlanConfirmedAt).toBeUndefined()
  })

  it('门外 HTTP 面：拆分未批准照样登记（阶段可跳过 + R5 手动最短路径）', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { splitApprovedAt: undefined })]) // 无批准戳
    const res = await h.post(WORKBENCH_PATH, saveBody(1, { type: 'flag', title: '开关', content: 'enabled=false', envs: ['prod'] }))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { record: WorkbenchRecord }).record.releaseItems).toHaveLength(1)
  })

  it('坏 wire 拒形：R1 作为编辑目标 → 400（zod 层拒绝非法 id）', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)])
    const res = await h.post(WORKBENCH_PATH, saveBody(1, { id: 'R1', type: 'sql', title: 'x', content: 'x', envs: [] }))
    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('bad-request')
  })

  it('漂移投影：经端点写入的条目零漂移（写入即重算 hash，自洽）', async () => {
    const h = await harness()
    await h.post(WORKBENCH_PATH, saveBody(0, { type: 'sql', title: '自洽', content: 'SELECT 1', envs: ['prod'] }))
    const detail = (await (await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)).json()) as WorkbenchDetailResponseOk
    expect(detail.releaseDrifted).toEqual([])
  })

  it('漂移投影：手改 yaml 的 content → 该项 id 入 releaseDrifted（读时重算比对，响应面字段不入账本）', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, {
      releaseItems: [seedReleaseItem('R0001'), seedReleaseItem('R0002', { type: 'config', title: '并发参数', content: 'max=4', contentHash: contentHashOf('max=4') })],
    })])

    // 外部手改：R0001 的 content 被换掉但登记时的 hash 留在账里。
    const yamlText = readFileSync(h.file.filePath, 'utf8')
    writeFileSync(h.file.filePath, yamlText.replace('ALTER TABLE t_order ADD INDEX idx_created_at (created_at)', 'ALTER TABLE t_order DROP INDEX idx_created_at'), 'utf8')

    const detail = (await (await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)).json()) as WorkbenchDetailResponseOk
    expect(detail.releaseDrifted).toEqual(['R0001'])

    // 投影绝不回写：账本盘上 contentHash 原样（漂移是读时事实，不是账本状态）。
    const after = readFileSync(h.file.filePath, 'utf8')
    expect(after).toContain(contentHashOf('ALTER TABLE t_order ADD INDEX idx_created_at (created_at)'))
  })

  it('漂移投影：编辑 pending 条目走端点 → hash 随 content 重算，零漂移（编辑不自造漂移的实证）', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { releaseItems: [seedReleaseItem('R0001')] })]) // revision 1
    const edit = await h.post(WORKBENCH_PATH, saveBody(1, { id: 'R0001', type: 'sql', title: '上线项 R0001', content: 'ALTER TABLE t_order ADD INDEX idx_created_at (created_at), idx_status (status)', envs: ['prod'] }))
    expect(edit.status).toBe(200)

    const detail = (await (await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)).json()) as WorkbenchDetailResponseOk
    expect(detail.releaseDrifted).toEqual([])
    expect(detail.record?.releaseItems[0]?.contentHash).toBe(contentHashOf('ALTER TABLE t_order ADD INDEX idx_created_at (created_at), idx_status (status)'))
  })
})

describe('declare route (P3b) — GET fetch + POST two-stage import', () => {
  const GOOD = [
    '# skyaxis-declare',
    'workPackage: WP1',
    'claims:',
    '  - built: true',
    'artifacts:',
    '  - type: sql',
    '    title: t_order 加索引',
    '    content: ALTER TABLE t_order ADD INDEX i(c)',
    '    envs: [prod]',
    'knowledge:',
    '  - type: convention',
    '    title: 导出走异步',
    '    draft: 大表导出禁止一次全量拉取',
    'stageReady: true',
  ].join('\n')
  const assistantDeclare = (body: string) =>
    ({ type: 'assistant/message', seq: 1, time: 0, data: { message: { content: [{ type: 'text', text: `收尾\n\`\`\`yaml\n${body}\n\`\`\`` }] } } })

  it('GET：无 engine → 200 no-service 信封（读降级不报错）；缺 sessionId → 400', async () => {
    const h = await harness()
    const res = await h.get(`${WORKBENCH_DECLARE_PATH}?sessionId=sess-1`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, missing: 'no-service' })
    const noParam = await h.get(WORKBENCH_DECLARE_PATH)
    expect(noParam.status).toBe(400)
  })

  it('GET：engine 在场 → 提取 assistant 声明块文本', async () => {
    const h = await harness()
    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantDeclare(GOOD) as never] }) })
    const res = await h.get(`${WORKBENCH_DECLARE_PATH}?sessionId=sess-1`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; text: string }
    expect(body.text).toContain('workPackage: WP1')
    expect(body.text).toContain('# skyaxis-declare')
  })

  it('POST dry-run：预览零写盘（逐字节相等）+ revision 锚定 + stale → 409', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1', { status: 'in-dev' })] })]) // revision 1
    const before = readFileSync(h.file.filePath, 'utf8')

    const stale = await h.post(WORKBENCH_DECLARE_PATH, { expectedRevision: 0, requirementId: RID, dryRun: true, text: `\`\`\`yaml\n${GOOD}\n\`\`\`` })
    expect(stale.status).toBe(409)
    expect(await errorCode(stale)).toBe('conflict')

    const res = await h.post(WORKBENCH_DECLARE_PATH, { expectedRevision: 1, requirementId: RID, dryRun: true, text: `\`\`\`yaml\n${GOOD}\n\`\`\`` })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; entries: Array<{ key: string; kind: string }>; skipped: unknown[]; stageReady: boolean }
    expect(body.revision).toBe(1)
    expect(body.entries.map((entry) => entry.key)).toEqual(['built-0', 'artifact-0', 'knowledge-0'])
    expect(body.skipped).toEqual([])
    expect(body.stageReady).toBe(true)
    expect(readFileSync(h.file.filePath, 'utf8')).toBe(before) // 零写
  })

  it('POST 整块错误走 200 信封：行内逗号形 → blockError yaml-syntax + 行号；无块 → no-declare-block', async () => {
    const h = await harness()
    const comma = await h.post(WORKBENCH_DECLARE_PATH, { expectedRevision: 0, requirementId: RID, dryRun: true, text: '```yaml\n# skyaxis-declare\nartifacts:\n  - type: sql, title: x, content: y\n```' })
    expect(comma.status).toBe(200)
    expect(await comma.json()).toMatchObject({ ok: true, blockError: 'yaml-syntax', blockErrorLine: 3 })

    const none = await h.post(WORKBENCH_DECLARE_PATH, { expectedRevision: 0, requirementId: RID, dryRun: true, text: '没有声明块的总结' })
    expect(none.status).toBe(200)
    expect(await none.json()).toMatchObject({ ok: true, blockError: 'no-declare-block' })
  })

  it('POST commit：三类折叠一次 save 落盘——built 经真守卫、R 序号、pending、provenance、报告计数', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1', { status: 'in-dev' })] })]) // revision 1

    const res = await h.post(WORKBENCH_DECLARE_PATH, {
      expectedRevision: 1, requirementId: RID, sessionId: 'sess-9',
      text: `\`\`\`yaml\n${GOOD}\n\`\`\``,
      selected: ['built-0', 'artifact-0', 'knowledge-0'],
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; record: WorkbenchRecord; report: { built: number; artifacts: number; knowledge: number } }
    expect(body.revision).toBe(2) // 一次 save 一个 bump
    expect(body.report).toEqual({ built: 1, artifacts: 1, knowledge: 1, skipped: [] })
    expect(body.record.workPackages[0]?.status).toBe('built')

    const loaded = h.file.load()
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      const item = loaded.value.records[0]?.releaseItems[0]
      expect(item?.id).toBe('R0001')
      expect(item?.status).toBe('pending')
      expect(item?.contentHash).toBe(contentHashOf('ALTER TABLE t_order ADD INDEX i(c)'))
      expect(item?.sessionId).toBe('sess-9')
      expect(item?.workPackageId).toBe('WP1')
      const candidate = loaded.value.records[0]?.knowledgeCandidates[0]
      expect(candidate?.status).toBe('pending')
      expect(candidate?.proposedSessionId).toBe('sess-9')
    }
  })

  it('POST commit：split 未批 → built 落 skipped（wp-not-in-dev），artifacts/knowledge 照常导入（门外语义）', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { workPackages: [seedWorkPackage('WP1', { status: 'in-dev' })] })]) // 无 splitApprovedAt

    const res = await h.post(WORKBENCH_DECLARE_PATH, {
      expectedRevision: 1, requirementId: RID,
      text: `\`\`\`yaml\n${GOOD}\n\`\`\``,
      selected: ['built-0', 'artifact-0', 'knowledge-0'],
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; record: WorkbenchRecord; report: { built: number; artifacts: number; knowledge: number; skipped: Array<{ key: string; reason: string }> } }
    expect(body.report.built).toBe(0)
    expect(body.report.skipped).toEqual([{ key: 'built-0', label: 'WP1', reason: 'wp-not-in-dev' }])
    expect(body.report.artifacts).toBe(1)
    expect(body.report.knowledge).toBe(1)
    expect(body.record.workPackages[0]?.status).toBe('in-dev') // 未动
  })

  it('POST commit：零选中 → 200 且 revision 不增不写盘（repos-pool 零变更先例）；未知 selected 键忽略', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)])
    const before = readFileSync(h.file.filePath, 'utf8')

    const res = await h.post(WORKBENCH_DECLARE_PATH, {
      expectedRevision: 1, requirementId: RID,
      text: `\`\`\`yaml\n${GOOD}\n\`\`\``,
      selected: ['ghost-0'],
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { revision: number }).revision).toBe(1)
    expect(readFileSync(h.file.filePath, 'utf8')).toBe(before)
  })

  it('POST 拒形：超 DECLARE_MAX_CHARS → 413；degraded 账本 → 409', async () => {
    const h = await harness()
    const tooBig = await h.post(WORKBENCH_DECLARE_PATH, { expectedRevision: 0, requirementId: RID, dryRun: true, text: 'x'.repeat(DECLARE_MAX_CHARS + 1) })
    expect(tooBig.status).toBe(413)

    await h.seed([seedRecord(RID)])
    writeFileSync(h.file.filePath, 'broken: [', 'utf8')
    const degraded = await h.post(WORKBENCH_DECLARE_PATH, { expectedRevision: 0, requirementId: RID, dryRun: true, text: 'x' })
    expect(degraded.status).toBe(409)
    expect(await errorCode(degraded)).toBe('unreadable-file')
  })
})

describe('P4: review verdicts + idempotency anchor + candidate distillation', () => {
  it('幂等锚：同内容同题重试 → 同一 reviewId、revision 不增、不产生第二条；文件缺失随收敛修复', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)]) // revision 1
    const body = '# 评审报告\n发现两处问题。'

    const first = await postReview(h, { requirementId: RID, expectedRevision: 1, title: '全量评审' }, body)
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as { revision: number; reviewId: string }
    const seeded = h.file.load()
    expect(seeded.ok && seeded.value.records[0]?.reviewReports).toHaveLength(1)

    // 收敛分支先于 revision 检查：重试携带过期 expectedRevision 也收敛。
    const retry = await postReview(h, { requirementId: RID, expectedRevision: 1, title: '全量评审' }, body)
    expect(retry.status).toBe(200)
    const retryBody = (await retry.json()) as { revision: number; reviewId: string }
    expect(retryBody.reviewId).toBe(firstBody.reviewId)
    expect(retryBody.revision).toBe(firstBody.revision) // 收敛不 bump

    const after = h.file.load()
    expect(after.ok && after.value.records[0]?.reviewReports).toHaveLength(1)

    // 收敛修复面：删掉正文文件再重试 → 文件回来。
    rmSync(reviewDocPath(h.workbenchRoot, RID, firstBody.reviewId), { force: true })
    const repair = await postReview(h, { requirementId: RID, expectedRevision: 1, title: '全量评审' }, body)
    expect(repair.status).toBe(200)
    expect(existsSync(reviewDocPath(h.workbenchRoot, RID, firstBody.reviewId))).toBe(true)
  })

  it('幂等锚分度：同内容不同题 → 新报告；不同内容同题 → 新报告', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)]) // revision 1
    const a = await postReview(h, { requirementId: RID, expectedRevision: 1, title: 'A' }, '# x')
    const aBody = (await a.json()) as { revision: number; reviewId: string }
    const b = await postReview(h, { requirementId: RID, expectedRevision: aBody.revision, title: 'B' }, '# x')
    const bBody = (await b.json()) as { revision: number; reviewId: string }
    expect(bBody.reviewId).not.toBe(aBody.reviewId)
    const c = await postReview(h, { requirementId: RID, expectedRevision: bBody.revision, title: 'A' }, '# y')
    expect(((await c.json()) as { reviewId: string }).reviewId).not.toBe(aBody.reviewId)
  })

  it('verdict 动作族 HTTP 面：添加→编辑（置处置）→删除行→删除报告，全程落盘', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)]) // revision 1
    const imported = await postReview(h, { requirementId: RID, expectedRevision: 1 }, '# 报告')
    expect(imported.status).toBe(200)
    const reviewId = ((await imported.json()) as { reviewId: string }).reviewId

    const add = await h.post(WORKBENCH_PATH, {
      expectedRevision: 2, requirementId: RID, action: 'saveReviewVerdict', reportId: reviewId,
      verdict: { title: '空指针', severity: 'medium', verdict: 'confirmed', disposition: 'to-fix' },
    })
    expect(add.status).toBe(200)
    const added = ((await add.json()) as { record: WorkbenchRecord }).record
    const rowId = added.reviewReports[0]?.verdicts[0]?.id
    expect(rowId).toBeDefined()

    const edit = await h.post(WORKBENCH_PATH, {
      expectedRevision: 3, requirementId: RID, action: 'saveReviewVerdict', reportId: reviewId,
      verdict: { id: rowId, title: '空指针', severity: 'medium', verdict: 'confirmed', disposition: 'fixed' },
    })
    expect(edit.status).toBe(200)
    const loaded = h.file.load()
    expect(loaded.ok && loaded.value.records[0]?.reviewReports[0]?.verdicts[0]?.disposition).toBe('fixed')

    const removeRow = await h.post(WORKBENCH_PATH, { expectedRevision: 4, requirementId: RID, action: 'removeReviewVerdict', reportId: reviewId, id: rowId })
    expect(removeRow.status).toBe(200)
    const removeReport = await h.post(WORKBENCH_PATH, { expectedRevision: 5, requirementId: RID, action: 'removeReviewReport', id: reviewId })
    expect(removeReport.status).toBe(200)
    const final = h.file.load()
    expect(final.ok && final.value.records[0]?.reviewReports).toHaveLength(0)
    // 条目删除后正文文件留盘成孤儿（P1b 账本/引用分离——scan 可见）。
    expect(existsSync(reviewDocPath(h.workbenchRoot, RID, reviewId))).toBe(true)
  })

  it('rejected 双守卫 HTTP 面：无 note / 带 disposition → 400 零残留', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { reviewReports: [reviewEntry('rev-a1')] })])
    for (const verdict of [
      { title: 'x', severity: 'low', verdict: 'rejected' as const },
      { title: 'x', severity: 'low', verdict: 'rejected' as const, note: '理由', disposition: 'fixed' as const },
    ]) {
      const res = await h.post(WORKBENCH_PATH, { expectedRevision: 1, requirementId: RID, action: 'saveReviewVerdict', reportId: 'rev-a1', verdict })
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('bad-request')
    }
    const loaded = h.file.load()
    expect(loaded.ok && loaded.value.revision).toBe(1)
  })

  it('saveKnowledgeCandidate HTTP 面：手动提炼落 pending', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)])
    const res = await h.post(WORKBENCH_PATH, {
      expectedRevision: 1, requirementId: RID, action: 'saveKnowledgeCandidate',
      candidate: { title: '导出走异步', draft: '禁止全量拉取', type: 'convention' },
    })
    expect(res.status).toBe(200)
    const loaded = h.file.load()
    expect(loaded.ok && loaded.value.records[0]?.knowledgeCandidates[0]?.status).toBe('pending')
  })
})

describe('P5b: review seeding + reSplit + confirmSplitStillValid', () => {
  const REVIEW_BODY = [
    '# 全量代码评审',
    '',
    '## 事务',
    '导入与校验不在同一事务，失败缺整体回滚。',
    '',
    '```yaml',
    '# skyaxis-review',
    'findings:',
    '  - title: 事务缺失',
    '    severity: high',
    '  - title: 空指针',
    '    severity: medium',
    '```',
  ].join('\n')

  it('writeReview 种子 proposed 裁决行（host 铸 uuid）+ seeded 计数；无约定块的报告 verdicts 空、blockError 咨询', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)]) // revision 1

    const withBlock = await postReview(h, { requirementId: RID, expectedRevision: 1, title: '全量评审' }, REVIEW_BODY)
    expect(withBlock.status).toBe(200)
    const body = (await withBlock.json()) as { revision: number; reviewId: string; seeded: number }
    expect(body.seeded).toBe(2)

    const loaded = h.file.load()
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      const verdicts = loaded.value.records[0]?.reviewReports[0]?.verdicts
      expect(verdicts).toHaveLength(2)
      // proposed 是 host 铸的第三态；uuid 齐全；title/severity 来自块。
      expect(verdicts?.[0]).toEqual({ id: expect.any(String), title: '事务缺失', severity: 'high', verdict: 'proposed' })
      expect(verdicts?.[1]).toMatchObject({ title: '空指针', severity: 'medium', verdict: 'proposed' })
    }

    // 无约定块：报告照建，零种子，blockError 咨询位（不阻断）。
    const plain = await postReview(h, { requirementId: RID, expectedRevision: body.revision }, '# 纯 markdown 报告\n没有约定块。')
    expect(plain.status).toBe(200)
    const plainBody = (await plain.json()) as { reviewId: string; seeded: number; reviewBlockError?: string }
    expect(plainBody.seeded).toBe(0)
    expect(plainBody.reviewBlockError).toBe('no-review-block')
  })

  it('坏行走 skipped 不入库：severity 非法与超长 title 不种子（宁缺勿毒化账本）', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)])
    const mixed = [
      '```yaml',
      '# skyaxis-review',
      'findings:',
      '  - title: 好行',
      '    severity: low',
      '  - title: 坏严重度',
      '    severity: critical',
      `  - title: ${'x'.repeat(65)}`,
      '    severity: low',
      '```',
    ].join('\n')
    const res = await postReview(h, { requirementId: RID, expectedRevision: 1 }, mixed)
    const body = (await res.json()) as { seeded: number }
    expect(body.seeded).toBe(1) // 只有好行入库；两条坏行 skip（绝不截断写入）
    const loaded = h.file.load()
    if (loaded.ok) {
      expect(loaded.value.records[0]?.reviewReports[0]?.verdicts).toHaveLength(1)
      // 账本仍可读 = 没有毒化行落盘
      expect(loaded.ok).toBe(true)
    }
  })

  it('幂等锚收敛**不补种**：删掉种子行后重导同内容 → 同一报告、不复活已删行', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID)])
    const first = await postReview(h, { requirementId: RID, expectedRevision: 1, title: 'R' }, REVIEW_BODY)
    const firstBody = (await first.json()) as { revision: number; reviewId: string }
    expect(firstBody.revision).toBe(2)

    // 用户删掉一条种子裁决行（真删）。
    const loaded = h.file.load()
    if (!loaded.ok) throw new Error('fixture degraded')
    const reports = loaded.value.records[0]?.reviewReports ?? []
    const kept = reports.map((report) => ({ ...report, verdicts: report.verdicts.slice(1) }))
    await h.file.save(loaded.value.revision, [{ ...loaded.value.records[0]!, reviewReports: kept }])

    // 重导同样内容 → 收敛到同一 reviewId，且不复活被删的行。
    const retry = await postReview(h, { requirementId: RID, expectedRevision: 1, title: 'R' }, REVIEW_BODY)
    expect(retry.status).toBe(200)
    const retryBody = (await retry.json()) as { reviewId: string }
    expect(retryBody.reviewId).toBe(firstBody.reviewId)
    const after = h.file.load()
    expect(after.ok && after.value.records[0]?.reviewReports[0]?.verdicts).toHaveLength(1)
  })

  it('GET ?kind=review：engine 在场返回整条消息；缺席 → no-service；无块 → no-review-block', async () => {
    const h = await harness()
    const noEngine = await h.get(`${WORKBENCH_DECLARE_PATH}?kind=review&sessionId=sess-1`)
    expect(noEngine.status).toBe(200)
    expect(await noEngine.json()).toEqual({ ok: true, missing: 'no-service' })

    h.declareReader.setEngine({
      readSession: async () => ({ events: [{ type: 'assistant/message', seq: 1, time: 0, data: { message: { content: [{ type: 'text', text: REVIEW_BODY }] } } } as never] }),
    })
    const ok = await h.get(`${WORKBENCH_DECLARE_PATH}?kind=review&sessionId=sess-1`)
    const okBody = (await ok.json()) as { ok: true; text: string }
    expect(okBody.text).toContain('# 全量代码评审')
    expect(okBody.text).toContain('# skyaxis-review')

    h.declareReader.setEngine({
      readSession: async () => ({ events: [{ type: 'assistant/message', seq: 1, time: 0, data: { message: { content: [{ type: 'text', text: '没有块的收尾' }] } } } as never] }),
    })
    const missing = await h.get(`${WORKBENCH_DECLARE_PATH}?kind=review&sessionId=sess-1`)
    expect(await missing.json()).toEqual({ ok: true, missing: 'no-review-block' })
  })

  it('approveSplit 带 baseline：铸 splitBaseline（at 为 host 时间、prd 取上送、disposedFindings host 派生）；不带动作则 prd 空', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, {
      workPackages: [seedWorkPackage('WP1')],
      findings: [
        { id: FINDING_ID, category: 'risk', severity: 'low', title: '已处置', detail: '', status: 'resolved', createdAt: NOW },
        { id: GHOST, category: 'risk', severity: 'low', title: '未处置', detail: '', status: 'open', createdAt: NOW },
      ],
    })])
    const res = await h.post(WORKBENCH_PATH, {
      expectedRevision: 1, requirementId: RID, action: 'approveSplit',
      baseline: { prd: [{ name: 'prd.md', size: 100, modifiedAt: 1700000000000 }] },
    })
    expect(res.status).toBe(200)
    const record = ((await res.json()) as { record: WorkbenchRecord }).record
    expect(record.splitBaseline?.prd).toEqual([{ name: 'prd.md', size: 100, modifiedAt: 1700000000000 }])
    expect(record.splitBaseline?.disposedFindings).toBe(1) // host-derived：只有 resolved 那条
    expectIsoString(record.splitBaseline?.at)
    expect(record.splitBaseline?.at).toBe(record.splitApprovedAt)

    const plain = await h.post(WORKBENCH_PATH, { expectedRevision: 2, requirementId: RID, action: 'revokeSplitApproval' })
    expect(((await plain.json()) as { record: WorkbenchRecord }).record.splitBaseline).toBeUndefined() // revoke 一并摘基线
  })

  it('reSplit：未开工全归档为 dropped + 摘批准戳与基线；已开工 → 400 零残留；未批准 → 400', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, {
      splitApprovedAt: NOW,
      splitBaseline: { at: NOW, prd: [], disposedFindings: 0 },
      workPackages: [seedWorkPackage('WP1'), seedWorkPackage('WP2', { status: 'plan-approved' })],
    })])

    const res = await h.post(WORKBENCH_PATH, { expectedRevision: 1, requirementId: RID, action: 'reSplit' })
    expect(res.status).toBe(200)
    const record = ((await res.json()) as { record: WorkbenchRecord }).record
    expect(record.splitApprovedAt).toBeUndefined()
    expect(record.splitBaseline).toBeUndefined()
    expect(record.workPackages.map((workPackage) => workPackage.status)).toEqual(['dropped', 'dropped'])
    // 归档进 stageHistory 留痕（note: re-split）
    expect(record.stageHistory[record.stageHistory.length - 1]?.note).toBe('re-split')

    // 已开工（in-dev）→ 400 且账本零残留
    const h2 = await harness()
    await h2.seed([seedRecord(RID, {
      splitApprovedAt: NOW,
      workPackages: [seedWorkPackage('WP1'), seedWorkPackage('WP2', { status: 'in-dev' })],
    })])
    const blocked = await h2.post(WORKBENCH_PATH, { expectedRevision: 1, requirementId: RID, action: 'reSplit' })
    expect(blocked.status).toBe(400)
    expect(await errorCode(blocked)).toBe('bad-request')
    const after = h2.file.load()
    expect(after.ok && after.value.records[0]?.workPackages[1]?.status).toBe('in-dev')

    // 未批准 → 400
    const h3 = await harness()
    await h3.seed([seedRecord(RID, { workPackages: [seedWorkPackage('WP1')] })])
    const unapproved = await h3.post(WORKBENCH_PATH, { expectedRevision: 1, requirementId: RID, action: 'reSplit' })
    expect(unapproved.status).toBe(400)
  })

  it('confirmSplitStillValid：换基线（prd 取上送、disposedFindings host 派生；列表与批准戳不动）；未批准 → 400', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, {
      splitApprovedAt: NOW,
      splitBaseline: { at: NOW, prd: [{ name: 'prd.md', size: 1, modifiedAt: 1 }], disposedFindings: 0 },
      workPackages: [seedWorkPackage('WP1')],
      findings: [{ id: FINDING_ID, category: 'risk', severity: 'low', title: '已处置', detail: '', status: 'resolved', createdAt: NOW }],
    })])

    const res = await h.post(WORKBENCH_PATH, {
      expectedRevision: 1, requirementId: RID, action: 'confirmSplitStillValid',
      baseline: { prd: [{ name: 'prd.md', size: 999, modifiedAt: 2 }] },
    })
    expect(res.status).toBe(200)
    const record = ((await res.json()) as { record: WorkbenchRecord }).record
    expect(record.splitBaseline?.prd).toEqual([{ name: 'prd.md', size: 999, modifiedAt: 2 }])
    expect(record.splitBaseline?.disposedFindings).toBe(1) // host-derived from the current record
    expect(record.splitApprovedAt).toBe(NOW) // 批准戳不动
    expect(record.workPackages[0]?.status).toBe('planned') // 列表不动

    const h2 = await harness()
    await h2.seed([seedRecord(RID, { workPackages: [seedWorkPackage('WP1')] })])
    const unapproved = await h2.post(WORKBENCH_PATH, {
      expectedRevision: 1, requirementId: RID, action: 'confirmSplitStillValid',
      baseline: { prd: [] },
    })
    expect(unapproved.status).toBe(400)
  })

  it('saveReviewVerdict 幂等：同 payload 重提 → 200 且 revision 不增（P5b 补的唯一缺口）', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { reviewReports: [reviewEntry('rev-a1', { verdicts: [{ id: VERDICT_ID, title: 'x', severity: 'low', verdict: 'confirmed' }] })] })])
    const payload = {
      expectedRevision: 1, requirementId: RID, action: 'saveReviewVerdict', reportId: 'rev-a1',
      verdict: { id: VERDICT_ID, title: 'x', severity: 'low' as const, verdict: 'confirmed' as const },
    }
    const res = await h.post(WORKBENCH_PATH, payload)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { revision: number }).revision).toBe(1) // 未 bump
    const loaded = h.file.load()
    expect(loaded.ok && loaded.value.records[0]?.reviewReports[0]?.verdicts).toHaveLength(1)
  })

  it('客户端不能写 proposed：saveReviewVerdict 带 verdict:"proposed" → 400（输入 schema 二值，四权防线）', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, { reviewReports: [reviewEntry('rev-a1')] })])
    const res = await h.post(WORKBENCH_PATH, {
      expectedRevision: 1, requirementId: RID, action: 'saveReviewVerdict', reportId: 'rev-a1',
      verdict: { title: 'x', severity: 'low', verdict: 'proposed' },
    })
    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('bad-request')
  })
})
