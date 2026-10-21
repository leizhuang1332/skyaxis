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
import type { SessionEvent } from '@deepseek-ai/dsh-session'

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

async function harness(options: { resolveWorkspacePath?: (requirementId: string) => string } = {}) {
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
  registerWorkbenchEndpoints(connection, {
    file,
    knowledgeFile,
    workbenchRoot,
    declareReader,
    ...(options.resolveWorkspacePath !== undefined ? { resolveWorkspacePath: options.resolveWorkspacePath } : {}),
  })
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

  it('0023 D2-A/D4-A：criteriaChecks 播种（账本未知 ref 过滤）+ verdict 铸 detail + seededChecks 计数；幂等收敛不补种核验行', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, {
      criteria: [
        { id: 'C1', text: '十万行导出 30 秒内完成', coveredBy: ['WP1'] },
        { id: 'C2', text: '导出任务可取消', coveredBy: [] },
      ],
    })])
    const withBoth = [
      '```yaml',
      '# skyaxis-review',
      'criteriaChecks:',
      '  - ref: C1',
      '    result: satisfied',
      '    evidence: src/export/service.ts:30-42',
      '  - ref: C2',
      '    result: not-verifiable',
      '    evidence: 需人工在浏览器验证取消交互',
      '  - ref: C9',
      '    result: satisfied',
      'findings:',
      '  - title: 事务缺失',
      '    severity: high',
      '    detail: src/export/importer.ts:88 导入与校验不在同一事务',
      '```',
    ].join('\n')
    const res = await postReview(h, { requirementId: RID, expectedRevision: 1 }, withBoth)
    expect(res.status).toBe(200)
    const parsed = (await res.json()) as { revision: number; reviewId: string; seeded: number; seededChecks: number }
    expect(parsed.seeded).toBe(1)
    // C9 是账本未知 ref（解析合法但账本无此标准）→ 过滤不入账本（连带口径⑤）
    expect(parsed.seededChecks).toBe(2)

    const loaded = h.file.load()
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      const report = loaded.value.records[0]?.reviewReports[0]
      expect(report?.verdicts).toEqual([
        { id: expect.any(String), title: '事务缺失', severity: 'high', verdict: 'proposed', detail: 'src/export/importer.ts:88 导入与校验不在同一事务' },
      ])
      expect(report?.criteriaChecks).toEqual([
        { ref: 'C1', result: 'satisfied', evidence: 'src/export/service.ts:30-42' },
        { ref: 'C2', result: 'not-verifiable', evidence: '需人工在浏览器验证取消交互' },
      ])
      // 幂等收敛不补种（核验行推广同一纪律）：删核验行后重导同内容 → 同一报告、不复活
      const kept = [{ ...report!, criteriaChecks: undefined }]
      await h.file.save(loaded.value.revision, [{ ...loaded.value.records[0]!, reviewReports: kept }])
      const retry = await postReview(h, { requirementId: RID, expectedRevision: loaded.value.revision + 1 }, withBoth)
      const retryBody = (await retry.json()) as { reviewId: string; seeded?: number; seededChecks?: number }
      expect(retryBody.reviewId).toBe(parsed.reviewId)
      expect(retryBody.seeded).toBeUndefined()
      expect(retryBody.seededChecks).toBeUndefined()
      const after = h.file.load()
      expect(after.ok && after.value.records[0]?.reviewReports[0]?.criteriaChecks).toBeUndefined()
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

