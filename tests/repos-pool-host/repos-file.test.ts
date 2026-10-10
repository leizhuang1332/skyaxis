/**
 * ReposFileStore semantics — the P0 PoC-3 scenarios promoted to regression
 * tests, plus the two production hardenings (write mutex, rename backoff),
 * plus the v1→v2 read-side migration matrix (decision 0004 / D3).
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { isRepoRecord, type RepoRecord } from '../../src/repos-pool-shared/protocol.js'
import { ReposFileStore, type ReposFileIo } from '../../src/repos-pool-host/repos-file.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function fixture(): { store: ReposFileStore; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'repos-file-test-'))
  dirs.push(dir)
  const file = join(dir, 'repos.yaml')
  return { store: new ReposFileStore(file), file }
}

function record(name: string, description = ''): RepoRecord {
  return {
    id: randomUUID(),
    name,
    urlHttp: `https://example.com/${name}.git`,
    description,
    statusHttp: 'verified',
    validatedAtHttp: '2026-09-24T09:30:00.000Z',
    lastErrorHttp: null,
  }
}

/** A hand-written v1 (single-url era) repos.yaml row. validatedAt/lastError accept null. */
function v1Row(overrides: Partial<{ id: string; name: string; url: string; status: string; validatedAt: string | null; lastError: string | null }>): string {
  const {
    id = randomUUID(),
    name = 'legacy',
    url = 'https://example.com/legacy.git',
    status = 'verified',
    validatedAt = '2026-09-24T09:30:00.000Z',
    lastError = null,
  } = overrides
  return [
    `  - id: ${id}`,
    `    name: ${name}`,
    `    url: ${JSON.stringify(url)}`,
    `    description: ''`,
    `    status: ${status}`,
    `    validatedAt: ${validatedAt === null ? 'null' : JSON.stringify(validatedAt)}`,
    `    lastError: ${lastError === null ? 'null' : JSON.stringify(lastError)}`,
  ].join('\n')
}

function writeV1(file: string, rows: string[], revision = 3): void {
  writeFileSync(file, `version: 1\nrevision: ${revision}\nrepos:\n${rows.join('\n')}\n`, 'utf8')
}

describe('ReposFileStore: read/write roundtrip', () => {
  it('treats a missing file as pristine revision 0 and saves through 0→1', async () => {
    const { store, file } = fixture()
    const initial = store.load()
    expect(initial).toEqual({ ok: true, value: { version: 2, revision: 0, repos: [] } })

    const [a, b] = [record('chinese-poetry', '中文诗歌全集'), record('hello-world')]
    const saved = await store.save(0, [a, b])
    expect(saved).toEqual({ ok: true, revision: 1 })

    const loaded = store.load()
    expect(loaded.ok && loaded.value.revision).toBe(1)
    expect(loaded.ok && loaded.value.repos).toHaveLength(2)
    expect(readFileSync(file, 'utf8')).toContain('中文诗歌全集')
  })

  it('advances revision on legal edits and keeps the previous version in .bak', async () => {
    const { store, file } = fixture()
    const first = [record('alpha')]
    await store.save(0, first)
    const second = [...first, record('beta')]
    const saved = await store.save(1, second)
    expect(saved).toEqual({ ok: true, revision: 2 })

    expect(existsSync(`${file}.bak`)).toBe(true)
    const backup = new ReposFileStore(`${file}.bak`).load()
    expect(backup.ok && backup.value.repos.map((r) => r.name)).toEqual(['alpha'])
    const live = new ReposFileStore(file).load()
    expect(live.ok && live.value.repos.map((r) => r.name)).toEqual(['alpha', 'beta'])
  })

  it('round-trips every optional state field through disk — the zod-mirror drift guard', async () => {
    // The compile-time assertions in types.ts are now LIVE consts (挂账轮)
    // but they catch required-field drift only; a field present on the
    // protocol yet missing from the zod mirror would still be SILENTLY
    // STRIPPED on every load (zod drops unknown keys) — data loss with no
    // error. This roundtrip is the load-bearing mirror test (the
    // workbench-file.test:86 precedent): drop any field below from
    // RepoRecordSchema and this goes red.
    const { store } = fixture()
    const dual: RepoRecord = {
      id: randomUUID(),
      name: 'dual-slot',
      urlSsh: 'git@github.com:org/repo.git',
      urlHttp: 'https://example.com/repo.git',
      description: '双地址全状态行',
      statusSsh: 'forced-auth',
      statusHttp: 'unverified',
      validatedAtSsh: '2026-09-24T09:30:00.000Z',
      validatedAtHttp: null,
      lastErrorSsh: 'Permission denied (publickey)',
      lastErrorHttp: null,
    }
    await store.save(0, [dual, record('http-only')])
    const loaded = store.load()
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const back = loaded.value.repos.find((r) => r.name === 'dual-slot')
    expect(back?.urlSsh).toBe('git@github.com:org/repo.git')
    expect(back?.statusSsh).toBe('forced-auth')
    expect(back?.statusHttp).toBe('unverified')
    expect(back?.validatedAtSsh).toBe('2026-09-24T09:30:00.000Z')
    expect(back?.validatedAtHttp).toBeNull()
    expect(back?.lastErrorSsh).toBe('Permission denied (publickey)')
    expect(back?.lastErrorHttp).toBeNull()
    // The absent-optional side survives as absent (not defaulted, not null).
    expect(loaded.value.repos.find((r) => r.name === 'http-only')?.urlSsh).toBeUndefined()
    // And the wire guard accepts exactly the same shape (both halves agree).
    expect(isRepoRecord(back)).toBe(true)
  })
})

