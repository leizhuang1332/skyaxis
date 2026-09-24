/**
 * Endpoint family against the real HostConnectionService (the P0 PoC-2 Leg A
 * construction): dispatch through createSharedFetchHandler('/api'), real
 * ReposFileStore on a temp dir, validator unwired unless a fake subprocess is
 * injected (probe → unverified/no-service).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it } from 'vitest'
import type { ErrorResponse, ListResponse } from '../../src/repos-pool-shared/protocol.js'
import { REPOS_LIST_PATH, REPOS_REMOVE_PATH, REPOS_SAVE_PATH, REPOS_VALIDATE_PATH } from '../../src/repos-pool-shared/protocol.js'
import { registerReposPoolEndpoints } from '../../src/repos-pool-host/endpoint.js'
import { ReposFileStore } from '../../src/repos-pool-host/repos-file.js'
import { ReposValidator } from '../../src/repos-pool-host/validator.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function harness(options?: { subprocess?: SubprocessRuntime }) {
  const dir = mkdtempSync(join(tmpdir(), 'repos-endpoint-test-'))
  dirs.push(dir)
  const file = new ReposFileStore(join(dir, 'repos.yaml'))
  const validator = new ReposValidator()
  if (options?.subprocess) validator.setSubprocess(options.subprocess)
  const ctx = new Context()
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], {} as never)
  })
  await fiber.await()
  const connection = ctx.get('connection') as HostConnectionHandle
  registerReposPoolEndpoints(connection, { file, validator })
  const shared = connection.createSharedFetchHandler('/api')
  const base = 'http://127.0.0.1'
  const get = (path: string) => shared.fetch(new Request(base + path))
  const post = (path: string, body: unknown) =>
    shared.fetch(new Request(base + path, { method: 'POST', body: JSON.stringify(body) }))
  return { file, validator, get, post, dispose: () => fiber.dispose() }
}

function fakeGit(outcome: { exitCode: number | null; signal: string | null; stderr: string }): SubprocessRuntime {
  return {
    resolveExecutable: async () => 'C:/git/git.EXE',
    spawn: () => ({
      done: Promise.resolve({ exitCode: outcome.exitCode, signal: outcome.signal }),
      collected: { stderr: { readFrom: () => ({ text: outcome.stderr }) } },
    }),
  } as unknown as SubprocessRuntime
}

const SAVE_BODY = (url: string, name = 'demo', validation: unknown = { kind: 'verified' }, id?: string) => ({
  expectedRevision: 0,
  repo: { ...(id ? { id } : {}), name, url, description: '' },
  validation,
})

describe('repos endpoints: list & save', () => {
  it('lists the pristine store as revision 0 with an empty array', async () => {
    const h = await harness()
    const res = await h.get(REPOS_LIST_PATH)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ListResponse
    expect(body).toEqual({ ok: true, revision: 0, repos: [] })
    await h.dispose()
  })

  it('creates a record (server-minted id, status from validation) and advances the revision', async () => {
    const h = await harness()
    const res = await h.post(REPOS_SAVE_PATH, SAVE_BODY('https://github.com/octocat/Hello-World.git'))
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: true; revision: number; repo: { id: string; status: string; validatedAt: string | null } }
    expect(body.ok).toBe(true)
    expect(body.revision).toBe(1)
    expect(body.repo.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.repo.status).toBe('verified')
    expect(typeof body.repo.validatedAt).toBe('string')

    const listed = await (await h.get(REPOS_LIST_PATH)).json() as ListResponse
    expect(listed.ok && listed.repos).toHaveLength(1)
    await h.dispose()
  })

  it('persists a forced-unknown save as unverified (D4 amended)', async () => {
    const h = await harness()
    const res = await h.post(REPOS_SAVE_PATH, SAVE_BODY('git@github.com:u/repo.git', 'r', { kind: 'forced', from: 'unknown' }))
    expect(res.status).toBe(200)
    const body = await res.json() as { repo: { status: string; validatedAt: string | null } }
    expect(body.repo.status).toBe('unverified')
    expect(body.repo.validatedAt).toBeNull()
    await h.dispose()
  })

  it('rejects illegitimate URLs with 422 + reason (syntax enforced server-side)', async () => {
    const h = await harness()
    for (const [url, reason] of [
      ['file:///C:/x', 'scheme-forbidden'],
      ['ext::sh -c noise', 'scheme-forbidden'],
      ['https://user:token@github.com/x', 'embedded-credentials'],
      ['./relative', 'no-scheme-local-path'],
    ] as const) {
      const res = await h.post(REPOS_SAVE_PATH, SAVE_BODY(url))
      expect(res.status).toBe(422)
      const body = (await res.json()) as ErrorResponse
      expect(body.code).toBe('invalid-url')
      expect(body.reason).toBe(reason)
    }
    await h.dispose()
  })

  it('rejects duplicate URLs and unknown edit ids; preserves status on unchanged edits', async () => {
    const h = await harness()
    const first = await (await h.post(REPOS_SAVE_PATH, SAVE_BODY('https://example.com/a.git', 'a'))).json() as { repo: { id: string } }
    await h.post(REPOS_SAVE_PATH, { ...SAVE_BODY('https://example.com/b.git', 'b'), expectedRevision: 1 })

    const duplicate = await h.post(REPOS_SAVE_PATH, { ...SAVE_BODY('https://example.com/a.git', 'c'), expectedRevision: 2 })
    expect(duplicate.status).toBe(422)
    expect(((await duplicate.json()) as ErrorResponse).code).toBe('duplicate-url')

    const ghost = await h.post(REPOS_SAVE_PATH, { ...SAVE_BODY('https://example.com/c.git', 'c', { kind: 'verified' }, '00000000-0000-4000-8000-000000000000'), expectedRevision: 2 })
    expect(ghost.status).toBe(404)
    expect(((await ghost.json()) as ErrorResponse).code).toBe('not-found')

    // Unchanged-URL edit keeps the persisted status fields.
    const edit = await h.post(REPOS_SAVE_PATH, {
      expectedRevision: 2,
      repo: { id: first.repo.id, name: 'a-renamed', url: 'https://example.com/a.git', description: 'x' },
      validation: { kind: 'unchanged' },
    })
    expect(edit.status).toBe(200)
    const edited = (await edit.json()) as { repo: { status: string; name: string } }
    expect(edited.repo.status).toBe('verified')
    expect(edited.repo.name).toBe('a-renamed')
    await h.dispose()
  })

  it('rejects stale revisions with 409 + currentRevision', async () => {
    const h = await harness()
    await h.post(REPOS_SAVE_PATH, SAVE_BODY('https://example.com/a.git', 'a'))
    const stale = await h.post(REPOS_SAVE_PATH, {
      ...SAVE_BODY('https://example.com/b.git', 'b'),
      expectedRevision: 0,
    })
    expect(stale.status).toBe(409)
    const body = (await stale.json()) as ErrorResponse
    expect(body.code).toBe('conflict')
    expect(body.currentRevision).toBe(1)
    await h.dispose()
  })

  it('answers 400 for malformed bodies and 404 for undeclared methods', async () => {
    const h = await harness()
    const bad = await h.post(REPOS_SAVE_PATH, { nonsense: true })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as ErrorResponse).code).toBe('bad-request')

    const wrongMethod = await h.get(REPOS_SAVE_PATH)
    expect(wrongMethod.status).toBe(404)
    await h.dispose()
  })
})

describe('repos endpoints: degraded file', () => {
  it('lists degraded and refuses writes over a corrupt repos.yaml', async () => {
    const h = await harness()
    await h.post(REPOS_SAVE_PATH, SAVE_BODY('https://example.com/a.git', 'a'))
    await h.post(REPOS_SAVE_PATH, { ...SAVE_BODY('https://example.com/b.git', 'b'), expectedRevision: 1 })
    writeFileSync(h.file.filePath, 'broken: [', 'utf8')

    const list = await h.get(REPOS_LIST_PATH)
    expect(list.status).toBe(200)
    const body = (await list.json()) as ListResponse
    expect(body.ok).toBe(false)
    expect(body.ok === false && body.reason).toBe('parse')

    const refused = await h.post(REPOS_SAVE_PATH, { ...SAVE_BODY('https://example.com/c.git', 'c'), expectedRevision: 2 })
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as ErrorResponse).code).toBe('unreadable-file')
    await h.dispose()
  })
})

describe('repos endpoints: validate', () => {
  it('returns the syntax verdict alone when illegitimate', async () => {
    const h = await harness()
    const res = await h.post(REPOS_VALIDATE_PATH, { url: 'file:///C:/x' })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; syntax: { acceptable: boolean; reason: string }; reachability?: unknown }
    expect(body.syntax).toEqual({ acceptable: false, reason: 'scheme-forbidden' })
    expect(body.reachability).toBeUndefined()
    await h.dispose()
  })

  it('answers unverified/no-service while the subprocess service is absent (decision D3 family)', async () => {
    const h = await harness()
    const res = await h.post(REPOS_VALIDATE_PATH, { url: 'https://github.com/octocat/Hello-World.git' })
    expect(res.status).toBe(200)
    const body = await res.json() as { syntax: { acceptable: boolean }; reachability: { classification: string; reason: string } }
    expect(body.syntax.acceptable).toBe(true)
    expect(body.reachability.classification).toBe('unverified')
    expect(body.reachability.reason).toBe('no-service')
    await h.dispose()
  })

  it('passes the classifier verdict through with the diagnostic detail', async () => {
    const h = await harness({ subprocess: fakeGit({ exitCode: 128, signal: null, stderr: "fatal: could not read Username for 'https://github.com'" }) })
    const res = await h.post(REPOS_VALIDATE_PATH, { url: 'https://github.com/org/private.git' })
    expect(res.status).toBe(200)
    const body = await res.json() as { reachability: { classification: string; detail: string } }
    expect(body.reachability.classification).toBe('auth')
    expect(body.reachability.detail).toContain('could not read Username')
    await h.dispose()
  })
})

describe('repos endpoints: remove', () => {
  it('removes by id with revision guard, 404 for ghosts', async () => {
    const h = await harness()
    const created = await (await h.post(REPOS_SAVE_PATH, SAVE_BODY('https://example.com/a.git', 'a'))).json() as { repo: { id: string } }

    const removed = await h.post(REPOS_REMOVE_PATH, { expectedRevision: 1, id: created.repo.id })
    expect(removed.status).toBe(200)
    expect(((await removed.json()) as { revision: number }).revision).toBe(2)

    const ghost = await h.post(REPOS_REMOVE_PATH, { expectedRevision: 2, id: created.repo.id })
    expect(ghost.status).toBe(404)

    const stale = await h.post(REPOS_REMOVE_PATH, { expectedRevision: 0, id: '00000000-0000-4000-8000-000000000000' })
    expect(stale.status).toBe(409)
    await h.dispose()
  })
})