describe('回传轮：analysis proposals（bind / seed / adopt / dismiss）', () => {
  const assistantMsg = (text: string): SessionEvent =>
    ({ type: 'assistant/message', seq: 1, time: 0, data: { message: { content: [{ type: 'text', text }] } } }) as never as SessionEvent
  const declareFence = (rows: readonly string[]): string => '```yaml\n' + rows.join('\n') + '\n```'
  const REPORT_ROWS = [
    '# skyaxis-declare',
    'findings:',
    '  - category: conflict',
    '    severity: high',
    '    title: 与现有同步导出争用连接池',
    '    detail: 证据：PRD#3.2 / repos/a/src/B.java:120',
    '  - category: capacity',
    '    severity: low',
    '    title: 导出量级未量化',
    'criteria:',
    '  - text: 十万行导出 30 秒内完成',
    '    sourceSection: PRD#3.2',
    'knowledge: []',
    'stageReady: false',
  ]
  const body = (action: string, extra: Record<string, unknown>, expectedRevision: number, requirementId = RID) =>
    ({ expectedRevision, requirementId, action, ...extra })

  it('bind：record-null 隐式铸账建容器；同 sessionId unchanged 不 bump；异 sessionId 只换指针保留旧行', async () => {
    const h = await harness()
    const res1 = await h.post(WORKBENCH_PATH, body('bindAnalysisSession', { sessionId: 'sess-a' }, 0))
    expect(res1.status).toBe(200)
    const row1 = await res1.json() as { ok: boolean; revision: number; record: WorkbenchRecord }
    expect(row1.revision).toBe(1)
    expect(row1.record.analysis?.session).toMatchObject({ sessionId: 'sess-a' })
    expect(row1.record.analysis?.findings).toEqual([])
    expect(row1.record.stage).toBe('understand')

    const res2 = await h.post(WORKBENCH_PATH, body('bindAnalysisSession', { sessionId: 'sess-a' }, 1))
    const row2 = await res2.json() as { ok: boolean; revision: number }
    expect(row2.revision).toBe(1) // unchanged — no bump

    // Pointer swap keeps the old batch (the replacement window).
    await h.seed([seedRecord(RID, {
      analysis: {
        session: { sessionId: 'sess-a', boundAt: NOW },
        seed: { sessionId: 'sess-a', contentHash: 'a'.repeat(64), seededAt: NOW, findings: 1, criteria: 0 },
        findings: [{ id: '77777777-7777-4777-8777-777777777777', category: 'risk', severity: 'low', title: '旧行' }],
        criteria: [],
      },
    })], 1)
    const res3 = await h.post(WORKBENCH_PATH, body('bindAnalysisSession', { sessionId: 'sess-b' }, 2))
    const row3 = await res3.json() as { ok: boolean; record: WorkbenchRecord }
    expect(row3.record.analysis?.session.sessionId).toBe('sess-b')
    expect(row3.record.analysis?.findings).toHaveLength(1) // old batch survives
    expect(row3.record.analysis?.seed?.sessionId).toBe('sess-a') // anchor unchanged
  })

  it('seed：无 bind → 404；missing 引擎 → 200 零写零 bump；报告落账（行替换 + 锚 + hash）；同 hash 重放 unchanged 且已删行不复活；异 hash 新报告替换未裁决', async () => {
    const h = await harness()
    // No container yet.
    const res0 = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 0))
    expect(res0.status).toBe(404)
    expect(await errorCode(res0)).toBe('not-found')

    // Bind, then seed with NO engine → 200 zero-write, revision untouched,
    // with the advisory reason (回传轮 observability).
    await h.post(WORKBENCH_PATH, body('bindAnalysisSession', { sessionId: 'sess-a' }, 0))
    const resMissing = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 1))
    expect(resMissing.status).toBe(200)
    const missing = await resMissing.json() as { revision: number; record: WorkbenchRecord; seedMissing?: string }
    expect(missing.revision).toBe(1)
    expect(missing.record.analysis?.seed).toBeUndefined()
    expect(missing.seedMissing).toBe('no-service')

    // Engine present but the session has NO declare block → no-declare-block advisory + scan fingerprint.
    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantMsg('分析报告正文，但没写声明块。')] }) })
    const resNoBlock = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 1))
    const noBlock = await resNoBlock.json() as { seedMissing?: string; seedScan?: string }
    expect(noBlock.seedMissing).toBe('no-declare-block')
    expect(noBlock.seedScan).toContain('assistant/message:1')
    expect(noBlock.seedScan).toContain('markers=0')

    // Engine with the report → rows land + anchor stamped.
    const fenceBody = REPORT_ROWS.join('\n') + '\n'
    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantMsg('分析报告正文。\n' + declareFence(REPORT_ROWS))] }) })
    const resSeed = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 1))
    expect(resSeed.status).toBe(200)
    const seeded = await resSeed.json() as { revision: number; record: WorkbenchRecord }
    expect(seeded.revision).toBe(2)
    const container = seeded.record.analysis
    expect(container?.findings).toHaveLength(2)
    expect(container?.criteria).toHaveLength(1)
    expect(container?.findings[0]).toMatchObject({ category: 'conflict', severity: 'high', title: '与现有同步导出争用连接池' })
    expect(container?.criteria[0]).toMatchObject({ text: '十万行导出 30 秒内完成', sourceSection: 'PRD#3.2' })
    expect(container?.seed).toMatchObject({ sessionId: 'sess-a', contentHash: contentHashOf(fenceBody), findings: 2, criteria: 1 })

    // Dismiss a row, then REPLAY the same report → unchanged, no resurrection.
    const fid = container!.findings[0]!.id
    await h.post(WORKBENCH_PATH, body('dismissFindingProposal', { id: fid }, 2))
    const resReplay = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 3))
    const replay = await resReplay.json() as { revision: number; record: WorkbenchRecord }
    expect(replay.revision).toBe(3) // no bump on anchor hit
    expect(replay.record.analysis?.findings).toHaveLength(1) // deleted row stays deleted
    expect(replay.record.analysis?.criteria).toHaveLength(1)

    // A DIFFERENT report (hash differs) replaces the unadjudicated batch.
    const rows2 = ['# skyaxis-declare', 'findings:', '  - category: risk', '    severity: medium', '    title: 新报告的发现', 'criteria: []', 'stageReady: false']
    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantMsg(declareFence(rows2))] }) })
    const resNew = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 3))
    const renewed = await resNew.json() as { record: WorkbenchRecord }
    expect(renewed.record.analysis?.findings.map((row) => row.title)).toEqual(['新报告的发现'])
    expect(renewed.record.analysis?.criteria).toEqual([])

    // 裸尾巴兜底实链路（同 hash 体系末尾再换一次报告）：散文引子 + 无围栏块
    // ——实测 wild 形态（首版诊断根因）经兜底也能收取。
    const bareTail = '以下是声明块：\n# skyaxis-declare\nfindings:\n  - category: risk\n    severity: medium\n    title: 裸尾发现\ncriteria: []\nstageReady: false'
    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantMsg(bareTail)] }) })
    const resBare = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 4))
    const bare = await resBare.json() as { record: WorkbenchRecord }
    expect(bare.record.analysis?.findings.map((row) => row.title)).toEqual(['裸尾发现'])

    // 伪闭合线（```yaml 收尾）：未闭合 marker 围栏按尾体提取、剥掉结尾围栏标记行。
    const badCloser = '报告：\n```yaml\n# skyaxis-declare\nfindings:\n  - category: risk\n    severity: low\n    title: 闭合线写错\ncriteria: []\n```yaml'
    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantMsg(badCloser)] }) })
    const resBadCloser = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 5))
    const badCloserBody = await resBadCloser.json() as { record: WorkbenchRecord }
    expect(badCloserBody.record.analysis?.findings.map((row) => row.title)).toEqual(['闭合线写错'])
  })

  it('四次诊断 shell 修复：锚内容寻址真会话——改绑指针 + 种子一次落账、锚保留', async () => {
    const h = await harness()
    const ANCHOR = '# 分析任务书 · 短信账单扣费网点调整\n\n## 目标\n为需求「短信账单扣费网点调整」的需求理解阶段做一次只读分析'
    await h.post(WORKBENCH_PATH, body('bindAnalysisSession', { sessionId: 'session-shell', anchor: ANCHOR.slice(0, 200) }, 0))
    // The SHELL: config seeds only, no user/message, no declare block.
    const shellEvents = [
      { type: 'permission/preset', seq: 1, time: 0, data: {} },
      { type: 'sandbox/mode', seq: 2, time: 0, data: {} },
      { type: 'approval/policy', seq: 3, time: 0, data: {} },
      { type: 'session/end-seed', seq: 4, time: 0, data: {} },
    ] as never as SessionEvent[]
    // The REAL session: task book + report (bare tail, wild shape #1).
    const realRows = ['# skyaxis-declare', 'findings:', '  - category: conflict', '    severity: high', '    title: 真会话的发现', 'criteria: []', 'stageReady: false']
    const realEvents = [
      { type: 'user/message', seq: 1, time: 0, data: { content: [{ type: 'text', text: ANCHOR }] } },
      assistantMsg('分析报告。\n' + declareFence(realRows)),
    ] as never as SessionEvent[]
    let readCount = 0
    h.declareReader.setEngine({
      readSession: async (id: string) => {
        readCount += 1
        return { events: id === 'session-shell' ? shellEvents : realEvents }
      },
      searchSessions: async (request: { query: string }) => {
        expect(request.query).toContain('# 分析任务书 · 短信账单扣费网点调整')
        return { items: [{ header: { id: 'session-real', createdAt: 1791793257690 } }] }
      },
    })
    const res = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'session-shell' }, 1))
    expect(res.status).toBe(200)
    const seeded = await res.json() as { revision: number; record: WorkbenchRecord }
    expect(seeded.revision).toBe(2)
    // Pointer swapped to the repaired id; anchor preserved for future repairs.
    expect(seeded.record.analysis?.session.sessionId).toBe('session-real')
    expect(seeded.record.analysis?.session.anchor).toContain('# 分析任务书')
    expect(seeded.record.analysis?.findings.map((row) => row.title)).toEqual(['真会话的发现'])
    expect(readCount).toBe(2) // shell read + real read (the search is content-addressed, not a read)
  })

  it('seed：stale revision → 409（慢 IO 与插入写的乐观锁串行化）', async () => {
    const h = await harness()
    await h.post(WORKBENCH_PATH, body('bindAnalysisSession', { sessionId: 'sess-a' }, 0))
    const res = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 99))
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('conflict')
  })

  it('adopt finding：正式行 + sessionId 溯源（seed 锚）+ 提议删除；行缺 → 404；dismiss 二次点击 → 404', async () => {
    const h = await harness()
    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantMsg(declareFence(REPORT_ROWS))] }) })
    await h.post(WORKBENCH_PATH, body('bindAnalysisSession', { sessionId: 'sess-a' }, 0))
    await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 1))
    const seeded = (await (await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)).json() as { record: WorkbenchRecord }).record
    const fid = seeded.analysis!.findings[0]!.id

    const res = await h.post(WORKBENCH_PATH, body('adoptFindingProposal', { id: fid }, 2))
    expect(res.status).toBe(200)
    const adopted = await res.json() as { record: WorkbenchRecord }
    const formal = adopted.record.findings[0]!
    expect(formal).toMatchObject({ category: 'conflict', severity: 'high', title: '与现有同步导出争用连接池', detail: '证据：PRD#3.2 / repos/a/src/B.java:120', status: 'open' })
    expect(formal.sessionId).toBe('sess-a') // provenance unfolds from the batch anchor
    expect(formal.id).not.toBe(fid)          // fresh uuid — the findings-family habit
    expectIsoString(formal.createdAt)
    expect(adopted.record.analysis?.findings).toHaveLength(1)

    expect((await h.post(WORKBENCH_PATH, body('adoptFindingProposal', { id: fid }, 3))).status).toBe(404) // already consumed
    const did = adopted.record.analysis!.findings[0]!.id
    expect((await h.post(WORKBENCH_PATH, body('dismissFindingProposal', { id: did }, 3))).status).toBe(200)
    expect((await h.post(WORKBENCH_PATH, body('dismissFindingProposal', { id: did }, 4))).status).toBe(404)
  })

  it('adopt criterion：C 序号铸造 + 空覆盖；splitApprovedAt 存在 → 400 locked-split；dismiss 不受锁', async () => {
    const h = await harness()
    // Locked record carrying a pending criterion proposal.
    await h.seed([seedRecord(RID, {
      splitApprovedAt: NOW,
      criteria: [{ id: 'C1', text: '既有标准', coveredBy: [] }],
      analysis: {
        session: { sessionId: 'sess-a', boundAt: NOW },
        seed: { sessionId: 'sess-a', contentHash: 'b'.repeat(64), seededAt: NOW, findings: 0, criteria: 1 },
        findings: [],
        criteria: [{ id: '88888888-8888-4888-8888-888888888888', text: '待采标准', sourceSection: 'PRD#4' }],
      },
    })], 0)
    const cid = '88888888-8888-4888-8888-888888888888'
    const locked = await h.post(WORKBENCH_PATH, body('adoptCriterionProposal', { id: cid }, 1))
    expect(locked.status).toBe(400)
    expect(await errorCode(locked)).toBe('locked-split')
    // Dismiss is NOT hostage to the lock.
    expect((await h.post(WORKBENCH_PATH, body('dismissCriterionProposal', { id: cid }, 1))).status).toBe(200)

    // Unlock (re-seed a clean record) → adopt mints C2 after C1. The ledger
    // sits at revision 2 (seed 0→1, dismiss 1→2) — re-seed anchors there.
    await h.seed([seedRecord(RID, {
      criteria: [{ id: 'C1', text: '既有标准', coveredBy: [] }],
      analysis: {
        session: { sessionId: 'sess-a', boundAt: NOW },
        criteria: [{ id: cid, text: '待采标准', sourceSection: 'PRD#4' }],
        findings: [],
      },
    })], 2)
    const res = await h.post(WORKBENCH_PATH, body('adoptCriterionProposal', { id: cid }, 3))
    expect(res.status).toBe(200)
    const adopted = await res.json() as { record: WorkbenchRecord }
    expect(adopted.record.criteria.map((criterion) => criterion.id)).toEqual(['C1', 'C2'])
    expect(adopted.record.criteria[1]).toMatchObject({ text: '待采标准', sourceSection: 'PRD#4', coveredBy: [] })
    expect(adopted.record.analysis?.criteria).toEqual([])
  })
})

