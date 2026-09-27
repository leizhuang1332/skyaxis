/**
 * Endpoint family against the real HostConnectionService (the repos-pool
 * PoC-2 Leg A construction): dispatch through createSharedFetchHandler('/api'),
 * real RequirementsFileStore on a temp dir.
 */
import { mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ErrorResponse, ListResponse } from '../../src/requirements-shared/protocol.js'
import {
  REQUIREMENTS_LIST_PATH,
  REQUIREMENTS_REMOVE_PATH,
  REQUIREMENTS_SAVE_PATH,
  REQUIREMENTS_WORKSPACE_PATH,
} from '../../src/requirements-shared/protocol.js'
import { registerRequirementsEndpoints } from '../../src/requirements-host/endpoint.js'
import { RequirementsFileStore } from '../../src/requirements-host/requirements-file.js'
import { RequirementWorkspaceBinder } from '../../src/requirements-host/workspace.js'
import type { WorkspaceRegistryLike } from '../../src/requirements-host/workspace.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** Minimal structural registry fake — create is recorded and mirrors the list (fakeGit precedent). */
function fakeRegistry() {
  const rows: { readonly path: string }[] = []
  const create = vi.fn(async (path: string, _title?: string) => {
    if (!rows.some((row) => row.path === path)) rows.push({ path })
    return { path }
  })
  const registry = { create, list: () => rows }
  return { registry: registry as unknown as WorkspaceRegistryLike, create, rows }
}

async function harness(options?: { registry?: WorkspaceRegistryLike }) {
  const dir = mkdtempSync(join(tmpdir(), 'requirements-endpoint-test-'))
  dirs.push(dir)
  const file = new RequirementsFileStore(join(dir, 'requirements.yaml'))
  const workspaces = new RequirementWorkspaceBinder()
  if (options?.registry !== undefined) workspaces.setRegistry(options.registry)
  const ctx = new Context()
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], {} as never)
  })
  await fiber.await()
  const connection = ctx.get('connection') as HostConnectionHandle
  registerRequirementsEndpoints(connection, { file, workspaces })
  const shared = connection.createSharedFetchHandler('/api')
  const base = 'http://127.0.0.1'
  const get = (path: string) => shared.fetch(new Request(base + path))
  const post = (path: string, body: unknown) =>
    shared.fetch(new Request(base + path, { method: 'POST', body: JSON.stringify(body) }))
  return { file, dir, workspaces, get, post, dispose: () => fiber.dispose() }
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

