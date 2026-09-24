/**
 * ReposFileStore semantics — the P0 PoC-3 scenarios promoted to regression
 * tests, plus the two production hardenings (write mutex, rename backoff).
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import type { RepoRecord } from '../../src/repos-pool-shared/protocol.js'
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
    url: `https://example.com/${name}.git`,
    description,
    status: 'verified',
    validatedAt: '2026-09-24T09:30:00.000Z',
    lastError: null,
  }
}

describe('ReposFileStore: read/write roundtrip', () => {
  it('treats a missing file as pristine revision 0 and saves through 0→1', async () => {
    const { store, file } = fixture()
    const initial = store.load()
    expect(initial).toEqual({ ok: true, value: { version: 1, revision: 0, repos: [] } })

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
    const schema = store.load()
    expect(schema.ok).toBe(false)
    expect(schema.ok === false && schema.reason).toBe('schema')
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