describe('文件交付轮：报告文件通道（file-first seed / analysis-report GET / 待澄清动作）', () => {
  const body = (action: string, extra: Record<string, unknown>, expectedRevision: number, requirementId = RID) =>
    ({ expectedRevision, requirementId, action, ...extra })
  const assistantMsg = (text: string): SessionEvent =>
    ({ type: 'assistant/message', seq: 1, time: 0, data: { message: { content: [{ type: 'text', text }] } } }) as never as SessionEvent

  /** A workspace with (null = without) the report file; the resolver closes over it. */
  function fileWorkspace(text: string | null): { dir: string; resolve: (requirementId: string) => string } {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-filechannel-test-'))
    dirs.push(dir)
    if (text !== null) {
      mkdirSync(join(dir, '.skyaxis', 'analysis'), { recursive: true })
      writeFileSync(join(dir, '.skyaxis', 'analysis', `${RID}.md`), text, 'utf8')
    }
    return { dir, resolve: () => dir }
  }

  const reportFile = (declareRows: readonly string[]): string =>
    ['# 分析报告', '', '## 1. 分析发现', 'F1 [冲突·高] 与现有同步导出争用连接池', '', '```yaml', ...declareRows, '```'].join('\n')

  it('file 命中：整份文件哈希锚 + 三组提议落账（会话引擎缺席也成立——通道独立于会话）；GET 正文 + 篡改披露', async () => {
    const text = reportFile([
      '# skyaxis-declare',
      'findings:',
      '  - category: conflict',
      '    severity: high',
      '    title: 与现有同步导出争用连接池',
      'criteria: []',
      'clarifications:',
      '  - question: 导出上限是十万行还是百万行？',
      '    recommendation: 百万行',
      '    blocks: F1',
      'knowledge: []',
      'stageReady: false',
    ])
    const ws = fileWorkspace(text)
    const h = await harness({ resolveWorkspacePath: ws.resolve })
    await h.post(WORKBENCH_PATH, body('bindAnalysisSession', { sessionId: 'sess-shell' }, 0))
    // NO declareReader engine at all — the file channel must stand alone.
    const res = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-shell' }, 1))
    expect(res.status).toBe(200)
    const seeded = await res.json() as { revision: number; record: WorkbenchRecord }
    expect(seeded.revision).toBe(2)
    const container = seeded.record.analysis
    expect(container?.findings).toHaveLength(1)
    expect(container?.clarifications).toEqual([
      { id: expect.any(String), question: '导出上限是十万行还是百万行？', recommendation: '百万行', blocks: 'F1' },
    ])
    // The disk-bytes sha256 of the WHOLE file is the idempotency anchor.
    expect(container?.seed).toMatchObject({ sessionId: 'sess-shell', contentHash: contentHashOf(text), findings: 1, criteria: 0, clarifications: 1, stageReady: false })

    // GET face: the body reads back untampered; an external edit flips the flag (细化④).
    const read1 = await h.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=analysis-report&requirementId=${RID}`)
    expect(read1.status).toBe(200)
    const body1 = await read1.json() as { ok: boolean; content: string; contentTampered: boolean }
    expect(body1.content).toContain('F1 [冲突·高]')
    expect(body1.contentTampered).toBe(false)
    writeFileSync(join(ws.dir, '.skyaxis', 'analysis', `${RID}.md`), `${text}\n<!-- edited -->`, 'utf8')
    const read2 = await h.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=analysis-report&requirementId=${RID}`)
    expect(((await read2.json()) as { contentTampered: boolean }).contentTampered).toBe(true)
  })

  it('file 缺失 → 回落会话链收取；双通道皆 miss 且文件通道在 ⇒ 披露 report-file-missing（headline 交换，指纹仍附）', async () => {
    const ws = fileWorkspace(null)
    const h = await harness({ resolveWorkspacePath: ws.resolve })
    const rows = ['# skyaxis-declare', 'findings:', '  - category: risk', '    severity: low', '    title: 会话兜底的发现', 'criteria: []', 'stageReady: false']
    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantMsg(`报告。\n\`\`\`yaml\n${rows.join('\n')}\n\`\`\``)] }) })
    await h.post(WORKBENCH_PATH, body('bindAnalysisSession', { sessionId: 'sess-a' }, 0))
    const res = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 1))
    const seeded = await res.json() as { record: WorkbenchRecord }
    expect(seeded.record.analysis?.findings.map((row) => row.title)).toEqual(['会话兜底的发现'])

    // Both channels miss (engine: no declare block) → the FILE reason is the headline.
    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantMsg('报告没写声明块。')] }) })
    const res2 = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 2))
    const miss = await res2.json() as { seedMissing?: string; seedScan?: string }
    expect(miss.seedMissing).toBe('report-file-missing')
    expect(miss.seedScan).toContain('markers=0')
  })

  it('file 语法坏（无围栏）→ report-file-syntax 零写；resolver 缺席 ⇒ 通道 unarmed 走原会话语义', async () => {
    const ws = fileWorkspace('# 报告\n没有声明块。')
    const h = await harness({ resolveWorkspacePath: ws.resolve })
    await h.post(WORKBENCH_PATH, body('bindAnalysisSession', { sessionId: 'sess-a' }, 0))
    const res = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 1))
    const miss = await res.json() as { seedMissing?: string; revision: number }
    expect(miss.seedMissing).toBe('report-file-syntax')
    expect(miss.revision).toBe(1) // zero-write, no bump

    // Unarmed (no resolver service): the session chain verbatim.
    const h2 = await harness()
    await h2.post(WORKBENCH_PATH, body('bindAnalysisSession', { sessionId: 'sess-a' }, 0))
    const res2 = await h2.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 1))
    expect(((await res2.json()) as { seedMissing?: string }).seedMissing).toBe('no-service')
  })

  it('answer/dismiss 待澄清：答案落行 + 重答原位更新 + 404/400 守卫；批替换保留已答行（用户状态权威）', async () => {
    const ws = fileWorkspace(reportFile([
      '# skyaxis-declare', 'findings: []', 'criteria: []',
      'clarifications:',
      '  - question: Q1 导出上限？',
      '    recommendation: 百万行',
    ]))
    const h = await harness({ resolveWorkspacePath: ws.resolve })
    await h.post(WORKBENCH_PATH, body('bindAnalysisSession', { sessionId: 'sess-a' }, 0))
    await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 1))
    const record1 = (await (await h.get(`${WORKBENCH_PATH}?requirementId=${RID}`)).json() as { record: WorkbenchRecord }).record
    const q1 = record1.analysis!.clarifications![0]!
    expect(q1).toMatchObject({ question: 'Q1 导出上限？', recommendation: '百万行' })

    const ans = await h.post(WORKBENCH_PATH, body('answerAnalysisClarification', { id: q1.id, answer: '按百万行' }, 2))
    expect(ans.status).toBe(200)
    const answered = (await ans.json()) as { record: WorkbenchRecord }
    expect(answered.record.analysis?.clarifications?.[0]).toMatchObject({ question: 'Q1 导出上限？', answer: '按百万行' })
    expectIsoString(answered.record.analysis?.clarifications?.[0]?.answeredAt)

    // Re-answer updates in place.
    const ans2 = await h.post(WORKBENCH_PATH, body('answerAnalysisClarification', { id: q1.id, answer: '改为十万行' }, 3))
    expect(((await ans2.json()) as { record: WorkbenchRecord }).record.analysis?.clarifications?.[0]?.answer).toBe('改为十万行')

    // Guards: unknown id → 404; blank answer → 400 (both zero-write).
    expect((await h.post(WORKBENCH_PATH, body('answerAnalysisClarification', { id: '99999999-9999-4999-8999-999999999999', answer: 'x' }, 4))).status).toBe(404)
    expect((await h.post(WORKBENCH_PATH, body('answerAnalysisClarification', { id: q1.id, answer: '   ' }, 4))).status).toBe(400)

    // A NEW report (new hash, new question): the ANSWERED Q1 survives the batch replace.
    writeFileSync(join(ws.dir, '.skyaxis', 'analysis', `${RID}.md`), reportFile([
      '# skyaxis-declare', 'findings: []', 'criteria: []',
      'clarifications:',
      '  - question: Q2 是否审计？',
    ]), 'utf8')
    const res = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 4))
    const renewed = (await res.json()) as { record: WorkbenchRecord }
    expect(renewed.record.analysis?.clarifications?.map((row) => [row.question, row.answer ?? null])).toEqual([
      ['Q1 导出上限？', '改为十万行'],
      ['Q2 是否审计？', null],
    ])

    // Dismiss cleans up — works on answered rows too (the manual exit).
    const q1Again = renewed.record.analysis?.clarifications?.[0]!.id
    expect((await h.post(WORKBENCH_PATH, body('dismissAnalysisClarification', { id: q1Again! }, 5))).status).toBe(200)
  })

  it('analysis-report GET：unarmed 通道 / 文件缺失 → 404（诚实缺失态，不造占位）', async () => {
    const h = await harness() // no resolver
    const res = await h.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=analysis-report&requirementId=${RID}`)
    expect(res.status).toBe(404)
    const ws = fileWorkspace(null)
    const h2 = await harness({ resolveWorkspacePath: ws.resolve })
    expect((await h2.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=analysis-report&requirementId=${RID}`)).status).toBe(404)
  })
})

