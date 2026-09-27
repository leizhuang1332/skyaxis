/**
 * RequirementsFileStore semantics — the repos-pool PoC-3 scenarios ported
 * as regression tests, plus the two production hardenings (write mutex,
 * rename backoff).
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import { RequirementsFileStore, type RequirementsFileIo } from '../../src/requirements-host/requirements-file.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function fixture(): { store: RequirementsFileStore; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'requirements-file-test-'))
  dirs.push(dir)
  const file = join(dir, 'requirements.yaml')
  return { store: new RequirementsFileStore(file), file }
}

function record(title: string, description = ''): RequirementRecord {
  const now = '2026-09-25T09:30:00.000Z'
  return {
    id: randomUUID(),
    title,
    description,
    workspacePath: '',
  linkedRepos: [],
    createdAt: now,
    updatedAt: now,
  }
}

describe('RequirementsFileStore: read/write roundtrip', () => {
  it('treats a missing file as pristine revision 0 and saves through 0→1', async () => {
    const { store, file } = fixture()
    const initial = store.load()
    expect(initial).toEqual({ ok: true, value: { version: 1, revision: 0, requirements: [] } })

    const [a, b] = [record('多仓库检索', '支持中文内容'), record('会话导出')]
    const saved = await store.save(0, [a, b])
    expect(saved).toEqual({ ok: true, revision: 1 })

    const loaded = store.load()
    expect(loaded.ok && loaded.value.revision).toBe(1)
    expect(loaded.ok && loaded.value.requirements).toHaveLength(2)
    expect(readFileSync(file, 'utf8')).toContain('支持中文内容')
  })

  it('advances revision on legal edits and keeps the previous version in .bak', async () => {
    const { store, file } = fixture()
    const first = [record('alpha')]
    await store.save(0, first)
    const second = [...first, record('beta')]
    const saved = await store.save(1, second)
    expect(saved).toEqual({ ok: true, revision: 2 })

    expect(existsSync(`${file}.bak`)).toBe(true)
    const backup = new RequirementsFileStore(`${file}.bak`).load()
    expect(backup.ok && backup.value.requirements.map((r) => r.title)).toEqual(['alpha'])
    const live = new RequirementsFileStore(file).load()
    expect(live.ok && live.value.requirements.map((r) => r.title)).toEqual(['alpha', 'beta'])
  })
})

describe('RequirementsFileStore: revision guard', () => {
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
    expect(loaded.ok && loaded.value.requirements).toHaveLength(2)
  })
})

describe('RequirementsFileStore: degraded loads never throw', () => {
  it('degrades parse failures and schema mismatches separately', async () => {
    const { store, file } = fixture()
    // Two saves so a .bak exists (backup is only taken when the main file exists).
    await store.save(0, [record('alpha')])
    await store.save(1, [record('alpha'), record('beta')])

    writeFileSync(file, 'requirements: [ 这不是合法 YAML :::\n  - {broken', 'utf8')
    const parse = store.load()
    expect(parse.ok).toBe(false)
    expect(parse.ok === false && parse.reason).toBe('parse')
    expect(parse.ok === false && parse.hasBackup).toBe(true)

    writeFileSync(file, 'version: 1\nrevision: "not-a-number"\nrequirements: []', 'utf8')
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
    expect(recovered.ok && recovered.value.requirements.map((r) => r.title)).toEqual(['alpha'])
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

describe('RequirementsFileStore: rename backoff (injected io)', () => {
  it('retries EPERM transients with escalating waits and succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'requirements-file-test-'))
    dirs.push(dir)
    const file = join(dir, 'requirements.yaml')
    const waits: number[] = []
    let failuresLeft = 2
    const io: RequirementsFileIo = {
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
    const store = new RequirementsFileStore(file, io)
    const saved = await store.save(0, [record('alpha')])
    expect(saved).toEqual({ ok: true, revision: 1 })
    expect(waits).toEqual([20, 40])
    expect(store.load().ok && true).toBe(true)
  })
})