describe('ReposFileStore: v1→v2 read-side migration (decision 0004 / D3)', () => {
  it('slots legacy urls by kind: ssh/scp forms → urlSsh, http(s) → urlHttp, state rides along', () => {
    const { store, file } = fixture()
    writeV1(file, [
      v1Row({ name: 'ssh-scheme', url: 'ssh://git@code.jms.com:2222/ylspm/cal.git' }),
      v1Row({ name: 'ssh-shorthand', url: 'git@github.com:org/repo.git' }),
      v1Row({ name: 'scp-shorthand', url: 'code.jms.com:ylspm/repo.git' }),
      v1Row({ name: 'https', url: 'https://example.com/a.git' }),
      v1Row({ name: 'http', url: 'http://example.com/b.git', status: 'forced-auth', validatedAt: '2026-09-25T08:00:00.000Z', lastError: 'Permission denied' }),
    ])
    const loaded = store.load()
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    // File-level revision preserved verbatim — concurrent panels keep their
    // optimistic-lock continuity across the upgrade.
    expect(loaded.value.revision).toBe(3)
    expect(loaded.value.version).toBe(2)
    const byName = new Map(loaded.value.repos.map((r) => [r.name, r]))
    for (const name of ['ssh-scheme', 'ssh-shorthand', 'scp-shorthand']) {
      const r = byName.get(name)!
      expect(r.urlSsh).toBeTruthy()
      expect(r.urlHttp).toBeUndefined()
      expect(r.statusSsh).toBe('verified')
      expect(r.validatedAtSsh).toBe('2026-09-24T09:30:00.000Z')
      expect(r.lastErrorSsh).toBeNull()
    }
    for (const name of ['https', 'http']) {
      const r = byName.get(name)!
      expect(r.urlHttp).toBeTruthy()
      expect(r.urlSsh).toBeUndefined()
      expect(r.statusHttp).toBeTruthy()
    }
    const http = byName.get('http')!
    expect(http.statusHttp).toBe('forced-auth')
    expect(http.lastErrorHttp).toBe('Permission denied')
  })

  it('preserves syntax-illegal legacy urls verbatim in the http slot with their state (format conversion ≠ content review)', () => {
    const { store, file } = fixture()
    writeV1(file, [
      v1Row({ name: 'file-scheme', url: 'file:///srv/git/repo.git' }),
      v1Row({ name: 'whitespace', url: ' ' }),
      v1Row({ name: 'scheme-less', url: 'srv-git-repo', status: 'unverified', validatedAt: null }),
    ])
    const loaded = store.load()
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const byName = new Map(loaded.value.repos.map((r) => [r.name, r]))
    // No record dropped, no degrade — legality resurfaces on the record's
    // next save/validate, not during migration.
    expect(byName.get('file-scheme')!.urlHttp).toBe('file:///srv/git/repo.git')
    expect(byName.get('file-scheme')!.statusHttp).toBe('verified')
    expect(byName.get('whitespace')!.urlHttp).toBe(' ')
    expect(byName.get('scheme-less')!.urlHttp).toBe('srv-git-repo')
    expect(byName.get('scheme-less')!.statusHttp).toBe('unverified')
  })

  it('a v1 .bak remains loadable after manual restore (read-side compatibility bonus)', async () => {
    const { store, file } = fixture()
    writeV1(file, [v1Row({ name: 'legacy-backup' })])
    copyFileSync(file, `${file}.bak`)
    const loaded = store.load()
    expect(loaded.ok && loaded.value.repos.map((r) => r.name)).toEqual(['legacy-backup'])
    // Next save upgrades the on-disk file to v2 in one step.
    const saved = await store.save(3, [record('next-era')])
    expect(saved).toEqual({ ok: true, revision: 4 })
    expect(readFileSync(file, 'utf8')).toContain('version: 2')
  })

  it('degrades on unknown or missing version with an actionable detail', () => {
    const { store, file } = fixture()
    writeFileSync(file, 'version: 3\nrevision: 0\nrepos: []', 'utf8')
    const unknown = store.load()
    expect(unknown.ok).toBe(false)
    expect(unknown.ok === false && unknown.detail).toContain('未知版本')

    writeFileSync(file, 'revision: 0\nrepos: []', 'utf8')
    const missing = store.load()
    expect(missing.ok).toBe(false)
    expect(missing.ok === false && missing.detail).toContain('缺少 version')
  })

  it('a v1 row failing its own schema still degrades (legacy behavior unchanged)', () => {
    const { store, file } = fixture()
    writeFileSync(file, `version: 1\nrevision: 0\nrepos:\n${v1Row({ name: 'bad', validatedAt: 'not-a-date' })}\n`, 'utf8')
    const degraded = store.load()
    expect(degraded.ok).toBe(false)
    expect(degraded.ok === false && degraded.reason).toBe('schema')
  })
})