describe('0007 定稿软门：approveUnderstand / revokeUnderstand + stageReady 透传', () => {
  const body = (action: string, extra: Record<string, unknown>, expectedRevision: number, requirementId = RID) =>
    ({ expectedRevision, requirementId, action, ...extra })
  const assistantMsg = (text: string): SessionEvent =>
    ({ type: 'assistant/message', seq: 1, time: 0, data: { message: { content: [{ type: 'text', text }] } } }) as never as SessionEvent

  it('approveUnderstand：隐式建账铸戳（全零定稿合法）→ 再定稿 400 → 撤销摘双键 → 再撤销 400；stale revision 409', async () => {
    const h = await harness()
    // No seeded record: the union's implicit-create semantics apply (an
    // all-zero finalize is the ratified skip path).
    const res1 = await h.post(WORKBENCH_PATH, body('approveUnderstand', {}, 0))
    expect(res1.status).toBe(200)
    const row1 = await res1.json() as { revision: number; record: WorkbenchRecord }
    expect(row1.revision).toBe(1)
    expectIsoString(row1.record.understandApprovedAt)
    expect(row1.record.understandBaseline?.criteria).toEqual([])

    const res2 = await h.post(WORKBENCH_PATH, body('approveUnderstand', {}, 1))
    expect(res2.status).toBe(400)

    const res3 = await h.post(WORKBENCH_PATH, body('revokeUnderstand', {}, 1))
    expect(res3.status).toBe(200)
    const row3 = await res3.json() as { revision: number; record: WorkbenchRecord }
    expect(row3.revision).toBe(2)
    expect(row3.record.understandApprovedAt).toBeUndefined()
    expect(row3.record.understandBaseline).toBeUndefined()

    expect((await h.post(WORKBENCH_PATH, body('revokeUnderstand', {}, 2))).status).toBe(400)

    // Stale revision → 409 with the current revision (the optimistic-lock family).
    const stale = await h.post(WORKBENCH_PATH, body('approveUnderstand', {}, 0))
    expect(stale.status).toBe(409)
  })

  it('有内容记录：定稿快照经 HTTP 落盘（criteria/findings 元信息/已答澄清）且盘上往返可读', async () => {
    const h = await harness()
    await h.seed([seedRecord(RID, {
      criteria: [{ id: 'C1', text: '导出走异步', sourceSection: 'PRD#3.1', coveredBy: [] }],
      findings: [{ id: FINDING_ID, category: 'risk', severity: 'low', title: '慢查询风险', detail: 't_order 无索引', status: 'open', createdAt: NOW }],
      analysis: {
        session: { sessionId: 'sess-a', boundAt: NOW },
        findings: [],
        criteria: [],
        clarifications: [
          { id: '99999999-9999-4999-8999-999999999999', question: '上限？', answer: '百万行', answeredAt: NOW },
        ],
      },
    })])
    const res = await h.post(WORKBENCH_PATH, body('approveUnderstand', {}, 1))
    expect(res.status).toBe(200)
    const row = (await res.json()) as { record: WorkbenchRecord }
    expect(row.record.understandBaseline).toEqual({
      at: row.record.understandApprovedAt,
      criteria: [{ id: 'C1', text: '导出走异步', sourceSection: 'PRD#3.1' }],
      findings: [{ id: FINDING_ID, status: 'open', category: 'risk', severity: 'low', title: '慢查询风险' }],
      clarifications: [{ question: '上限？', answer: '百万行' }],
    })
    // The ledger reloads with the new fields intact (the mirror-drift guard's e2e face).
    const loaded = h.file.load()
    expect(loaded.ok && loaded.value.records[0]?.understandBaseline?.criteria).toHaveLength(1)
  })

  it('stageReady 会话通道透传：true 落戳 → 新报告 false 随整戳换新（0007 收编断线）', async () => {
    const h = await harness()
    await h.post(WORKBENCH_PATH, body('bindAnalysisSession', { sessionId: 'sess-a' }, 0))
    const fence = (rows: readonly string[]): string => '```yaml\n' + rows.join('\n') + '\n```'
    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantMsg(fence(['# skyaxis-declare', 'findings: []', 'criteria: []', 'stageReady: true']))] }) })
    const res1 = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 1))
    const row1 = (await res1.json()) as { record: WorkbenchRecord }
    expect(row1.record.analysis?.seed?.stageReady).toBe(true)

    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantMsg(fence(['# skyaxis-declare', 'findings: []', 'criteria: []', 'stageReady: false']))] }) })
    const res2 = await h.post(WORKBENCH_PATH, body('seedAnalysis', { sessionId: 'sess-a' }, 2))
    const row2 = (await res2.json()) as { record: WorkbenchRecord }
    expect(row2.record.analysis?.seed?.stageReady).toBe(false)
  })
})

describe('0008 需求基线文档：approveUnderstand 专属 flow + requirement-doc 读面', () => {
  const body = (action: string, extra: Record<string, unknown>, expectedRevision: number, requirementId = RID) =>
    ({ expectedRevision, requirementId, action, ...extra })

  /** fileWorkspace 的 requirements/ 变体（0008 文件通道）。 */
  function docWorkspace(text: string | null): { dir: string; resolve: (requirementId: string) => string } {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-reqdoc-test-'))
    dirs.push(dir)
    if (text !== null) {
      mkdirSync(join(dir, '.skyaxis', 'requirements'), { recursive: true })
      writeFileSync(join(dir, '.skyaxis', 'requirements', `${RID}.md`), text, 'utf8')
    }
    return { dir, resolve: () => dir }
  }

  it('专属 flow：文件在 ⇒ docHash = 整份磁盘字节 sha256 落账；隐式建账 + 追加落盘（append 臂）；再定稿 400', async () => {
    const text = '# 需求基线 · 报价管理\n\n## 背景与目标\n……'
    const ws = docWorkspace(text)
    const h = await harness({ resolveWorkspacePath: ws.resolve })
    const res1 = await h.post(WORKBENCH_PATH, body('approveUnderstand', {}, 0))
    expect(res1.status).toBe(200)
    const row1 = await res1.json() as { revision: number; record: WorkbenchRecord }
    expect(row1.record.understandBaseline?.docHash).toBe(contentHashOf(text))
    // 盘上真有记录（append 臂——0008 修复点：commitSeedResponse 原为替换-only）。
    const loaded = h.file.load()
    expect(loaded.ok && loaded.value.records[0]?.understandBaseline?.docHash).toBe(contentHashOf(text))
    // 再定稿 400（approve 家族纪律经由专属 flow 照常生效）。
    expect((await h.post(WORKBENCH_PATH, body('approveUnderstand', {}, 1))).status).toBe(400)
  })

  it('软门：unarmed / 文件缺失 ⇒ 无 docHash 但定稿照旧成立（200 落盘）', async () => {
    const unarmed = await harness()
    const res1 = await unarmed.post(WORKBENCH_PATH, body('approveUnderstand', {}, 0))
    expect(res1.status).toBe(200)
    const row1 = await res1.json() as { record: WorkbenchRecord }
    expect(row1.record.understandBaseline?.docHash).toBeUndefined()

    const ws = docWorkspace(null) // 有工作区但文档缺失
    const h2 = await harness({ resolveWorkspacePath: ws.resolve })
    const res2 = await h2.post(WORKBENCH_PATH, body('approveUnderstand', {}, 0))
    expect(res2.status).toBe(200)
    const row2 = await res2.json() as { record: WorkbenchRecord }
    expect(row2.record.understandBaseline?.docHash).toBeUndefined()
  })

  it('too-large ⇒ 413（文件在但读不了——锚「无文档」是伪证，直披不回落）', async () => {
    const ws = docWorkspace('x'.repeat(2 * 1024 * 1024 + 1))
    const h = await harness({ resolveWorkspacePath: ws.resolve })
    const res = await h.post(WORKBENCH_PATH, body('approveUnderstand', {}, 0))
    expect(res.status).toBe(413)
  })

  it('requirement-doc GET：正文 + 未定稿读 untampered-silent + 定稿锚对照翻 contentTampered + 缺失 404', async () => {
    const text = '# 需求基线 · 报价管理\n\n## 术语表\n- 导出：……'
    const ws = docWorkspace(text)
    const h = await harness({ resolveWorkspacePath: ws.resolve })
    // 未定稿（无锚）⇒ 200 untampered-silent。
    const read1 = await h.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=requirement-doc&requirementId=${RID}`)
    expect(read1.status).toBe(200)
    const body1 = await read1.json() as { ok: boolean; content: string; contentTampered: boolean }
    expect(body1.content).toContain('## 术语表')
    expect(body1.contentTampered).toBe(false)
    // 定稿锚定后手改 ⇒ contentTampered（对照 understandBaseline.docHash）。
    await h.post(WORKBENCH_PATH, body('approveUnderstand', {}, 0))
    writeFileSync(join(ws.dir, '.skyaxis', 'requirements', `${RID}.md`), `${text}\n<!-- edited -->`, 'utf8')
    const read2 = await h.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=requirement-doc&requirementId=${RID}`)
    expect(((await read2.json()) as { contentTampered: boolean }).contentTampered).toBe(true)
    // 缺失 / unarmed ⇒ 404（诚实缺失态）。
    const ws2 = docWorkspace(null)
    const h2 = await harness({ resolveWorkspacePath: ws2.resolve })
    expect((await h2.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=requirement-doc&requirementId=${RID}`)).status).toBe(404)
    const h3 = await harness()
    expect((await h3.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=requirement-doc&requirementId=${RID}`)).status).toBe(404)
  })
})

