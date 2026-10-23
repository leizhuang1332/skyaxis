/**
 * 0032 per-requirement record shards (decisions/0032): independent
 * optimistic locks, virtual revision 0 for absent records, per-shard
 * degradation with .bak, the shard/dir ownership match, cascade's unlink
 * face, and the one-time legacy migration (commit-point rename, crash
 * re-run, degraded-source blocking, no shadow-minting while the legacy file
 * still owns the truth).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import type { WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import { WorkbenchRecordStore, type RecordStoreIo } from '../../src/workbench-host/record-store.js'
import { WorkbenchFileStore } from '../../src/workbench-host/workbench-file.js'

const RID = '11111111-1111-4111-8111-111111111111'
const RID2 = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-10-23T08:00:00.000Z'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function record(requirementId: string, overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
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

function fixture(): { dir: string; root: string; legacyPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'record-store-test-'))
  dirs.push(dir)
  return { dir, root: join(dir, 'workbench'), legacyPath: join(dir, 'workbench.yaml') }
}

describe('WorkbenchRecordStore: shards and locks', () => {
  it('answers a pristine store as missing records and an empty list', () => {
    const fx = fixture()
    const store = new WorkbenchRecordStore(fx.root, fx.legacyPath)
    expect(store.loadRecord(RID)).toEqual({ ok: false, missing: true })
    expect(store.listAll()).toEqual({ ok: true, rows: [], degradedRows: [] })
  })

  it('creates a shard at revision 1 (virtual 0 → 1) and loads it back', async () => {
    const fx = fixture()
    const store = new WorkbenchRecordStore(fx.root, fx.legacyPath)
    const saved = await store.saveRecord(RID, 0, record(RID))
    expect(saved).toEqual({ ok: true, revision: 1 })
    const load = store.loadRecord(RID)
    expect(load.ok).toBe(true)
    expect(load.ok && load.value.revision).toBe(1)
    expect(load.ok && load.value.record.stage).toBe('understand')
    expect(existsSync(store.recordPath(RID))).toBe(true)
  })

  it('rejects a stale revision against a live shard', async () => {
    const fx = fixture()
    const store = new WorkbenchRecordStore(fx.root, fx.legacyPath)
    await store.saveRecord(RID, 0, record(RID))
    const stale = await store.saveRecord(RID, 0, record(RID))
    expect(stale).toEqual({ ok: false, rejected: 'stale-revision', currentRevision: 1 })
  })

  it('rejects a non-zero expectation against a MISSING shard (virtual 0)', async () => {
    const fx = fixture()
    const store = new WorkbenchRecordStore(fx.root, fx.legacyPath)
    const stale = await store.saveRecord(RID, 5, record(RID))
    expect(stale).toEqual({ ok: false, rejected: 'stale-revision', currentRevision: 0 })
    expect(store.loadRecord(RID)).toEqual({ ok: false, missing: true })
  })

  it('keeps revisions independent across records (no cross-record lock)', async () => {
    const fx = fixture()
    const store = new WorkbenchRecordStore(fx.root, fx.legacyPath)
    await store.saveRecord(RID, 0, record(RID))
    await store.saveRecord(RID, 1, record(RID))
    await store.saveRecord(RID2, 0, record(RID2))
    const loadA = store.loadRecord(RID)
    const loadB = store.loadRecord(RID2)
    expect(loadA.ok && loadA.value.revision).toBe(2)
    expect(loadB.ok && loadB.value.revision).toBe(1)
    // A write under RID2's fresh revision lands although RID moved on — the
    // single-file era's cross-record 409 is gone.
    const saved = await store.saveRecord(RID2, 1, record(RID2, { stage: 'plan' }))
    expect(saved).toEqual({ ok: true, revision: 2 })
  })

  it('serializes concurrent same-expectation saves to exactly one winner', async () => {
    const fx = fixture()
    const store = new WorkbenchRecordStore(fx.root, fx.legacyPath)
    await store.saveRecord(RID, 0, record(RID))
    const results = await Promise.all([
      store.saveRecord(RID, 1, record(RID, { stage: 'plan' })),
      store.saveRecord(RID, 1, record(RID, { stage: 'implement' })),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok && r.rejected === 'stale-revision')).toHaveLength(1)
  })

  it('refuses to write a record whose requirementId disagrees with the shard', async () => {
    const fx = fixture()
    const store = new WorkbenchRecordStore(fx.root, fx.legacyPath)
    // Programmer-bug defense (the artifact-path reject discipline): a
    // synchronous throw, not a rejected envelope.
    expect(() => store.saveRecord(RID, 0, record(RID2))).toThrow(/mismatch/)
  })

  it('degrades ONE corrupted shard without touching its neighbours', async () => {
    const fx = fixture()
    const store = new WorkbenchRecordStore(fx.root, fx.legacyPath)
    await store.saveRecord(RID, 0, record(RID))
    await store.saveRecord(RID, 1, record(RID)) // second save so a .bak exists
    await store.saveRecord(RID2, 0, record(RID2))
    writeFileSync(store.recordPath(RID), 'broken: [', 'utf8')

    const degraded = store.loadRecord(RID)
    expect(degraded.ok).toBe(false)
    expect(!degraded.ok && !degraded.missing && degraded.degraded).toBe(true)
    expect(!degraded.ok && !degraded.missing && degraded.reason).toBe('parse')
    expect(!degraded.ok && !degraded.missing && degraded.hasBackup).toBe(true)

    const listed = store.listAll()
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      expect(listed.rows.map((row) => row.requirementId)).toEqual([RID2])
      expect(listed.degradedRows).toEqual([{ requirementId: RID, reason: 'parse', hasBackup: true }])
    }

    // Writes refuse to overwrite the unreadable shard (preserve the scene).
    const refused = await store.saveRecord(RID, 1, record(RID))
    expect(refused).toEqual({ ok: false, rejected: 'unreadable-file' })
  })

  it('rejects a shard copied into another requirement\'s directory (dir/dir-owner match)', async () => {
    const fx = fixture()
    const store = new WorkbenchRecordStore(fx.root, fx.legacyPath)
    await store.saveRecord(RID, 0, record(RID))
    // Copy RID's shard bytes into RID2's directory.
    mkdirSync(join(fx.root, RID2), { recursive: true })
    copyFileSync(store.recordPath(RID), store.recordPath(RID2))
    const load = store.loadRecord(RID2)
    expect(load.ok).toBe(false)
    expect(!load.ok && !load.missing && load.reason).toBe('schema')
    expect(!load.ok && !load.missing && load.detail).toContain('shard/dir mismatch')
  })

  it('removeRecord unlinks the shard and its .bak, idempotently', async () => {
    const fx = fixture()
    const store = new WorkbenchRecordStore(fx.root, fx.legacyPath)
    await store.saveRecord(RID, 0, record(RID))
    await store.saveRecord(RID, 1, record(RID))
    expect(existsSync(`${store.recordPath(RID)}.bak`)).toBe(true)
    store.removeRecord(RID)
    expect(existsSync(store.recordPath(RID))).toBe(false)
    expect(existsSync(`${store.recordPath(RID)}.bak`)).toBe(false)
    // Idempotent: a re-run over the already-gone shard never throws. The
    // artifacts directory itself stays (plans/reviews ride the cascade's
    // step ⑤ rename).
    expect(() => store.removeRecord(RID)).not.toThrow()
    expect(store.loadRecord(RID)).toEqual({ ok: false, missing: true })
  })

  it('throws on a non-uuid requirementId before any path join', () => {
    const fx = fixture()
    const store = new WorkbenchRecordStore(fx.root, fx.legacyPath)
    expect(() => store.loadRecord('not-a-uuid')).toThrow(/not a lowercase uuid/)
    expect(() => store.saveRecord('../escape', 0, record('../escape'))).toThrow()
  })
})

describe('WorkbenchRecordStore: legacy migration (D2)', () => {
  it('splits a readable legacy ledger at construction: shards at revision 1, legacy renamed .migrated', async () => {
    const fx = fixture()
    const legacy = new WorkbenchFileStore(fx.legacyPath)
    const saved = await legacy.save(0, [record(RID), record(RID2, { stage: 'plan' })])
    expect(saved.ok).toBe(true)
    // A second save so a legacy .bak exists — it must ride the rename.
    await legacy.save(1, [record(RID), record(RID2, { stage: 'plan' }), record('33333333-3333-4333-8333-333333333333')])
    expect(existsSync(`${fx.legacyPath}.bak`)).toBe(true)

    const store = new WorkbenchRecordStore(fx.root, fx.legacyPath)
    expect(existsSync(fx.legacyPath)).toBe(false)
    expect(existsSync(`${fx.legacyPath}.migrated`)).toBe(true)
    expect(existsSync(`${fx.legacyPath}.bak`)).toBe(false)
    expect(existsSync(`${fx.legacyPath}.bak.migrated`)).toBe(true)
    const listed = store.listAll()
    expect(listed.ok && listed.rows).toHaveLength(3)
    expect(listed.ok && listed.rows.every((row) => row.revision === 1)).toBe(true)
    // The migrated text is intact for audit.
    expect(readFileSync(`${fx.legacyPath}.migrated`, 'utf8')).toContain(RID)
  })

  it('re-runs idempotently after a crash before the commit rename', async () => {
    const fx = fixture()
    const legacy = new WorkbenchFileStore(fx.legacyPath)
    await legacy.save(0, [record(RID)])
    // Simulate the crash window: shard writes land (tmp→path renames fine),
    // only the migration commit rename keeps failing.
    const io: RecordStoreIo = {
      rename: (from, to) => {
        if (to.endsWith('.migrated')) throw Object.assign(new Error('crash window'), { code: 'EPERM' })
        renameSync(from, to)
      },
      wait: () => {},
    }
    const crashed = new WorkbenchRecordStore(fx.root, fx.legacyPath, io)
    expect(existsSync(fx.legacyPath)).toBe(true)
    expect(existsSync(crashed.recordPath(RID))).toBe(true)

    // A healthy store re-runs the whole migration (force-seed overwrite) and
    // completes the rename.
    const store = new WorkbenchRecordStore(fx.root, fx.legacyPath)
    expect(existsSync(fx.legacyPath)).toBe(false)
    const load = store.loadRecord(RID)
    expect(load.ok && load.value.revision).toBe(1)
  })

  it('blocks the whole store over a DEGRADED legacy file (preserve the scene)', async () => {
    const fx = fixture()
    const legacy = new WorkbenchFileStore(fx.legacyPath)
    await legacy.save(0, [record(RID)])
    await legacy.save(1, [record(RID)]) // .bak exists
    writeFileSync(fx.legacyPath, 'broken: [', 'utf8')

    const store = new WorkbenchRecordStore(fx.root, fx.legacyPath)
    // The scene stays for manual recovery.
    expect(existsSync(fx.legacyPath)).toBe(true)
    const blocked = store.loadRecord(RID)
    expect(blocked.ok).toBe(false)
    expect(!blocked.ok && !blocked.missing && blocked.reason).toBe('parse')
    expect(!blocked.ok && !blocked.missing && blocked.hasBackup).toBe(true)
    const listed = store.listAll()
    expect(listed.ok).toBe(false)
    const refused = await store.saveRecord(RID, 0, record(RID))
    expect(refused).toEqual({ ok: false, rejected: 'unreadable-file' })

    // Repair the legacy file → the next entry point migrates and unblocks.
    // (Direct write — the legacy store's own save refuses over unreadable
    // files, the same preserve-the-scene contract the block upholds.)
    writeFileSync(fx.legacyPath, YAML.stringify({ version: 1, revision: 0, records: [record(RID)] }), 'utf8')
    const load = store.loadRecord(RID)
    expect(load.ok && load.value.record.requirementId).toBe(RID)
    expect(existsSync(fx.legacyPath)).toBe(false)
  })

  it('never shadow-mints while an unrenamed legacy still owns the truth', async () => {
    const fx = fixture()
    const legacy = new WorkbenchFileStore(fx.legacyPath)
    await legacy.save(0, [record(RID, { stage: 'deliver' })])
    // Every rename fails (EPERM): seeds land but the commit point never does.
    const io: RecordStoreIo = {
      rename: (from, to) => {
        if (to.endsWith('.migrated')) throw Object.assign(new Error('locked'), { code: 'EPERM' })
        renameSync(from, to)
      },
      wait: () => {},
    }
    const store = new WorkbenchRecordStore(fx.root, fx.legacyPath, io)
    // Reads/writes answer the blocked state — a fresh revision-1 shard must
    // not silently replace the legacy record.
    const blocked = store.loadRecord(RID)
    expect(!blocked.ok && !blocked.missing && blocked.reason).toBe('io')
    const refused = await store.saveRecord(RID, 0, record(RID))
    expect(refused).toEqual({ ok: false, rejected: 'unreadable-file' })
  })
})
