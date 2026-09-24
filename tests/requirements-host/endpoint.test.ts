/**
 * Endpoint family against the real HostConnectionService (the repos-pool
 * PoC-2 Leg A construction): dispatch through createSharedFetchHandler('/api'),
 * real RequirementsFileStore on a temp dir.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { afterEach, describe, expect, it } from 'vitest'
import type { ErrorResponse, ListResponse } from '../../src/requirements-shared/protocol.js'
import { REQUIREMENTS_LIST_PATH, REQUIREMENTS_REMOVE_PATH, REQUIREMENTS_SAVE_PATH } from '../../src/requirements-shared/protocol.js'
import { registerRequirementsEndpoints } from '../../src/requirements-host/endpoint.js'
import { RequirementsFileStore } from '../../src/requirements-host/requirements-file.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'requirements-endpoint-test-'))
  dirs.push(dir)
  const file = new RequirementsFileStore(join(dir, 'requirements.yaml'))
  const ctx = new Context()
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], {} as never)
  })
  await fiber.await()
  const connection = ctx.get('connection') as HostConnectionHandle
  registerRequirementsEndpoints(connection, { file })
  const shared = connection.createSharedFetchHandler('/api')
  const base = 'http://127.0.0.1'
  const get = (path: string) => shared.fetch(new Request(base + path))
  const post = (path: string, body: unknown) =>
    shared.fetch(new Request(base + path, { method: 'POST', body: JSON.stringify(body) }))
  return { file, get, post, dispose: () => fiber.dispose() }
}

const SAVE_BODY = (title: string, description = '', id?: string) => ({
  expectedRevision: 0,
  requirement: { ...(id ? { id } : {}), title, description },
})

describe('requirements endpoints: list & save', () => {
  it('lists the pristine store as revision 0 with an empty array', async () => {
    const h = await harness()
    const res = await h.get(REQUIREMENTS_LIST_PATH)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ListResponse
    expect(body).toEqual({ ok: true, revision: 0, requirements: [] })
    await h.dispose()
  })

  it('creates a record (server-minted id, timestamps) and advances the revision', async () => {
    const h = await harness()
    const res = await h.post(REQUIREMENTS_SAVE_PATH, SAVE_BODY('支持多仓库并行检索', '说明'))
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: true; revision: number; requirement: { id: string; createdAt: string; updatedAt: string } }
    expect(body.ok).toBe(true)
    expect(body.revision).toBe(1)
    expect(body.requirement.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(typeof body.requirement.createdAt).toBe('string')
    expect(body.requirement.updatedAt).toBe(body.requirement.createdAt)

    const listed = await (await h.get(REQUIREMENTS_LIST_PATH)).json() as ListResponse
    expect(listed.ok && listed.requirements).toHaveLength(1)
    await h.dispose()
  })

  it('keeps createdAt and refreshes updatedAt on edits', async () => {
    const h = await harness()
    const created = await (await h.post(REQUIREMENTS_SAVE_PATH, SAVE_BODY('alpha'))).json() as { requirement: { id: string; createdAt: string } }
    const edit = await h.post(REQUIREMENTS_SAVE_PATH, {
      expectedRevision: 1,
      requirement: { id: created.requirement.id, title: 'alpha-renamed', description: 'x' },
    })
    expect(edit.status).toBe(200)
    const edited = (await edit.json()) as { requirement: { title: string; createdAt: string; updatedAt: string } }
    expect(edited.requirement.title).toBe('alpha-renamed')
    expect(edited.requirement.createdAt).toBe(created.requirement.createdAt)
    await new Promise((resolve) => setTimeout(resolve, 2))
    const editedAgain = await h.post(REQUIREMENTS_SAVE_PATH, {
      expectedRevision: 2,
      requirement: { id: created.requirement.id, title: 'alpha-again', description: '' },
    })
    const again = (await editedAgain.json()) as { requirement: { createdAt: string; updatedAt: string } }
    expect(again.requirement.updatedAt > again.requirement.createdAt).toBe(true)
    await h.dispose()
  })

  it('rejects empty titles with 400 (title enforced server-side via zod)', async () => {
    const h = await harness()
    const res = await h.post(REQUIREMENTS_SAVE_PATH, SAVE_BODY('   '))
    expect(res.status).toBe(400)
    expect(((await res.json()) as ErrorResponse).code).toBe('bad-request')
    await h.dispose()
  })

  it('rejects ghost edit ids with 404 and stale revisions with 409', async () => {
    const h = await harness()
    await h.post(REQUIREMENTS_SAVE_PATH, SAVE_BODY('a', 'a'))

    const ghost = await h.post(REQUIREMENTS_SAVE_PATH, {
      ...SAVE_BODY('c', 'c', '00000000-0000-4000-8000-000000000000'),
      expectedRevision: 1,
    })
    expect(ghost.status).toBe(404)
    expect(((await ghost.json()) as ErrorResponse).code).toBe('not-found')

    const stale = await h.post(REQUIREMENTS_SAVE_PATH, { ...SAVE_BODY('b', 'b'), expectedRevision: 0 })
    expect(stale.status).toBe(409)
    const staleBody = (await stale.json()) as ErrorResponse
    expect(staleBody.code).toBe('conflict')
    expect(staleBody.currentRevision).toBe(1)
    await h.dispose()
  })

  it('answers 400 on bad bodies and 404 on undeclared methods', async () => {
    const h = await harness()
    const bad = await h.post(REQUIREMENTS_SAVE_PATH, { nonsense: true })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as ErrorResponse).code).toBe('bad-request')

    const raw = await h.post(REQUIREMENTS_SAVE_PATH, undefined)
    expect(raw.status).toBe(400)

    const undeclared = await h.post(REQUIREMENTS_LIST_PATH, {})
    expect(undeclared.status).toBe(404)
    await h.dispose()
  })
})

describe('requirements endpoints: degraded file', () => {
  it('lists degraded envelopes and refuses writes over a corrupt file', async () => {
    const h = await harness()
    // Two saves so a .bak exists (backup is only taken when the main file exists).
    await h.post(REQUIREMENTS_SAVE_PATH, SAVE_BODY('a'))
    await h.post(REQUIREMENTS_SAVE_PATH, { ...SAVE_BODY('b'), expectedRevision: 1 })
    writeFileSync(h.file.filePath, 'broken: [', 'utf8')

    const listed = await (await h.get(REQUIREMENTS_LIST_PATH)).json() as ListResponse
    expect(listed).toEqual({ ok: false, degraded: true, reason: 'parse', hasBackup: true })

    const refused = await h.post(REQUIREMENTS_SAVE_PATH, { ...SAVE_BODY('c'), expectedRevision: 2 })
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as ErrorResponse).code).toBe('unreadable-file')
    await h.dispose()
  })
})

describe('requirements endpoints: remove', () => {
  it('removes by id under the revision guard', async () => {
    const h = await harness()
    const created = await (await h.post(REQUIREMENTS_SAVE_PATH, SAVE_BODY('a'))).json() as { requirement: { id: string } }
    const removed = await h.post(REQUIREMENTS_REMOVE_PATH, { expectedRevision: 1, id: created.requirement.id })
    expect(removed.status).toBe(200)
    const body = (await removed.json()) as { ok: true; revision: number }
    expect(body).toEqual({ ok: true, revision: 2 })

    const listed = await (await h.get(REQUIREMENTS_LIST_PATH)).json() as ListResponse
    expect(listed.ok && listed.requirements).toHaveLength(0)
    await h.dispose()
  })

  it('answers 404 for ghost ids and 409 for stale revisions', async () => {
    const h = await harness()
    const created = await (await h.post(REQUIREMENTS_SAVE_PATH, SAVE_BODY('a'))).json() as { requirement: { id: string } }

    const ghost = await h.post(REQUIREMENTS_REMOVE_PATH, { expectedRevision: 1, id: '00000000-0000-4000-8000-000000000000' })
    expect(ghost.status).toBe(404)

    const stale = await h.post(REQUIREMENTS_REMOVE_PATH, { expectedRevision: 0, id: created.requirement.id })
    expect(stale.status).toBe(409)
    expect(((await stale.json()) as ErrorResponse).code).toBe('conflict')
    await h.dispose()
  })
})