describe('0012 两步化：adoptPlan / seedSplit 专属 flow + planning-doc / split-result 读面', () => {
  const body = (action: string, extra: Record<string, unknown>, expectedRevision: number, requirementId = RID) =>
    ({ expectedRevision, requirementId, action, ...extra })

  /** 0012 文件通道：planning/ 与 split/ 两目录按需写入（null = 目录空）。 */
  function channelWorkspace(files: { planning?: string | null; split?: string | null }): { dir: string; resolve: (requirementId: string) => string } {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-plan-split-test-'))
    dirs.push(dir)
    if (files.planning !== undefined && files.planning !== null) {
      mkdirSync(join(dir, '.skyaxis', 'planning'), { recursive: true })
      writeFileSync(join(dir, '.skyaxis', 'planning', `${RID}.md`), files.planning, 'utf8')
    }
    if (files.split !== undefined && files.split !== null) {
      mkdirSync(join(dir, '.skyaxis', 'split'), { recursive: true })
      writeFileSync(join(dir, '.skyaxis', 'split', `${RID}.md`), files.split, 'utf8')
    }
    return { dir, resolve: () => dir }
  }

  const SPLIT_FILE = [
    '# 拆分方案',
    '',
    '## 工作包清单',
    '',
    '```yaml',
    '# skyaxis-declare',
    'workPackages:',
    '  - ref: WP1',
    '    title: 数据校验',
    '    boundary: 只做校验',
    '    covers: [C1]',
    '  - ref: WP2',
    '    title: 数据导出',
    '    dependsOn: [WP1]',
    '    covers: [C9]',
    'stageReady: false',
    '```',
  ].join('\n')

  const splitContainer = (): Partial<WorkbenchRecord> => ({
    splitProposals: { session: { sessionId: 'sess-split', boundAt: NOW }, workPackages: [] },
  })

  it('adoptPlan 专属 flow：文件在 ⇒ docHash 落账 + 隐式建账 append；重复采纳 400；软门（unarmed/缺失 ⇒ 无锚采纳仍成立）', async () => {
    const text = '# 技术规划 · 报价导出\n\n## 现状盘点\n……'
    const ws = channelWorkspace({ planning: text })
    const h = await harness({ resolveWorkspacePath: ws.resolve })
    const res1 = await h.post(WORKBENCH_PATH, body('adoptPlan', {}, 0))
    expect(res1.status).toBe(200)
    const row1 = await res1.json() as { revision: number; record: WorkbenchRecord }
    expect(row1.record.planBaseline?.docHash).toBe(contentHashOf(text))
    const loaded = h.file.load()
    expect(loaded.ok && loaded.value.records[0]?.planAdoptedAt).toBeDefined() // append 臂盘上真有
    expect((await h.post(WORKBENCH_PATH, body('adoptPlan', {}, 1))).status).toBe(400)

    const unarmed = await harness()
    const res2 = await unarmed.post(WORKBENCH_PATH, body('adoptPlan', {}, 0))
    expect(res2.status).toBe(200)
    expect(((await res2.json()) as { record: WorkbenchRecord }).record.planBaseline?.docHash).toBeUndefined()
    const ws2 = channelWorkspace({ planning: null }) // 有工作区但文档缺失
    const h2 = await harness({ resolveWorkspacePath: ws2.resolve })
    const res3 = await h2.post(WORKBENCH_PATH, body('adoptPlan', {}, 0))
    expect(res3.status).toBe(200)
    expect(((await res3.json()) as { record: WorkbenchRecord }).record.planBaseline?.docHash).toBeUndefined()
  })

  it('adoptPlan too-large ⇒ 413；撤销采纳摘戳摘基线', async () => {
    const ws = channelWorkspace({ planning: 'x'.repeat(2 * 1024 * 1024 + 1) })
    const h = await harness({ resolveWorkspacePath: ws.resolve })
    expect((await h.post(WORKBENCH_PATH, body('adoptPlan', {}, 0))).status).toBe(413)
    const ws2 = channelWorkspace({ planning: '# 规划' })
    const h2 = await harness({ resolveWorkspacePath: ws2.resolve })
    await h2.post(WORKBENCH_PATH, body('adoptPlan', {}, 0))
    const revoked = await h2.post(WORKBENCH_PATH, body('revokePlanAdoption', {}, 1))
    expect(revoked.status).toBe(200)
    expect(((await revoked.json()) as { record: WorkbenchRecord }).record.planAdoptedAt).toBeUndefined()
  })

  it('planning-doc GET：采纳前 untampered-silent；采纳后手改 ⇒ contentTampered；缺失 ⇒ 404', async () => {
    const text = '# 技术规划\n\n## 技术方案\n……'
    const ws = channelWorkspace({ planning: text })
    const h = await harness({ resolveWorkspacePath: ws.resolve })
    const read1 = await h.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=planning-doc&requirementId=${RID}`)
    expect(read1.status).toBe(200)
    expect(((await read1.json()) as { content: string; contentTampered: boolean }).contentTampered).toBe(false)
    await h.post(WORKBENCH_PATH, body('adoptPlan', {}, 0))
    writeFileSync(join(ws.dir, '.skyaxis', 'planning', `${RID}.md`), `${text}\n<!-- edited -->`, 'utf8')
    const read2 = await h.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=planning-doc&requirementId=${RID}`)
    expect(((await read2.json()) as { contentTampered: boolean }).contentTampered).toBe(true)
    const ws2 = channelWorkspace({})
    const h2 = await harness({ resolveWorkspacePath: ws2.resolve })
    expect((await h2.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=planning-doc&requirementId=${RID}`)).status).toBe(404)
  })

  it('seedSplit：容器缺失 404；文件缺失 ⇒ 200 零写 seedMissing；文件在 ⇒ 提议落账（坏行跳过）+ 同 hash 重放 revision 不 bump + 手改（新 hash）替换未登记批', async () => {
    const ws = channelWorkspace({ split: SPLIT_FILE })
    const h = await harness({ resolveWorkspacePath: ws.resolve })
    // 容器缺失（未 bind）⇒ 404。
    await h.seed([seedRecord(RID, { criteria: [{ id: 'C1', text: 'C1', coveredBy: [] }] })])
    expect((await h.post(WORKBENCH_PATH, body('seedSplit', { sessionId: 'sess-split' }, 1))).status).toBe(404)

    const bound = await harness({ resolveWorkspacePath: ws.resolve })
    await bound.seed([seedRecord(RID, { criteria: [{ id: 'C1', text: 'C1', coveredBy: [] }], ...splitContainer() })])
    // 文件缺失通道 ⇒ 200 零写 + miss 理由。
    const wsEmpty = channelWorkspace({})
    const hEmpty = await harness({ resolveWorkspacePath: wsEmpty.resolve })
    await hEmpty.seed([seedRecord(RID, splitContainer())])
    const miss = await hEmpty.post(WORKBENCH_PATH, body('seedSplit', { sessionId: 'sess-split' }, 1))
    expect(miss.status).toBe(200)
    expect(((await miss.json()) as { seedMissing?: string }).seedMissing).toBe('split-file-missing')

    // 文件在 ⇒ 好行落账（WP2 的 covers C9 不存在 ⇒ 坏行跳过）。
    const seeded = await bound.post(WORKBENCH_PATH, body('seedSplit', { sessionId: 'sess-split' }, 1))
    expect(seeded.status).toBe(200)
    const row = await seeded.json() as { revision: number; record: WorkbenchRecord }
    expect(row.record.splitProposals?.workPackages.map((wpRow) => wpRow.ref)).toEqual(['WP1'])
    expect(row.record.splitProposals?.seed?.contentHash).toBe(contentHashOf(SPLIT_FILE))
    // 同 hash 重放 ⇒ unchanged（revision 不 bump）。
    const replay = await bound.post(WORKBENCH_PATH, body('seedSplit', { sessionId: 'sess-split' }, row.revision))
    expect(((await replay.json()) as { revision: number }).revision).toBe(row.revision)
    // 手改文件（新 hash）⇒ 整批替换。
    writeFileSync(join(ws.dir, '.skyaxis', 'split', `${RID}.md`), `${SPLIT_FILE}\n<!-- v2 -->`, 'utf8')
    const replaced = await bound.post(WORKBENCH_PATH, body('seedSplit', { sessionId: 'sess-split' }, row.revision))
    const row2 = await replaced.json() as { record: WorkbenchRecord }
    expect(row2.record.splitProposals?.seed?.contentHash).toBe(contentHashOf(`${SPLIT_FILE}\n<!-- v2 -->`))
  })

  it('验收驱动缺陷修复：approveSplit 的 PRD 快照 mtimeMs 带小数（NTFS 100ns 粒度常态）不再整包 400', async () => {
    // 实机 payload 复现：1791453084583.359 曾被 SplitBaselinePrdSchema 的
    // z.number().int() 拒绝——mtimeMs 天然分数，read 侧 wire guard 本就只查
    // number；输入面与存储面同步放宽（pre-0006 以来潜伏，首个带 PRD 的实机
    // 批准拆分踩中）。
    const h = await harness()
    await h.seed([seedRecord(RID, { criteria: [{ id: 'C1', text: 'C1', coveredBy: [] }], workPackages: [seedWorkPackage('WP1', { covers: ['C1'] })] })])
    const res = await h.post(WORKBENCH_PATH, body('approveSplit', {
      baseline: { prd: [{ name: '短信账单扣费网点调整需求.md', size: 11951, modifiedAt: 1791453084583.359 }] },
    }, 1))
    expect(res.status).toBe(200)
    const row = await res.json() as { record: WorkbenchRecord }
    expect(row.record.splitBaseline?.prd[0]?.modifiedAt).toBe(1791453084583.359)
  })

  it('seedSplit：无围栏 ⇒ split-file-syntax；会话不匹配 404；split-result GET tampered 对照 seed 锚', async () => {
    const noFence = channelWorkspace({ split: '# 拆分方案（无声明块）' })
    const h = await harness({ resolveWorkspacePath: noFence.resolve })
    await h.seed([seedRecord(RID, splitContainer())])
    const miss = await h.post(WORKBENCH_PATH, body('seedSplit', { sessionId: 'sess-split' }, 1))
    expect(((await miss.json()) as { seedMissing?: string }).seedMissing).toBe('split-file-syntax')
    expect((await h.post(WORKBENCH_PATH, body('seedSplit', { sessionId: 'sess-other' }, 1))).status).toBe(404)

    const ws = channelWorkspace({ split: SPLIT_FILE })
    const h2 = await harness({ resolveWorkspacePath: ws.resolve })
    await h2.seed([seedRecord(RID, { criteria: [{ id: 'C1', text: 'C1', coveredBy: [] }], ...splitContainer() })])
    const read1 = await h2.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=split-result&requirementId=${RID}`)
    expect(read1.status).toBe(200)
    expect(((await read1.json()) as { contentTampered: boolean }).contentTampered).toBe(false) // 未 seed ⇒ 无锚静默
    await h2.post(WORKBENCH_PATH, body('seedSplit', { sessionId: 'sess-split' }, 1))
    writeFileSync(join(ws.dir, '.skyaxis', 'split', `${RID}.md`), `${SPLIT_FILE}\n<!-- edited -->`, 'utf8')
    const read2 = await h2.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=split-result&requirementId=${RID}`)
    expect(((await read2.json()) as { contentTampered: boolean }).contentTampered).toBe(true)
    const ws2 = channelWorkspace({})
    const h3 = await harness({ resolveWorkspacePath: ws2.resolve })
    expect((await h3.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=split-result&requirementId=${RID}`)).status).toBe(404)
  })
})

