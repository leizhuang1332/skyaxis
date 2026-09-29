/**
 * knowledge.yaml 路由全矩阵（0006 P2）：/api/skyaxis/workbench/knowledge，
 * in-process 派发（真 HostConnectionService + createSharedFetchHandler('/api')
 * + temp 目录真 KnowledgeFileStore，endpoint.test.ts 同款 harness）。覆盖：
 *   - GET ?requirementId=：scope==='requirement' 命中 ∪ scope==='global'
 *     （workspace 行不返回；异需求行不返回；双状态都通行——active/archived），
 *     账本降级 ⇒ 200 降级信封（非 409），坏/缺 uuid ⇒ 400
 *   - POST saveKnowledge create：铸 uuid + status active + provenance 仅 {at}、
 *     keyword/path trigger 归一化（value trim；keyword/path 无 value ⇒ 400）
 *   - POST saveKnowledge edit：未知 id 404、全字段替换、status/provenance
 *     承接旧值（archived 不被重置）、scope 变更合法（旧 scope 键剥离）
 *   - POST archiveKnowledge：404、active → archived、已 archived 幂等跳存
 *     （revision 不增）
 *   - 乐观锁与账本面：stale ⇒ 409 conflict + currentRevision、损坏账本 ⇒
 *     409 unreadable-file、schema 违例 ⇒ 400
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { afterEach, describe, expect, it } from 'vitest'
import type { ErrorResponse, WorkbenchKnowledgeRecord } from '../../src/workbench-shared/protocol.js'
import { WORKBENCH_KNOWLEDGE_PATH } from '../../src/workbench-shared/protocol.js'
import { KnowledgeFileStore } from '../../src/workbench-host/knowledge-file.js'
import { registerWorkbenchKnowledgeEndpoints } from '../../src/workbench-host/knowledge-endpoint.js'

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
const RID_UPPER = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'
const ID_REQ = '33333333-3333-4333-8333-333333333333'
const ID_GLOBAL = '44444444-4444-4444-8444-444444444444'
const ID_WS = '55555555-5555-4555-8555-555555555555'
const ID_REQ2 = '66666666-6666-4666-8666-666666666666'
const ID_ARCHIVED = '77777777-7777-4777-8777-777777777777'
const AT = '2026-09-29T08:00:00.000Z'

function row(id: string, scope: 'global' | 'workspace' | 'requirement', overrides: Partial<WorkbenchKnowledgeRecord> = {}): WorkbenchKnowledgeRecord {
  return {
    id,
    scope,
    type: 'business',
    title: `知识-${id}`,
    content: '内容',
    ...(scope === 'workspace' ? { path: 'C:/repos/main' } : {}),
    ...(scope === 'requirement' ? { requirementId: RID } : {}),
    trigger: { mode: 'always' },
    status: 'active',
    provenance: { at: AT },
    ...overrides,
  }
}

async function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-knowledge-endpoint-test-'))
  dirs.push(dir)
  const file = new KnowledgeFileStore(join(dir, 'knowledge.yaml'))
  const ctx = new Context()
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], {} as never)
  })
  await fiber.await()
  const connection = ctx.get('connection') as HostConnectionHandle
  const logs: unknown[] = []
  registerWorkbenchKnowledgeEndpoints(connection, { file, log: (error) => { logs.push(error) } })
  const shared = connection.createSharedFetchHandler('/api')
  disposables.push(() => fiber.dispose())
  const get = (query = '') => shared.fetch(new Request(BASE + WORKBENCH_KNOWLEDGE_PATH + query))
  const post = (body: unknown) =>
    shared.fetch(new Request(BASE + WORKBENCH_KNOWLEDGE_PATH, { method: 'POST', body: JSON.stringify(body) }))
  const seed = async (rows: readonly WorkbenchKnowledgeRecord[]) => {
    const saved = await file.save(0, [...rows])
    if (!saved.ok) throw new Error(`seed failed: ${JSON.stringify(saved)}`)
    return saved.revision
  }
  const current = () => {
    const load = file.load()
    if (!load.ok) throw new Error(`knowledge ledger degraded in fixture: ${JSON.stringify(load)}`)
    return load.value
  }
  return { file, dir, logs, get, post, seed, current }
}

type Harness = Awaited<ReturnType<typeof harness>>

const errorCode = async (res: Response) => ((await res.json()) as ErrorResponse).code

// ---------------------------------------------------------------------------
// GET /api/skyaxis/workbench/knowledge?requirementId=
// ---------------------------------------------------------------------------

describe('GET /api/skyaxis/workbench/knowledge', () => {
  it('过滤三面：requirement 命中 ∪ global；workspace 行与异需求行不返回；archived 也通行（双状态，客户端自滤）', async () => {
    const h = await harness()
    await h.seed([
      row(ID_REQ, 'requirement'),
      row(ID_GLOBAL, 'global'),
      row(ID_WS, 'workspace'),
      row(ID_REQ2, 'requirement', { requirementId: RID2 }),
      row(ID_ARCHIVED, 'requirement', { status: 'archived' }),
    ])

    const res = await h.get(`?requirementId=${RID}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; records: WorkbenchKnowledgeRecord[] }
    expect(body.ok).toBe(true)
    expect(body.revision).toBe(1)
    expect(body.records.map((record) => record.id)).toEqual([ID_REQ, ID_GLOBAL, ID_ARCHIVED])
  })

  it('写入后 GET 反映新行（create → list 往返）', async () => {
    const h = await harness()
    const created = await h.post({
      expectedRevision: 0,
      action: 'saveKnowledge',
      knowledge: { scope: 'requirement', requirementId: RID, type: 'convention', title: '异步导出约定', content: '大表禁止全量拉取', trigger: { mode: 'always' } },
    })
    expect(created.status).toBe(200)

    const res = await h.get(`?requirementId=${RID}`)
    const body = (await res.json()) as { ok: true; revision: number; records: WorkbenchKnowledgeRecord[] }
    expect(body.records).toHaveLength(1)
    expect(body.records[0]?.title).toBe('异步导出约定')
    expect(body.records[0]?.scope).toBe('requirement')
  })

  it('账本降级 ⇒ 200 降级信封（读降级不报错，非 409）', async () => {
    const h = await harness()
    writeFileSync(h.file.filePath, 'broken: [', 'utf8')

    const res = await h.get(`?requirementId=${RID}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, degraded: true, reason: 'parse', hasBackup: false })
  })

  it('缺 requirementId / 坏 uuid / 大写 uuid ⇒ 400 bad-request', async () => {
    const h = await harness()
    expect((await h.get()).status).toBe(400) // 参数缺席
    expect((await h.get('?requirementId=')).status).toBe(400) // 空串
    expect((await h.get('?requirementId=not-a-uuid')).status).toBe(400)
    expect((await h.get(`?requirementId=${RID_UPPER}`)).status).toBe(400) // 小写 only
  })
})

// ---------------------------------------------------------------------------
// POST saveKnowledge — create
// ---------------------------------------------------------------------------

describe('POST knowledge — saveKnowledge create', () => {
  it('无 id = create：铸 uuid、status active、provenance 仅 {at}、keyword value trim 落盘', async () => {
    const h = await harness()
    const res = await h.post({
      expectedRevision: 0,
      action: 'saveKnowledge',
      knowledge: { scope: 'requirement', requirementId: RID, type: 'convention', title: '异步导出约定', content: '大表禁止全量拉取', trigger: { mode: 'keyword', value: '  导出  ' } },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; record: WorkbenchKnowledgeRecord }
    expect(body.revision).toBe(1)
    expect(body.record.id).toMatch(UUID_RE)
    expect(body.record.status).toBe('active')
    expect(body.record.trigger).toEqual({ mode: 'keyword', value: '导出' })
    expect(body.record.provenance).toEqual({ at: expect.any(String) })
    expect('sessionId' in body.record.provenance).toBe(false)

    const persisted = h.current()
    expect(persisted.revision).toBe(1)
    expect(persisted.records).toHaveLength(1)
    expect(persisted.records[0]?.id).toBe(body.record.id)
  })

  it('workspace create：path trim 落盘', async () => {
    const h = await harness()
    const res = await h.post({
      expectedRevision: 0,
      action: 'saveKnowledge',
      knowledge: { scope: 'workspace', path: '  C:/repos/main  ', type: 'business', title: '工作区约定', content: 'c', trigger: { mode: 'always' } },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { record: WorkbenchKnowledgeRecord }
    expect(body.record.path).toBe('C:/repos/main')
    expect(h.current().records[0]?.path).toBe('C:/repos/main')
  })

  it('守卫 400：workspace 缺 path / 空白 path、requirement 缺 requirementId、keyword 与 path 模式缺 value / 空白 value —— 且零落盘', async () => {
    const h = await harness()
    const badBodies: unknown[] = [
      { expectedRevision: 0, action: 'saveKnowledge', knowledge: { scope: 'workspace', type: 'business', title: 't', content: 'c', trigger: { mode: 'always' } } },
      { expectedRevision: 0, action: 'saveKnowledge', knowledge: { scope: 'workspace', path: '   ', type: 'business', title: 't', content: 'c', trigger: { mode: 'always' } } },
      { expectedRevision: 0, action: 'saveKnowledge', knowledge: { scope: 'requirement', type: 'business', title: 't', content: 'c', trigger: { mode: 'always' } } },
      { expectedRevision: 0, action: 'saveKnowledge', knowledge: { scope: 'global', type: 'business', title: 't', content: 'c', trigger: { mode: 'keyword' } } },
      { expectedRevision: 0, action: 'saveKnowledge', knowledge: { scope: 'global', type: 'business', title: 't', content: 'c', trigger: { mode: 'keyword', value: '   ' } } },
      { expectedRevision: 0, action: 'saveKnowledge', knowledge: { scope: 'global', type: 'business', title: 't', content: 'c', trigger: { mode: 'path' } } },
    ]
    for (const body of badBodies) {
      const res = await h.post(body)
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('bad-request')
    }
    expect(h.current().records).toHaveLength(0) // 被拒写入零残留
  })
})

// ---------------------------------------------------------------------------
// POST saveKnowledge — edit（有 id = 全字段替换）
// ---------------------------------------------------------------------------

describe('POST knowledge — saveKnowledge edit', () => {
  it('未知 id ⇒ 404 not-found', async () => {
    const h = await harness()
    await h.seed([row(ID_GLOBAL, 'global')])
    const res = await h.post({
      expectedRevision: 1,
      action: 'saveKnowledge',
      knowledge: { id: ID_WS, scope: 'global', type: 'business', title: 'x', content: 'c', trigger: { mode: 'always' } },
    })
    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('not-found')
  })

  it('全字段替换 + status/provenance 承接旧值（archived 不被重置回 active）；scope 变更后旧键剥离（requirement → global）', async () => {
    const h = await harness()
    await h.seed([row(ID_REQ, 'requirement', { status: 'archived', provenance: { requirementId: RID, sessionId: 'sess-1', at: AT } })])

    const res = await h.post({
      expectedRevision: 1,
      action: 'saveKnowledge',
      knowledge: { id: ID_REQ, scope: 'global', type: 'convention', title: '新标题', content: '新内容', trigger: { mode: 'manual' } },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; record: WorkbenchKnowledgeRecord }
    expect(body.revision).toBe(2)
    expect(body.record.status).toBe('archived') // store-owned，承接不重置
    expect(body.record.provenance).toEqual({ requirementId: RID, sessionId: 'sess-1', at: AT }) // 同上
    expect(body.record.scope).toBe('global')
    expect(body.record.title).toBe('新标题')
    expect(body.record.content).toBe('新内容')
    expect(body.record.trigger).toEqual({ mode: 'manual' })
    expect('path' in body.record).toBe(false) // 旧 scope 键不残留（响应面）
    expect('requirementId' in body.record).toBe(false)

    const persisted = h.current().records[0] // 落盘面同样不残留
    expect(persisted.path).toBeUndefined()
    expect(persisted.requirementId).toBeUndefined()
  })

  it('scope global → requirement 变更合法：requirementId 落位，按 id replace 不重复追加', async () => {
    const h = await harness()
    await h.seed([row(ID_GLOBAL, 'global')])

    const res = await h.post({
      expectedRevision: 1,
      action: 'saveKnowledge',
      knowledge: { id: ID_GLOBAL, scope: 'requirement', requirementId: RID2, type: 'business', title: '知识-x', content: '内容', trigger: { mode: 'always' } },
    })
    expect(res.status).toBe(200)
    const persisted = h.current()
    expect(persisted.records).toHaveLength(1)
    expect(persisted.records[0]?.scope).toBe('requirement')
    expect(persisted.records[0]?.requirementId).toBe(RID2)
    expect(persisted.records[0]?.id).toBe(ID_GLOBAL)
  })

  it('scope global → workspace 变更合法：path 落位', async () => {
    const h = await harness()
    await h.seed([row(ID_GLOBAL, 'global')])

    const res = await h.post({
      expectedRevision: 1,
      action: 'saveKnowledge',
      knowledge: { id: ID_GLOBAL, scope: 'workspace', path: 'C:/repos/other', type: 'business', title: '知识-x', content: '内容', trigger: { mode: 'always' } },
    })
    expect(res.status).toBe(200)
    const persisted = h.current().records[0]
    expect(persisted.scope).toBe('workspace')
    expect(persisted.path).toBe('C:/repos/other')
    expect(persisted.requirementId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// POST archiveKnowledge
// ---------------------------------------------------------------------------

describe('POST knowledge — archiveKnowledge', () => {
  it('未知 id ⇒ 404 not-found', async () => {
    const h = await harness()
    await h.seed([row(ID_GLOBAL, 'global')])
    const res = await h.post({ expectedRevision: 1, action: 'archiveKnowledge', id: ID_WS })
    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('not-found')
  })

  it('active → archived：落盘 + revision 增，响应带回 archived 行', async () => {
    const h = await harness()
    await h.seed([row(ID_GLOBAL, 'global')]) // revision 1

    const res = await h.post({ expectedRevision: 1, action: 'archiveKnowledge', id: ID_GLOBAL })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; record: WorkbenchKnowledgeRecord }
    expect(body.revision).toBe(2)
    expect(body.record.status).toBe('archived')

    const persisted = h.current()
    expect(persisted.revision).toBe(2)
    expect(persisted.records[0]?.status).toBe('archived')
  })

  it('已 archived 二次归档 ⇒ 幂等跳存：200 + revision 不增（不产生新账）', async () => {
    const h = await harness()
    await h.seed([row(ID_GLOBAL, 'global')]) // revision 1
    const first = await h.post({ expectedRevision: 1, action: 'archiveKnowledge', id: ID_GLOBAL })
    expect(first.status).toBe(200)
    expect(((await first.json()) as { revision: number }).revision).toBe(2)

    const second = await h.post({ expectedRevision: 2, action: 'archiveKnowledge', id: ID_GLOBAL })
    expect(second.status).toBe(200)
    const body = (await second.json()) as { ok: true; revision: number; record: WorkbenchKnowledgeRecord }
    expect(body.revision).toBe(2) // revision 不增
    expect(body.record.status).toBe('archived')
    expect(h.current().revision).toBe(2) // 落盘面确认零写入
  })
})

// ---------------------------------------------------------------------------
// 乐观锁与账本面
// ---------------------------------------------------------------------------

describe('POST knowledge — 乐观锁 / 账本面', () => {
  it('stale expectedRevision ⇒ 409 conflict + currentRevision', async () => {
    const h = await harness()
    await h.seed([row(ID_GLOBAL, 'global')]) // revision 1

    const res = await h.post({
      expectedRevision: 0,
      action: 'saveKnowledge',
      knowledge: { scope: 'global', type: 'business', title: 'x', content: 'c', trigger: { mode: 'always' } },
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as ErrorResponse
    expect(body.code).toBe('conflict')
    expect(body.currentRevision).toBe(1)
  })

  it('账本损坏 ⇒ 409 unreadable-file（写路径保现场，零写入）', async () => {
    const h = await harness()
    await h.seed([row(ID_GLOBAL, 'global')])
    writeFileSync(h.file.filePath, 'broken: [', 'utf8')

    const res = await h.post({ expectedRevision: 1, action: 'archiveKnowledge', id: ID_GLOBAL })
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('unreadable-file')
  })

  it('schema 违例（未知 action）⇒ 400 bad-request', async () => {
    const h = await harness()
    const res = await h.post({ expectedRevision: 0, action: 'teleport' })
    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('bad-request')
  })
})