describe('ReposFileStore: revision guard', () => {
  it('rejects stale revisions with the current revision reported', async () => {
    const { store } = fixture()
    await store.save(0, [record('alpha')])
    await store.save(1, [record('alpha'), record('beta')])
    const stale = await store.save(1, [record('gamma')])
    expect(stale).toEqual({ ok: false, rejected: 'stale-revision', currentRevision: 2 })
  })

  it('serializes concurrent saves with the same expectedRevision: exactly one wins', async () => {
    const { store } = fixture()
    await store.save(0, [record('alpha')])
    const [a, b] = await Promise.all([
      store.save(1, [record('alpha'), record('beta')]),
      store.save(1, [record('alpha'), record('gamma')]),
    ])
    const outcomes = [a, b].map((r) => (r.ok ? 'ok' : r.rejected))
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'stale-revision')).toHaveLength(1)
    const loaded = store.load()
    expect(loaded.ok && loaded.value.revision).toBe(2)
    expect(loaded.ok && loaded.value.repos).toHaveLength(2)
  })
})

describe('ReposFileStore: degraded loads never throw', () => {
  it('degrades parse failures and schema mismatches separately', async () => {
    const { store, file } = fixture()
    // Two saves so a .bak exists (backup is only taken when the main file exists).
    await store.save(0, [record('alpha')])
    await store.save(1, [record('alpha'), record('beta')])

    writeFileSync(file, 'repos: [ 这不是合法 YAML :::\n  - {broken', 'utf8')
    const parse = store.load()
    expect(parse.ok).toBe(false)
    expect(parse.ok === false && parse.reason).toBe('parse')
    expect(parse.ok === false && parse.hasBackup).toBe(true)

    writeFileSync(file, 'version: 1\nrevision: "not-a-number"\nrepos: []', 'utf8')
    const schemaV1 = store.load()
    expect(schemaV1.ok).toBe(false)
    expect(schemaV1.ok === false && schemaV1.reason).toBe('schema')

    writeFileSync(file, `version: 2\nrevision: 0\nrepos:\n${v1Row({ name: 'bad' })}\n`, 'utf8')
    const schemaV2 = store.load()
    expect(schemaV2.ok).toBe(false)
    expect(schemaV2.ok === false && schemaV2.reason).toBe('schema')
  })

  it('recovers from .bak after manual restore', async () => {
    const { store, file } = fixture()
    const first = [record('alpha')]
    await store.save(0, first)
    await store.save(1, [...first, record('beta')])
    writeFileSync(file, 'broken: [', 'utf8')
    copyFileSync(`${file}.bak`, file)
    const recovered = store.load()
    expect(recovered.ok && recovered.value.repos.map((r) => r.name)).toEqual(['alpha'])
  })

  it('refuses to save over an unreadable file (preserve the scene)', async () => {
    const { store, file } = fixture()
    await store.save(0, [record('alpha')])
    writeFileSync(file, 'broken: [', 'utf8')
    const refused = await store.save(1, [])
    expect(refused).toEqual({ ok: false, rejected: 'unreadable-file' })
    expect(readFileSync(file, 'utf8')).toBe('broken: [')
  })
})

describe('ReposFileStore: rename backoff (injected io)', () => {
  it('retries EPERM transients with escalating waits and succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repos-file-test-'))
    dirs.push(dir)
    const file = join(dir, 'repos.yaml')
    const waits: number[] = []
    let failuresLeft = 2
    const io: ReposFileIo = {
      rename(from: string, to: string) {
        if (failuresLeft > 0) {
          failuresLeft -= 1
          throw Object.assign(new Error('locked'), { code: 'EPERM' })
        }
        const { renameSync } = require('node:fs') as typeof import('node:fs')
        renameSync(from, to)
      },
      wait(ms: number) {
        waits.push(ms)
      },
    }
    const store = new ReposFileStore(file, io)
    const saved = await store.save(0, [record('alpha')])
    expect(saved).toEqual({ ok: true, revision: 1 })
    expect(waits).toEqual([20, 40])
    expect(store.load().ok && true).toBe(true)
  })
})