describe('0018 工作包规划两步化：recordWpPlanSession / seedWpPlan 专属 flow + wp-plan-doc 读面', () => {
  const body = (action: string, extra: Record<string, unknown>, expectedRevision: number, requirementId = RID) =>
    ({ expectedRevision, requirementId, action, ...extra })

  /** 0018 文件通道：.skyaxis/wps/<wpId>/plan.md 按需写入（null = 不写）。 */
  function wpPlanWorkspace(files: { plan?: string | null }): { dir: string; resolve: (requirementId: string) => string } {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-wp-plan-test-'))
    dirs.push(dir)
    if (files.plan !== undefined && files.plan !== null) {
      mkdirSync(join(dir, '.skyaxis', 'wps', 'WP1'), { recursive: true })
      writeFileSync(join(dir, '.skyaxis', 'wps', 'WP1', 'plan.md'), files.plan, 'utf8')
    }
    return { dir, resolve: () => dir }
  }

  const PLAN_FILE = ['# 工作包计划 · WP1', '', '## 任务分解', '1. 通读边界内模块……'].join('\n')

  it('recordWpPlanSession ⇒ 指针落账；seedWpPlan：无记录 404；文件在 ⇒ v1 落账 + planned→plan-draft 同 save + planSeed 盖章；同 hash 重放 revision 不 bump；新 hash ⇒ 追加 v2；dropped 400', async () => {
    const ws = wpPlanWorkspace({ plan: PLAN_FILE })
    const h = await harness({ resolveWorkspacePath: ws.resolve })
    expect((await h.post(WORKBENCH_PATH, body('seedWpPlan', { workPackageId: 'WP1' }, 0))).status).toBe(404)

    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1')] })])
    const rec = await h.post(WORKBENCH_PATH, body('recordWpPlanSession', { workPackageId: 'WP1', sessionId: 'sess-plan' }, 1))
    expect(rec.status).toBe(200)
    const recRow = await rec.json() as { record: WorkbenchRecord }
    expect(recRow.record.workPackages[0]?.planSeed?.session?.sessionId).toBe('sess-plan')

    const seeded = await h.post(WORKBENCH_PATH, body('seedWpPlan', { workPackageId: 'WP1' }, 2))
    expect(seeded.status).toBe(200)
    const row = await seeded.json() as { revision: number; record: WorkbenchRecord }
    const wp1 = row.record.workPackages[0]
    expect(wp1?.plans.map((plan) => plan.version)).toEqual([1])
    expect(wp1?.plans[0]?.contentHash).toBe(contentHashOf(PLAN_FILE))
    expect(wp1?.status).toBe('plan-draft')
    expect(wp1?.planSeed?.contentHash).toBe(contentHashOf(PLAN_FILE)) // 哈希主锚在 planSeed（D8）
    // 同 hash 重放 ⇒ revision 不 bump（watcher 幂等）。
    const replay = await h.post(WORKBENCH_PATH, body('seedWpPlan', { workPackageId: 'WP1' }, row.revision))
    expect(((await replay.json()) as { revision: number }).revision).toBe(row.revision)
    // 会话重写文件（新 hash）⇒ 追加 v2——版本链记演进史（D3）。
    writeFileSync(join(ws.dir, '.skyaxis', 'wps', 'WP1', 'plan.md'), `${PLAN_FILE}\n<!-- v2 -->`, 'utf8')
    const reseeded = await h.post(WORKBENCH_PATH, body('seedWpPlan', { workPackageId: 'WP1' }, row.revision))
    const row2 = await reseeded.json() as { record: WorkbenchRecord }
    expect(row2.record.workPackages[0]?.plans.map((plan) => plan.version)).toEqual([1, 2])
    // dropped 且文件在场 ⇒ 400（收取门，devDeclare 同口径——纯核守卫经 flow 面透出）。
    const dropped = await harness({ resolveWorkspacePath: ws.resolve })
    await dropped.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1', { status: 'dropped' })] })])
    expect((await dropped.post(WORKBENCH_PATH, body('seedWpPlan', { workPackageId: 'WP1' }, 1))).status).toBe(400)
    // 无此工作包 ⇒ 404（磁盘 IO 前的前置查，split 容器前查同款）。
    expect((await dropped.post(WORKBENCH_PATH, body('seedWpPlan', { workPackageId: 'WP9' }, 1))).status).toBe(404)
  })

  it('缺陷修复（刀一验收漏面）：seed 同步落盘 artifacts 存储——GET kind=plan 可读正文（与工作区文件一致、untampered）；unchanged 重放补写收敛（删存储文件后重放 ⇒ 恢复且 revision 不 bump）', async () => {
    const ws = wpPlanWorkspace({ plan: PLAN_FILE })
    const h = await harness({ resolveWorkspacePath: ws.resolve })
    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1')] })])
    const seeded = await h.post(WORKBENCH_PATH, body('seedWpPlan', { workPackageId: 'WP1' }, 1))
    expect(seeded.status).toBe(200)
    const row = await seeded.json() as { revision: number; record: WorkbenchRecord }
    expect(row.record.workPackages[0]?.plans.map((plan) => plan.version)).toEqual([1])
    // 落盘断言：存储体在场且正文=工作区文件（此前 seed 只落账本——每个收取版必然「计划文件缺失」）。
    const artifactTarget = planDocPath(h.workbenchRoot, RID, 'WP1', 1)
    expect(existsSync(artifactTarget)).toBe(true)
    expect(readFileSync(artifactTarget, 'utf8')).toBe(PLAN_FILE)
    const read = await h.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=plan&requirementId=${RID}&workPackageId=WP1&version=1`)
    expect(read.status).toBe(200)
    const content = await read.json() as { content: string; contentTampered: boolean }
    expect(content.content).toBe(PLAN_FILE)
    expect(content.contentTampered).toBe(false)
    // unchanged 收敛臂：删存储文件（模拟写入中断/存量缺陷）后同哈希重放 ⇒ 补写、revision 不 bump。
    rmSync(artifactTarget)
    const replay = await h.post(WORKBENCH_PATH, body('seedWpPlan', { workPackageId: 'WP1' }, row.revision))
    expect(((await replay.json()) as { revision: number }).revision).toBe(row.revision)
    expect(existsSync(artifactTarget)).toBe(true)
    expect(readFileSync(artifactTarget, 'utf8')).toBe(PLAN_FILE)
  })

  it('seedWpPlan：文件缺失 ⇒ 200 零写 wp-plan-file-missing（armed 空目录与 unarmed 同形）；wp-plan-doc GET：seed 前 untampered-silent、seed 后手改 ⇒ contentTampered、缺失 404、坏 wpId 400', async () => {
    // armed 但目录空（会话可能尚未写完——advisory，不失败）。
    const wsEmpty = wpPlanWorkspace({})
    const hEmpty = await harness({ resolveWorkspacePath: wsEmpty.resolve })
    await hEmpty.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1')] })])
    const miss = await hEmpty.post(WORKBENCH_PATH, body('seedWpPlan', { workPackageId: 'WP1' }, 1))
    expect(miss.status).toBe(200)
    expect(((await miss.json()) as { seedMissing?: string }).seedMissing).toBe('wp-plan-file-missing')
    // unarmed（无 resolveWorkspacePath）⇒ 同一 miss（无工作区即无文件）。
    const hUnarmed = await harness()
    await hUnarmed.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1')] })])
    const miss2 = await hUnarmed.post(WORKBENCH_PATH, body('seedWpPlan', { workPackageId: 'WP1' }, 1))
    expect(((await miss2.json()) as { seedMissing?: string }).seedMissing).toBe('wp-plan-file-missing')

    // wp-plan-doc 读面：seed 前文件先行可读、untampered；seed 后手改 ⇒ tampered。
    const ws = wpPlanWorkspace({ plan: PLAN_FILE })
    const h = await harness({ resolveWorkspacePath: ws.resolve })
    await h.seed([seedRecord(RID, { splitApprovedAt: NOW, workPackages: [seedWorkPackage('WP1')] })])
    const read1 = await h.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=wp-plan-doc&requirementId=${RID}&workPackageId=WP1`)
    expect(read1.status).toBe(200)
    expect(((await read1.json()) as { content: string; contentTampered: boolean }).contentTampered).toBe(false)
    await h.post(WORKBENCH_PATH, body('seedWpPlan', { workPackageId: 'WP1' }, 1))
    writeFileSync(join(ws.dir, '.skyaxis', 'wps', 'WP1', 'plan.md'), `${PLAN_FILE}\n<!-- edited -->`, 'utf8')
    const read2 = await h.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=wp-plan-doc&requirementId=${RID}&workPackageId=WP1`)
    expect(((await read2.json()) as { contentTampered: boolean }).contentTampered).toBe(true)
    // 缺失 ⇒ 404；坏 WP 号 ⇒ 400。
    expect((await h.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=wp-plan-doc&requirementId=${RID}&workPackageId=WP9`)).status).toBe(404)
    expect((await h.get(`${WORKBENCH_ARTIFACTS_PATH}?kind=wp-plan-doc&requirementId=${RID}&workPackageId=bad`)).status).toBe(400)
  })
})

