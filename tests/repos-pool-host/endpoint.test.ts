/**
 * Endpoint family against the real HostConnectionService (the P0 PoC-2 Leg A
 * construction): dispatch through createSharedFetchHandler('/api'), real
 * ReposFileStore on a temp dir, validator unwired unless a fake subprocess is
 * injected (probe → unverified/no-service).
 *
 * Dual-address era (decision 0004): SAVE_BODY puts the url in the urlHttp
 * FIELD and lets the host slot it by value — the wire contract is
 * "field presence is the intent, kind decides the slot". The default verdict
 * follows the value's family so legacy call sites keep their meaning.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it } from 'vitest'
import type { ErrorResponse, ListResponse } from '../../src/repos-pool-shared/protocol.js'
import { isImportResponseOk, isRepoRecord } from '../../src/repos-pool-shared/protocol.js'
import { REPOS_IMPORT_PATH, REPOS_LIST_PATH, REPOS_REMOVE_PATH, REPOS_SAVE_PATH, REPOS_VALIDATE_PATH } from '../../src/repos-pool-shared/protocol.js'
import { checkUrlSyntax } from '../../src/repos-pool-shared/url-syntax.js'
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

const SAVE_BODY = (url: string, name = 'demo', validation?: unknown, id?: string) => {
  const syntax = checkUrlSyntax(url)
  const slot = syntax.acceptable && (syntax.kind === 'ssh' || syntax.kind === 'scp') ? 'ssh' : 'http'
  // The url goes into the field matching its family — the wire contract is
  // "field presence is the intent, field family matches the value" (a
  // family/field mismatch is a client bug and a 400, decision 0004 / D2).
  return {
    expectedRevision: 0,
    repo: { ...(id ? { id } : {}), name, ...(slot === 'ssh' ? { urlSsh: url } : { urlHttp: url }), description: '' },
    validation: validation ?? { [slot]: { kind: 'verified' } },
  }
}

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
    const body = await res.json() as { ok: true; revision: number; repo: { id: string; statusHttp: string; validatedAtHttp: string | null; urlSsh?: string } }
    expect(body.ok).toBe(true)
    expect(body.revision).toBe(1)
    expect(body.repo.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.repo.statusHttp).toBe('verified')
    expect(typeof body.repo.validatedAtHttp).toBe('string')
    expect(body.repo.urlSsh).toBeUndefined()

    // Write-then-reload invariant (B10): a record the endpoint assembles must
    // re-load — a quadruple/slot mismatch would brick the file on next boot.
    const reloaded = h.file.load()
    expect(reloaded.ok).toBe(true)

    const listed = await (await h.get(REPOS_LIST_PATH)).json() as ListResponse
    expect(listed.ok && listed.repos).toHaveLength(1)
    await h.dispose()
  })

  it('persists a forced-unknown save as unverified (D4 amended)', async () => {
    const h = await harness()
    const res = await h.post(REPOS_SAVE_PATH, SAVE_BODY('git@github.com:u/repo.git', 'r', { ssh: { kind: 'forced', from: 'unknown' } }))
    expect(res.status).toBe(200)
    const body = await res.json() as { repo: { statusSsh: string; validatedAtSsh: string | null } }
    expect(body.repo.statusSsh).toBe('unverified')
    expect(body.repo.validatedAtSsh).toBeNull()
    expect(h.file.load().ok).toBe(true)
    await h.dispose()
  })

  it('rejects illegitimate URLs with 422 + reason + field (syntax enforced server-side)', async () => {
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
      // The value arrived in the urlHttp field — the 422 points at that field.
      expect(body.field).toBe('http')
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

    const ghost = await h.post(REPOS_SAVE_PATH, { ...SAVE_BODY('https://example.com/c.git', 'c', { http: { kind: 'verified' } }, '00000000-0000-4000-8000-000000000000'), expectedRevision: 2 })
    expect(ghost.status).toBe(404)
    expect(((await ghost.json()) as ErrorResponse).code).toBe('not-found')

    // Unchanged-address edit keeps the slot's persisted state quadruple.
    const edit = await h.post(REPOS_SAVE_PATH, {
      expectedRevision: 2,
      repo: { id: first.repo.id, name: 'a-renamed', urlHttp: 'https://example.com/a.git', description: 'x' },
      validation: { http: { kind: 'unchanged' } },
    })
    expect(edit.status).toBe(200)
    const edited = (await edit.json()) as { repo: { statusHttp: string; name: string } }
    expect(edited.repo.statusHttp).toBe('verified')
    expect(edited.repo.name).toBe('a-renamed')
    expect(h.file.load().ok).toBe(true)
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

describe('repos endpoints: dual-address save semantics (decision 0004)', () => {
  it('lands an ssh-family address in the ssh slot with its own state', async () => {
    const h = await harness()
    const res = await h.post(REPOS_SAVE_PATH, SAVE_BODY('ssh://git@code.jms.com:2222/ylspm/cal.git', 'cal'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { repo: { urlSsh?: string; urlHttp?: string; statusSsh?: string } }
    expect(body.repo.urlSsh).toBe('ssh://git@code.jms.com:2222/ylspm/cal.git')
    expect(body.repo.urlHttp).toBeUndefined()
    expect(body.repo.statusSsh).toBe('verified')
    expect(h.file.load().ok).toBe(true)
    await h.dispose()
  })

  it('rejects a value whose family disagrees with its field (400, never silently re-slotted)', async () => {
    const h = await harness()
    const res = await h.post(REPOS_SAVE_PATH, {
      expectedRevision: 0,
      repo: { name: 'misfiled', urlHttp: 'ssh://git@code.jms.com:2222/ylspm/cal.git', description: '' },
      validation: { http: { kind: 'verified' } },
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ErrorResponse).code).toBe('bad-request')
    await h.dispose()
  })

  it('saves both slots with independent verdicts in one request', async () => {
    const h = await harness()
    const res = await h.post(REPOS_SAVE_PATH, {
      expectedRevision: 0,
      repo: {
        name: 'dual',
        urlSsh: 'git@github.com:org/dual.git',
        urlHttp: 'https://github.com/org/dual.git',
        description: '',
      },
      validation: { ssh: { kind: 'unverified' }, http: { kind: 'verified' } },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { repo: Record<string, unknown> }
    expect(body.repo.urlSsh).toBe('git@github.com:org/dual.git')
    expect(body.repo.statusSsh).toBe('unverified')
    expect(body.repo.validatedAtSsh).toBeNull()
    expect(body.repo.statusHttp).toBe('verified')
    expect(typeof body.repo.validatedAtHttp).toBe('string')
    expect(h.file.load().ok).toBe(true)
    await h.dispose()
  })

  it('rejects two same-family values colliding onto one slot with 400 (never silently deduped)', async () => {
    const h = await harness()
    const res = await h.post(REPOS_SAVE_PATH, {
      expectedRevision: 0,
      repo: {
        name: 'collide',
        urlSsh: 'https://example.com/one.git', // http value in the ssh field
        urlHttp: 'https://example.com/two.git',
        description: '',
      },
      validation: { ssh: { kind: 'verified' }, http: { kind: 'verified' } },
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ErrorResponse).code).toBe('bad-request')
    await h.dispose()
  })

  it('falls back to unverified for an unchanged verdict without a previous slot (create or new slot)', async () => {
    const h = await harness()
    const res = await h.post(REPOS_SAVE_PATH, {
      expectedRevision: 0,
      repo: { name: 'odd-client', urlHttp: 'https://example.com/odd.git', description: '' },
      validation: { http: { kind: 'unchanged' } },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { repo: { statusHttp: string; validatedAtHttp: string | null } }
    expect(body.repo.statusHttp).toBe('unverified')
    expect(body.repo.validatedAtHttp).toBeNull()
    expect(h.file.load().ok).toBe(true)
    await h.dispose()
  })

  it('dropping a url field on edit removes that address together with its state (field presence is the intent)', async () => {
    const h = await harness()
    const created = await (await h.post(REPOS_SAVE_PATH, {
      expectedRevision: 0,
      repo: { name: 'trim', urlSsh: 'git@github.com:org/trim.git', urlHttp: 'https://example.com/trim.git', description: '' },
      validation: { ssh: { kind: 'verified' }, http: { kind: 'verified' } },
    })).json() as { repo: { id: string } }

    const edit = await h.post(REPOS_SAVE_PATH, {
      expectedRevision: 1,
      repo: { id: created.repo.id, name: 'trim', urlSsh: 'git@github.com:org/trim.git', description: '' },
      validation: { ssh: { kind: 'unchanged' } },
    })
    expect(edit.status).toBe(200)
    const body = (await edit.json()) as { repo: { urlSsh?: string; urlHttp?: string; statusHttp?: string; statusSsh?: string } }
    expect(body.repo.urlSsh).toBe('git@github.com:org/trim.git')
    expect(body.repo.urlHttp).toBeUndefined()
    expect(body.repo.statusHttp).toBeUndefined()
    expect(body.repo.statusSsh).toBe('verified')
    // The stored file re-loads (no orphan state quadruples left behind).
    expect(h.file.load().ok).toBe(true)
    await h.dispose()
  })

  it('rejects a validation key set that disagrees with the address slots (400)', async () => {
    const h = await harness()
    const res = await h.post(REPOS_SAVE_PATH, {
      expectedRevision: 0,
      repo: { name: 'keyset', urlHttp: 'https://example.com/keyset.git', description: '' },
      validation: { ssh: { kind: 'verified' } },
    })
    expect(res.status).toBe(400)
    const unknownKey = await h.post(REPOS_SAVE_PATH, {
      expectedRevision: 0,
      repo: { name: 'keyset2', urlHttp: 'https://example.com/keyset2.git', description: '' },
      validation: { ftp: { kind: 'verified' } },
    })
    expect(unknownKey.status).toBe(400)
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

describe('repos endpoints: import (decision 0004 / D5+D6)', () => {
  const IMPORT_BODY = (content: string, expectedRevision = 0, dryRun?: boolean) => ({
    expectedRevision,
    ...(dryRun !== undefined ? { dryRun } : {}),
    content,
  })
  const JSON_FILE = JSON.stringify([
    { name: 'yl-jms-spmibill-cal-api', 'url-ssh': 'ssh://git@code.jms.com:2222/ylspm/cal-api.git', 'url-http': 'http://code.jms.com/ylspm/cal-api.git' },
  ])

  it('dry-run reports and previews without writing a single byte', async () => {
    const h = await harness()
    await h.post(REPOS_SAVE_PATH, SAVE_BODY('https://example.com/existing.git', 'existing')) // file now exists
    const before = readFileSync(h.file.filePath, 'utf8')
    const res = await h.post(REPOS_IMPORT_PATH, IMPORT_BODY(JSON_FILE, 1, true))
    expect(res.status).toBe(200)
    const parsed: unknown = await res.json()
    expect(isImportResponseOk(parsed)).toBe(true)
    if (!isImportResponseOk(parsed)) return
    expect(parsed.revision).toBe(1) // dry-run never bumps
    expect(parsed.report.created).toBe(1)
    expect(parsed.repos).toHaveLength(2) // preview snapshot carries the would-be record
    expect(readFileSync(h.file.filePath, 'utf8')).toBe(before) // byte-identical
    await h.dispose()
  })

  it('dry-run checks the revision too: stale preview anchor → 409 + currentRevision', async () => {
    const h = await harness()
    await h.post(REPOS_SAVE_PATH, SAVE_BODY('https://example.com/a.git', 'a'))
    const res = await h.post(REPOS_IMPORT_PATH, IMPORT_BODY(JSON_FILE, 0, true))
    expect(res.status).toBe(409)
    expect(((await res.json()) as ErrorResponse).currentRevision).toBe(1)
    await h.dispose()
  })

  it('imports for real: revision +1, response passes the browser guard, file reloads, list shows the record', async () => {
    const h = await harness()
    const res = await h.post(REPOS_IMPORT_PATH, IMPORT_BODY(JSON_FILE))
    expect(res.status).toBe(200)
    const parsed: unknown = await res.json()
    expect(isImportResponseOk(parsed)).toBe(true)
    if (!isImportResponseOk(parsed)) return
    expect(parsed.revision).toBe(1)
    expect(parsed.report).toMatchObject({ created: 1, updated: 0, unchanged: 0 })
    expect(parsed.repos.every(isRepoRecord)).toBe(true)
    // Write-then-reload invariant: the merged record re-loads.
    expect(h.file.load().ok).toBe(true)
    const listed = await (await h.get(REPOS_LIST_PATH)).json() as ListResponse
    const imported = listed.ok ? listed.repos.find((r) => r.name === 'yl-jms-spmibill-cal-api') : undefined
    expect(imported?.urlSsh).toBe('ssh://git@code.jms.com:2222/ylspm/cal-api.git')
    expect(imported?.urlHttp).toBe('http://code.jms.com/ylspm/cal-api.git')
    expect(imported?.statusSsh).toBe('unverified')
    await h.dispose()
  })

  it('a description-only change still lands on disk (change detection = slot ∪ description)', async () => {
    const h = await harness()
    const created = await (await h.post(REPOS_SAVE_PATH, SAVE_BODY('https://example.com/doc.git', 'doc'))).json() as { repo: { id: string } }
    const res = await h.post(REPOS_IMPORT_PATH, IMPORT_BODY(
      JSON.stringify([{ name: 'doc', 'url-http': 'https://example.com/doc.git', description: 'imported note' }]), 1,
    ))
    expect(res.status).toBe(200)
    const parsed = (await res.json()) as { revision: number; report: { updated: number } }
    expect(parsed.revision).toBe(2)
    expect(parsed.report.updated).toBe(1)
    const reloaded = h.file.load()
    expect(reloaded.ok && reloaded.value.repos[0].description).toBe('imported note')
    expect(created.repo.id).toBeTruthy()
    await h.dispose()
  })

  it('re-importing identical content writes nothing (no revision bump, no file change)', async () => {
    const h = await harness()
    await h.post(REPOS_IMPORT_PATH, IMPORT_BODY(JSON_FILE))
    const afterFirst = readFileSync(h.file.filePath, 'utf8')
    const again = await h.post(REPOS_IMPORT_PATH, IMPORT_BODY(JSON_FILE, 1))
    expect(again.status).toBe(200)
    const parsed = (await again.json()) as { revision: number; report: { created: number; updated: number; unchanged: number } }
    expect(parsed.revision).toBe(1) // unchanged
    expect(parsed.report).toMatchObject({ created: 0, updated: 0, unchanged: 1 })
    expect(readFileSync(h.file.filePath, 'utf8')).toBe(afterFirst)
    await h.dispose()
  })

  it('rejects oversized content with 413 too-large before parsing', async () => {
    const h = await harness()
    const res = await h.post(REPOS_IMPORT_PATH, IMPORT_BODY('x'.repeat(2_000_001)))
    expect(res.status).toBe(413)
    expect(((await res.json()) as ErrorResponse).code).toBe('too-large')
    await h.dispose()
  })

  it('answers 400 for unparseable content and scalar documents', async () => {
    const h = await harness()
    const badYaml = await h.post(REPOS_IMPORT_PATH, IMPORT_BODY('repos: [ broken :::\n  - {'))
    expect(badYaml.status).toBe(400)
    const scalar = await h.post(REPOS_IMPORT_PATH, IMPORT_BODY('hello'))
    expect(scalar.status).toBe(400)
    const noRepos = await h.post(REPOS_IMPORT_PATH, IMPORT_BODY('{"version": 2}'))
    expect(noRepos.status).toBe(400)
    await h.dispose()
  })

  it('refuses imports over a degraded file (the UI gate is not the trust boundary)', async () => {
    const h = await harness()
    await h.post(REPOS_SAVE_PATH, SAVE_BODY('https://example.com/a.git', 'a'))
    writeFileSync(h.file.filePath, 'broken: [', 'utf8')
    const res = await h.post(REPOS_IMPORT_PATH, IMPORT_BODY(JSON_FILE, 1))
    expect(res.status).toBe(409)
    expect(((await res.json()) as ErrorResponse).code).toBe('unreadable-file')
    await h.dispose()
  })
})