describe('requirements endpoints: workspace binding', () => {
  async function createRecord(h: Awaited<ReturnType<typeof harness>>, title: string) {
    const res = await h.post(REQUIREMENTS_SAVE_PATH, SAVE_BODY(title))
    return (await res.json()) as { requirement: { id: string; title: string } }
  }

  it('answers unbound status with a host-computed suggested path', async () => {
    const h = await harness()
    const created = await createRecord(h, 'Support Multi Repo Search')
    const res = await h.get(`${REQUIREMENTS_WORKSPACE_PATH}?id=${created.requirement.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: true; bound: boolean; path: string; directoryExists: boolean; registered: boolean; suggestedPath: string
    }
    expect(body.bound).toBe(false)
    expect(body.path).toBe('')
    expect(body.directoryExists).toBe(false)
    expect(body.suggestedPath).toContain('skyaxis')
    expect(body.suggestedPath).toContain('workspaces')
    expect(body.suggestedPath).toContain('support-multi-repo-search')
    await h.dispose()
  })

  it('set binds a created directory: canonical path persisted, registry.create called, yaml round-trips', async () => {
    const fake = fakeRegistry()
    const h = await harness({ registry: fake.registry })
    const created = await createRecord(h, 'alpha')
    const target = join(h.dir, 'ws')

    const res = await h.post(REQUIREMENTS_WORKSPACE_PATH, {
      expectedRevision: 1, id: created.requirement.id, action: 'set', path: target,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; requirement: { workspacePath: string } }
    const canonical = realpathSync(target)
    expect(body.requirement.workspacePath).toBe(canonical)
    expect(fake.create).toHaveBeenCalledWith(canonical)

    const status = await (await h.get(`${REQUIREMENTS_WORKSPACE_PATH}?id=${created.requirement.id}`)).json() as {
      bound: boolean; directoryExists: boolean; registered: boolean
    }
    expect(status.bound).toBe(true)
    expect(status.directoryExists).toBe(true)
    expect(status.registered).toBe(true)
    await h.dispose()
  })

  it('re-binding the same path advances the revision (registry idempotency absorbs the duplicate create)', async () => {
    const fake = fakeRegistry()
    const h = await harness({ registry: fake.registry })
    const created = await createRecord(h, 'alpha')
    const target = join(h.dir, 'ws')
    await h.post(REQUIREMENTS_WORKSPACE_PATH, { expectedRevision: 1, id: created.requirement.id, action: 'set', path: target })
    const again = await h.post(REQUIREMENTS_WORKSPACE_PATH, {
      expectedRevision: 2, id: created.requirement.id, action: 'set', path: target,
    })
    expect(again.status).toBe(200)
    expect(((await again.json()) as { revision: number }).revision).toBe(3)
    await h.dispose()
  })

  it('rejects relative paths and file targets with 400 invalid-path and no revision bump', async () => {
    const h = await harness()
    const created = await createRecord(h, 'alpha')
    const fileTarget = join(h.dir, 'plain-file')
    writeFileSync(fileTarget, 'x', 'utf8')

    for (const bad of ['relative/ws', fileTarget]) {
      const res = await h.post(REQUIREMENTS_WORKSPACE_PATH, {
        expectedRevision: 1, id: created.requirement.id, action: 'set', path: bad,
      })
      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorResponse).code).toBe('invalid-path')
    }
    const listed = await (await h.get(REQUIREMENTS_LIST_PATH)).json() as ListResponse
    expect(listed.ok && listed.revision).toBe(1)
    await h.dispose()
  })

  it('stores the ledger path even without a registry (registered:false, degraded composition)', async () => {
    const h = await harness()
    const created = await createRecord(h, 'alpha')
    const target = join(h.dir, 'ws')
    const res = await h.post(REQUIREMENTS_WORKSPACE_PATH, {
      expectedRevision: 1, id: created.requirement.id, action: 'set', path: target,
    })
    expect(res.status).toBe(200)
    const status = await (await h.get(`${REQUIREMENTS_WORKSPACE_PATH}?id=${created.requirement.id}`)).json() as {
      registered: boolean; bound: boolean
    }
    expect(status.bound).toBe(true)
    expect(status.registered).toBe(false)
    await h.dispose()
  })

  it('guards stale revisions before any disk side effect and answers 404 for ghost ids', async () => {
    const fake = fakeRegistry()
    const h = await harness({ registry: fake.registry })
    const created = await createRecord(h, 'alpha')
    const target = join(h.dir, 'never-created')

    const stale = await h.post(REQUIREMENTS_WORKSPACE_PATH, {
      expectedRevision: 0, id: created.requirement.id, action: 'set', path: target,
    })
    expect(stale.status).toBe(409)
    expect(((await stale.json()) as ErrorResponse).code).toBe('conflict')
    expect(statSync(target, { throwIfNoEntry: false })).toBeUndefined()

    const ghost = await h.post(REQUIREMENTS_WORKSPACE_PATH, {
      expectedRevision: 1, id: '00000000-0000-4000-8000-000000000000', action: 'set', path: target,
    })
    expect(ghost.status).toBe(404)
    expect(((await ghost.json()) as ErrorResponse).code).toBe('not-found')
    await h.dispose()
  })

  it('clear unbinds without deleting the directory or touching the registry', async () => {
    const fake = fakeRegistry()
    const h = await harness({ registry: fake.registry })
    const created = await createRecord(h, 'alpha')
    const target = join(h.dir, 'ws')
    await h.post(REQUIREMENTS_WORKSPACE_PATH, { expectedRevision: 1, id: created.requirement.id, action: 'set', path: target })

    const cleared = await h.post(REQUIREMENTS_WORKSPACE_PATH, {
      expectedRevision: 2, id: created.requirement.id, action: 'clear',
    })
    expect(cleared.status).toBe(200)
    const body = (await cleared.json()) as { requirement: { workspacePath: string } }
    expect(body.requirement.workspacePath).toBe('')
    expect(statSync(target, { throwIfNoEntry: false })?.isDirectory()).toBe(true)

    const status = await (await h.get(`${REQUIREMENTS_WORKSPACE_PATH}?id=${created.requirement.id}`)).json() as {
      bound: boolean
    }
    expect(status.bound).toBe(false)
    // The registry row survives — the no-delete philosophy.
    expect(fake.registry.list()).toHaveLength(1)
    await h.dispose()
  })

  it('clear on an unbound record is an idempotent no-op without a revision bump', async () => {
    const h = await harness()
    const created = await createRecord(h, 'alpha')
    const res = await h.post(REQUIREMENTS_WORKSPACE_PATH, {
      expectedRevision: 1, id: created.requirement.id, action: 'clear',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { revision: number; requirement: { workspacePath: string } }
    expect(body.revision).toBe(1)
    expect(body.requirement.workspacePath).toBe('')
    await h.dispose()
  })

  it('flags a missing directory in status (list comparison tolerates the vanished path)', async () => {
    const fake = fakeRegistry()
    const h = await harness({ registry: fake.registry })
    const created = await createRecord(h, 'alpha')
    const target = join(h.dir, 'ws')
    await h.post(REQUIREMENTS_WORKSPACE_PATH, { expectedRevision: 1, id: created.requirement.id, action: 'set', path: target })
    rmSync(target, { recursive: true })

    const status = await (await h.get(`${REQUIREMENTS_WORKSPACE_PATH}?id=${created.requirement.id}`)).json() as {
      bound: boolean; directoryExists: boolean; registered: boolean
    }
    expect(status.bound).toBe(true)
    expect(status.directoryExists).toBe(false)
    // The registry row survives a vanished directory (no-delete philosophy):
    // string comparison against the list still matches the record.
    expect(status.registered).toBe(true)
    await h.dispose()
  })

  it('answers 400 on bad bodies and on a missing GET id', async () => {
    const h = await harness()
    const created = await createRecord(h, 'alpha')

    const bad = await h.post(REQUIREMENTS_WORKSPACE_PATH, { nonsense: true })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as ErrorResponse).code).toBe('bad-request')

    const setWithoutPath = await h.post(REQUIREMENTS_WORKSPACE_PATH, {
      expectedRevision: 1, id: created.requirement.id, action: 'set',
    })
    expect(setWithoutPath.status).toBe(400)

    const noId = await h.get(REQUIREMENTS_WORKSPACE_PATH)
    expect(noId.status).toBe(400)
    await h.dispose()
  })

  it('rebind recreates the host registration without a ledger write (no revision bump)', async () => {
    const fake = fakeRegistry()
    const h = await harness({ registry: fake.registry })
    const created = await createRecord(h, 'alpha')
    const target = join(h.dir, 'ws')
    await h.post(REQUIREMENTS_WORKSPACE_PATH, { expectedRevision: 1, id: created.requirement.id, action: 'set', path: target })
    fake.rows.length = 0 // host-side deletion of the registration row

    const res = await h.post(REQUIREMENTS_WORKSPACE_PATH, { id: created.requirement.id, action: 'rebind' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { bound: boolean; directoryExists: boolean; registered: boolean }
    expect(body.bound).toBe(true)
    expect(body.directoryExists).toBe(true)
    expect(body.registered).toBe(true)
    expect(fake.create).toHaveBeenCalledTimes(2)

    const listed = await (await h.get(REQUIREMENTS_LIST_PATH)).json() as ListResponse
    expect(listed.ok && listed.revision).toBe(2) // untouched by rebind
    await h.dispose()
  })

  it('rebind on a vanished directory answers 400 invalid-path (no empty-dir resurrection)', async () => {
    const fake = fakeRegistry()
    const h = await harness({ registry: fake.registry })
    const created = await createRecord(h, 'alpha')
    const target = join(h.dir, 'ws')
    await h.post(REQUIREMENTS_WORKSPACE_PATH, { expectedRevision: 1, id: created.requirement.id, action: 'set', path: target })
    rmSync(target, { recursive: true })

    const res = await h.post(REQUIREMENTS_WORKSPACE_PATH, { id: created.requirement.id, action: 'rebind' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ErrorResponse).code).toBe('invalid-path')
    expect(statSync(target, { throwIfNoEntry: false })).toBeUndefined()
    await h.dispose()
  })

  it('rebind on an unbound record answers 400 bad-request', async () => {
    const h = await harness()
    const created = await createRecord(h, 'alpha')
    const res = await h.post(REQUIREMENTS_WORKSPACE_PATH, { id: created.requirement.id, action: 'rebind' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ErrorResponse).code).toBe('bad-request')
    await h.dispose()
  })

  it('editing a record through the save form preserves the bound workspacePath', async () => {
    const h = await harness()
    const created = await createRecord(h, 'alpha')
    const target = join(h.dir, 'ws')
    await h.post(REQUIREMENTS_WORKSPACE_PATH, { expectedRevision: 1, id: created.requirement.id, action: 'set', path: target })

    const edited = await h.post(REQUIREMENTS_SAVE_PATH, {
      expectedRevision: 2,
      requirement: { id: created.requirement.id, title: 'alpha-renamed', description: '' },
    })
    expect(edited.status).toBe(200)
    const body = (await edited.json()) as { requirement: { workspacePath: string; title: string } }
    expect(body.requirement.title).toBe('alpha-renamed')
    expect(body.requirement.workspacePath).toBe(realpathSync(target))
    await h.dispose()
  })
})