describe('0016 P1a: seedDevDeclare flow + devDeclare-keyed import + adjudicateDevDeclare', () => {
  const devFence = (wp: string, extra: readonly string[] = []): string =>
    '```yaml\n' + ['# skyaxis-declare', `workPackage: ${wp}`, 'claims:', '  - built: true', ...extra].join('\n') + '\n```'
  const assistantText = (text: string): SessionEvent =>
    ({ type: 'assistant/message', seq: 1, time: 0, data: { message: { content: [{ type: 'text', text }] } } }) as unknown as SessionEvent
  const devRecord = (overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord =>
    seedRecord(RID, {
      splitApprovedAt: NOW,
      workPackages: [seedWorkPackage('WP1', {
        status: 'in-dev',
        sessions: [{ sessionId: 'sess-dev', purpose: 'dev', boundAt: NOW }],
      })],
      ...overrides,
    })

  it('seedDevDeclare: lands a keyed pending slot + writes the workspace pending snapshot; ledger-only when unarmed', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'workbench-declare-ws-'))
    dirs.push(workspace)
    const armed = await harness({ resolveWorkspacePath: () => workspace })
    const revision = await armed.seed([devRecord()])
    armed.declareReader.setEngine({ readSession: async () => ({ events: [assistantText(devFence('WP1')) as never] }) })
    const res = await armed.post(WORKBENCH_PATH, { expectedRevision: revision, requirementId: RID, action: 'seedDevDeclare', workPackageId: 'WP1' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; record: WorkbenchRecord; devSeedMissing?: string }
    expect(body.devSeedMissing).toBeUndefined()
    const slot = body.record.devDeclares?.WP1
    expect(slot?.adjudication).toBe('pending')
    expect(slot?.seed.sessionId).toBe('sess-dev')
    // The pending snapshot carries the exact fence body; its disk sha equals the slot anchor
    const pendingPath = join(workspace, '.skyaxis', 'declares', RID, 'WP1-pending.md')
    expect(existsSync(pendingPath)).toBe(true)
    expect(contentHashOf(readFileSync(pendingPath, 'utf8'))).toBe(slot?.seed.contentHash)
    // Unarmed (no resolver): the slot still lands, no snapshot, honest degrade
    const bare = await harness()
    const rev2 = await bare.seed([devRecord()])
    bare.declareReader.setEngine({ readSession: async () => ({ events: [assistantText(devFence('WP1')) as never] }) })
    const res2 = await bare.post(WORKBENCH_PATH, { expectedRevision: rev2, requirementId: RID, action: 'seedDevDeclare', workPackageId: 'WP1' })
    const body2 = (await res2.json()) as { ok: true; record: WorkbenchRecord }
    expect(body2.record.devDeclares?.WP1?.adjudication).toBe('pending')
  })

  it('seedDevDeclare misses: no-binding / wp-not-in-dev / wp-mismatch / no-declare-block — 200 zero-write with the disclosed reason', async () => {
    const h = await harness()
    const post = async (revision: number, wpId: string, requirementId: string = RID) =>
      (await (await h.post(WORKBENCH_PATH, { expectedRevision: revision, requirementId, action: 'seedDevDeclare', workPackageId: wpId })).json()) as { ok: true; devSeedMissing?: string; record?: WorkbenchRecord }
    // no binding (WP2 has none)
    let revision = await h.seed([seedRecord(RID, {
      splitApprovedAt: NOW,
      workPackages: [
        seedWorkPackage('WP1', { status: 'in-dev', sessions: [{ sessionId: 'sess-dev', purpose: 'dev', boundAt: NOW }] }),
        seedWorkPackage('WP2', { status: 'in-dev' }),
      ],
    })])
    expect((await post(revision, 'WP2')).devSeedMissing).toBe('no-binding')
    // wp-not-in-dev is GONE (三修): collection lands for built WPs too; the
    // IMPORT path (markWorkPackageBuilt) enforces the state machine.
    revision = await h.seed([devRecord({ workPackages: [seedWorkPackage('WP1', { status: 'built', sessions: [{ sessionId: 'sess-dev', purpose: 'dev', boundAt: NOW }] })] })], revision)
    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantText(devFence('WP1')) as never] }) })
    const builtSeed = (await (await h.post(WORKBENCH_PATH, { expectedRevision: revision, requirementId: RID, action: 'seedDevDeclare', workPackageId: 'WP1' })).json()) as { ok: true; revision: number; devSeedMissing?: string; record: WorkbenchRecord }
    expect(builtSeed.devSeedMissing).toBeUndefined()
    expect(builtSeed.record.devDeclares?.WP1?.adjudication).toBe('pending')
    revision = builtSeed.revision // the seed wrote — track the fresh revision
    // wp-mismatch (the fence names WP9)
    revision = await h.seed([devRecord()], revision)
    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantText(devFence('WP9')) as never] }) })
    expect((await post(revision, 'WP1')).devSeedMissing).toBe('wp-mismatch')
    // no-declare-block — a REAL session (user message present) whose declare
    // is not written yet; the assistant-only log would read as a shell.
    h.declareReader.setEngine({ readSession: async () => ({ events: [
      { type: 'user/message', seq: 0, time: 0, data: { content: [{ type: 'text', text: '# 工作包任务书 WP1' }] } } as never,
      assistantText('干活中，没有声明块') as never,
    ] }) })
    expect((await post(revision, 'WP1')).devSeedMissing).toBe('no-declare-block')
    // 404s: record / WP absent
    const ghost = await h.post(WORKBENCH_PATH, { expectedRevision: revision, requirementId: GHOST, action: 'seedDevDeclare', workPackageId: 'WP1' })
    expect(ghost.status).toBe(404)
    const ghostWp = await h.post(WORKBENCH_PATH, { expectedRevision: revision, requirementId: RID, action: 'seedDevDeclare', workPackageId: 'WP7' })
    expect(ghostWp.status).toBe(404)
  })

  it('seedDevDeclare anchor hit: same session + hash → unchanged (no bump, no miss) + pending-file repair', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'workbench-declare-ws-'))
    dirs.push(workspace)
    const h = await harness({ resolveWorkspacePath: () => workspace })
    const revision = await h.seed([devRecord()])
    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantText(devFence('WP1')) as never] }) })
    const first = (await (await h.post(WORKBENCH_PATH, { expectedRevision: revision, requirementId: RID, action: 'seedDevDeclare', workPackageId: 'WP1' })).json()) as { ok: true; revision: number; record: WorkbenchRecord }
    const pendingPath = join(workspace, '.skyaxis', 'declares', RID, 'WP1-pending.md')
    // Corrupt the pending file, then replay: anchor hit converges and REPAIRS the file
    writeFileSync(pendingPath, '被外部改坏了')
    const replay = await h.post(WORKBENCH_PATH, { expectedRevision: first.revision, requirementId: RID, action: 'seedDevDeclare', workPackageId: 'WP1' })
    const replayBody = (await replay.json()) as { ok: true; revision: number; record: WorkbenchRecord; devSeedMissing?: string }
    expect(replayBody.devSeedMissing).toBeUndefined()
    expect(replayBody.revision).toBe(first.revision) // unchanged — no revision bump
    expect(contentHashOf(readFileSync(pendingPath, 'utf8'))).toBe(replayBody.record.devDeclares?.WP1?.seed.contentHash)
  })

  it('declare import with the devDeclare key: preview advisory declareStale; commit stamps slot + receipt + d1 file atomically; scope mismatch 400', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'workbench-declare-ws-'))
    dirs.push(workspace)
    const h = await harness({ resolveWorkspacePath: () => workspace })
    const revision = await h.seed([devRecord()])
    // Seed the slot with content A…
    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantText(devFence('WP1', ['stageReady: false'])) as never] }) })
    const seeded = (await (await h.post(WORKBENCH_PATH, { expectedRevision: revision, requirementId: RID, action: 'seedDevDeclare', workPackageId: 'WP1' })).json()) as { ok: true; revision: number; record: WorkbenchRecord }
    // …then present content B for import: preview discloses declareStale
    const otherText = devFence('WP1', ['stageReady: false', "# a drift line"])
    const stalePreview = await h.post(WORKBENCH_DECLARE_PATH, { expectedRevision: seeded.revision, requirementId: RID, dryRun: true, text: otherText, devDeclare: { workPackageId: 'WP1' } })
    expect(stalePreview.status).toBe(200)
    expect(((await stalePreview.json()) as { declareStale?: boolean }).declareStale).toBe(true)
    // The slot's own text previews clean
    const goodText = readFileSync(join(workspace, '.skyaxis', 'declares', RID, 'WP1-pending.md'), 'utf8')
    const cleanPreview = await h.post(WORKBENCH_DECLARE_PATH, { expectedRevision: seeded.revision, requirementId: RID, dryRun: true, text: goodText, devDeclare: { workPackageId: 'WP1' } })
    const cleanPreviewBody = (await cleanPreview.json()) as { declareStale?: boolean; revision: number; entries: { key: string }[] }
    expect(cleanPreviewBody.declareStale).toBeUndefined()
    // Scope mismatch: the key names WP2 while the fence scopes WP1 → 400
    const mismatch = await h.post(WORKBENCH_DECLARE_PATH, { expectedRevision: seeded.revision, requirementId: RID, dryRun: true, text: goodText, devDeclare: { workPackageId: 'WP2' } })
    expect(mismatch.status).toBe(400)
    // Commit: built row + slot flip + receipt + d1 file, all in one save
    const commit = await h.post(WORKBENCH_DECLARE_PATH, {
      expectedRevision: cleanPreviewBody.revision,
      requirementId: RID,
      text: goodText,
      selected: cleanPreviewBody.entries.map((entry) => entry.key),
      sessionId: 'sess-dev',
      devDeclare: { workPackageId: 'WP1' },
    })
    expect(commit.status).toBe(200)
    const committed = (await commit.json()) as { ok: true; revision: number; record: WorkbenchRecord; report: { built: number } }
    expect(committed.report.built).toBe(1)
    expect(committed.record.workPackages[0]!.status).toBe('built')
    expect(committed.record.devDeclares?.WP1?.adjudication).toBe('imported')
    expect(committed.record.workPackages[0]!.declarations?.[0]?.seq).toBe(1)
    expect(committed.record.workPackages[0]!.declarations?.[0]?.sessionId).toBe('sess-dev')
    const receiptPath = join(workspace, '.skyaxis', 'declares', RID, 'WP1-d1.md')
    expect(existsSync(receiptPath)).toBe(true)
    expect(contentHashOf(readFileSync(receiptPath, 'utf8'))).toBe(committed.record.devDeclares?.WP1?.seed.contentHash)
  })


  it('刀一验收二修：shell 绑定 → searchSessions 内容寻址真实会话（SOW 头行锚，标题无关）→ 绑定+收取一气呵成', async () => {
    const h = await harness()
    const revision = await h.seed([devRecord()]) // WP1 in-dev + shell binding sess-dev
    h.declareReader.setEngine({
      readSession: async (id: string) => {
        if (id === 'sess-dev') return { events: [] as never[] } // config-only shell：无 user 消息、无声明块
        return { events: [assistantText(devFence('WP1')) as never] }
      },
      searchSessions: async () => ({ items: [{ header: { id: 'sess-real', createdAt: 5 } }] }),
    })
    const res = await h.post(WORKBENCH_PATH, { expectedRevision: revision, requirementId: RID, action: 'seedDevDeclare', workPackageId: 'WP1' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; record: WorkbenchRecord; devSeedMissing?: string }
    expect(body.devSeedMissing).toBeUndefined()
    expect(body.record.devDeclares?.WP1?.seed.sessionId).toBe('sess-real')
    expect(body.record.workPackages[0]!.sessions.some((row) => row.sessionId === 'sess-real' && row.purpose === 'dev')).toBe(true)
    // shell 行保留（append-only），真实行追加为最新 dev 绑定
    expect(body.record.workPackages[0]!.sessions.some((row) => row.sessionId === 'sess-dev')).toBe(true)
  })

  it('0021 渲染轮：新锚 miss ⇒ legacy 锚兜底（在途旧标题会话）；两锚皆 miss ⇒ no-binding 如实披露', async () => {
    const h = await harness()
    const revision = await h.seed([devRecord()]) // WP1 in-dev + shell binding sess-dev
    const queries: string[] = []
    h.declareReader.setEngine({
      readSession: async (id: string) => {
        if (id === 'sess-dev') return { events: [] as never[] }
        return { events: [assistantText(devFence('WP1')) as never] }
      },
      searchSessions: async (request: { query: string }) => {
        queries.push(request.query)
        // 新形锚空手、legacy 锚命中——兜底臂。
        if (request.query.includes('skyaxis')) return { items: [{ header: { id: 'sess-legacy', createdAt: 5 } }] }
        return { items: [] }
      },
    })
    const res = await h.post(WORKBENCH_PATH, { expectedRevision: revision, requirementId: RID, action: 'seedDevDeclare', workPackageId: 'WP1' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; record: WorkbenchRecord; devSeedMissing?: string }
    expect(queries).toEqual(['# 工作包任务书 WP1', '# skyaxis 工作包任务书 WP1'])
    expect(body.devSeedMissing).toBeUndefined()
    expect(body.record.devDeclares?.WP1?.seed.sessionId).toBe('sess-legacy')

    // 两锚皆 miss ⇒ honest no-binding（不误绑）。
    h.declareReader.setEngine({
      readSession: async () => ({ events: [] as never[] }),
      searchSessions: async () => ({ items: [] }),
    })
    const miss = await h.post(WORKBENCH_PATH, { expectedRevision: body.revision, requirementId: RID, action: 'seedDevDeclare', workPackageId: 'WP1' })
    expect(miss.status).toBe(200)
    const missBody = (await miss.json()) as { devSeedMissing?: string }
    expect(missBody.devSeedMissing).toBe('no-binding')
  })

  it('刀一验收三修：无绑定的 planned WP 寻址绑定 + 收取一气呵成（in-dev 门仅守导入）', async () => {
    const h = await harness()
    const revision = await h.seed([seedRecord(RID, {
      splitApprovedAt: NOW,
      workPackages: [seedWorkPackage('WP1', { status: 'planned', sessions: [] })],
    })])
    h.declareReader.setEngine({
      readSession: async () => ({ events: [assistantText(devFence('WP1')) as never] }),
      searchSessions: async () => ({ items: [{ header: { id: 'sess-real-planned', createdAt: 5 } }] }),
    })
    const res = await h.post(WORKBENCH_PATH, { expectedRevision: revision, requirementId: RID, action: 'seedDevDeclare', workPackageId: 'WP1' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; record: WorkbenchRecord; devSeedMissing?: string }
    // 关联 + 收取都落账（三修：collection is information-gathering）
    expect(body.record.workPackages[0]!.sessions.some((row) => row.sessionId === 'sess-real-planned' && row.purpose === 'dev')).toBe(true)
    expect(body.devSeedMissing).toBeUndefined()
    expect(body.record.devDeclares?.WP1?.adjudication).toBe('pending')
    // 但 markWorkPackageBuilt（导入路径）仍要求 in-dev——四权不变
    const importAttempt = await h.post(WORKBENCH_PATH, { expectedRevision: body.revision, requirementId: RID, action: 'markWorkPackageBuilt', id: 'WP1' })
    expect(importAttempt.status).toBe(400)
  })

  it('adjudicateDevDeclare (union): dismiss lands on a pending slot; missing slot 404', async () => {
    const h = await harness()
    h.declareReader.setEngine({ readSession: async () => ({ events: [assistantText(devFence('WP1')) as never] }) })
    const revision = await h.seed([devRecord()])
    const seeded = (await (await h.post(WORKBENCH_PATH, { expectedRevision: revision, requirementId: RID, action: 'seedDevDeclare', workPackageId: 'WP1' })).json()) as { ok: true; revision: number }
    const dismissed = await h.post(WORKBENCH_PATH, { expectedRevision: seeded.revision, requirementId: RID, action: 'adjudicateDevDeclare', workPackageId: 'WP1', adjudication: 'dismissed' })
    expect(dismissed.status).toBe(200)
    const body = (await dismissed.json()) as { ok: true; revision: number; record: WorkbenchRecord }
    expect(body.record.devDeclares?.WP1?.adjudication).toBe('dismissed')
    const noSlot = await h.post(WORKBENCH_PATH, { expectedRevision: body.revision, requirementId: RID, action: 'adjudicateDevDeclare', workPackageId: 'WP2', adjudication: 'dismissed' })
    expect(noSlot.status).toBe(404)
  })
})
