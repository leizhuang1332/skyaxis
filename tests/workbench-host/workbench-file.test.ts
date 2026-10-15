/**
 * WorkbenchFileStore / KnowledgeFileStore semantics — the
 * requirements-file.test.ts matrix ported as regression tests. The
 * knowledge side is a representative subset (same envelope code path);
 * its only store-adjacent extra is the KnowledgeRecordSchema superRefine
 * coupling: scope 'requirement' without requirementId degrades the whole
 * file, scope 'global' needs no ownership key.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import type { KnowledgeRecord } from '../../src/workbench-host/types.js'
import type { WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import { isWorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import { KnowledgeFileStore } from '../../src/workbench-host/knowledge-file.js'
import { WorkbenchFileStore, type WorkbenchFileIo } from '../../src/workbench-host/workbench-file.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const NOW = '2026-09-29T09:30:00.000Z'

function workbenchFixture(): { store: WorkbenchFileStore; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-file-test-'))
  dirs.push(dir)
  const file = join(dir, 'workbench.yaml')
  return { store: new WorkbenchFileStore(file), file }
}

function knowledgeFixture(): { store: KnowledgeFileStore; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-file-test-'))
  dirs.push(dir)
  const file = join(dir, 'knowledge.yaml')
  return { store: new KnowledgeFileStore(file), file }
}

function record(requirementId = randomUUID()): WorkbenchRecord {
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
  }
}

function knowledgeRow(overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
  return {
    id: randomUUID(),
    scope: 'global',
    type: 'convention',
    title: '仓库迁移守则',
    content: '推送前先核对远端分支',
    trigger: { mode: 'always' },
    status: 'active',
    provenance: { at: NOW },
    ...overrides,
  }
}

describe('WorkbenchFileStore', () => {
  describe('read/write roundtrip', () => {
    it('treats a missing file as pristine revision 0 and saves through 0→1', async () => {
      const { store, file } = workbenchFixture()
      const initial = store.load()
      expect(initial).toEqual({ ok: true, value: { version: 1, revision: 0, records: [] } })

      const [a, b] = [record(), record()]
      const saved = await store.save(0, [a, b])
      expect(saved).toEqual({ ok: true, revision: 1 })

      const loaded = store.load()
      expect(loaded.ok && loaded.value.revision).toBe(1)
      expect(loaded.ok && loaded.value.records).toHaveLength(2)
      expect(readFileSync(file, 'utf8')).toContain('stage: understand')
    })

    it('round-trips the P3a optional fields through disk — the zod-mirror drift guard', async () => {
      // The compile-time assignability aliases in types.ts cannot fire (an
      // unused `? true : never` alias never errors), so a field present on
      // the wire but missing from the zod mirror would be SILENTLY STRIPPED
      // on every load (zod drops unknown keys) — data loss with no error.
      // This roundtrip is the load-bearing mirror test: drop either field
      // from WorkbenchRecordSchema/ReleaseItemSchema and this goes red.
      const { store } = workbenchFixture()
      const stamped: WorkbenchRecord = {
        ...record(),
        rollbackPlanConfirmedAt: NOW,
        releaseItems: [{
          id: 'R0001',
          type: 'sql',
          title: 't_order 加索引',
          content: 'ALTER TABLE t_order ADD INDEX idx_created_at (created_at)',
          contentHash: 'a'.repeat(64),
          envs: ['prod'],
          status: 'pending',
          note: '随 v1.2 上线',
        }],
      }
      await store.save(0, [stamped])
      const loaded = store.load()
      expect(loaded.ok).toBe(true)
      if (!loaded.ok) return
      expect(loaded.value.records[0]?.rollbackPlanConfirmedAt).toBe(NOW)
      expect(loaded.value.records[0]?.releaseItems[0]?.note).toBe('随 v1.2 上线')
      // And the wire guard accepts exactly the same shape (both halves agree).
      expect(isWorkbenchRecord(loaded.value.records[0])).toBe(true)
    })

    it('round-trips the P5b optional fields through disk — splitBaseline + proposed verdict', async () => {
      // Same load-bearing mirror guard as the P3a test: drop splitBaseline
      // from WorkbenchRecordSchema, or 'proposed' from VERDICT_STORAGE_VALUES,
      // and zod silently strips/degrades on the next load — this goes red.
      const { store } = workbenchFixture()
      const stamped: WorkbenchRecord = {
        ...record(),
        splitApprovedAt: NOW,
        splitBaseline: { at: NOW, prd: [{ name: 'prd.md', size: 128, modifiedAt: 1700000000000 }], disposedFindings: 3 },
        reviewReports: [{
          id: 'rev-a1',
          at: NOW,
          verdicts: [{ id: '44444444-4444-4444-8444-444444444444', title: 'AI 报的发现', severity: 'high', verdict: 'proposed' }],
        }],
      }
      await store.save(0, [stamped])
      const loaded = store.load()
      expect(loaded.ok).toBe(true)
      if (!loaded.ok) return
      expect(loaded.value.records[0]?.splitBaseline).toEqual({ at: NOW, prd: [{ name: 'prd.md', size: 128, modifiedAt: 1700000000000 }], disposedFindings: 3 })
      expect(loaded.value.records[0]?.reviewReports[0]?.verdicts[0]?.verdict).toBe('proposed')
      expect(isWorkbenchRecord(loaded.value.records[0])).toBe(true)
    })

    it('round-trips the 0007 optional fields through disk — understand stamp/baseline + seed.stageReady + splitBaseline 两臂', async () => {
      // Same load-bearing mirror guard: drop understandBaseline from
      // WorkbenchRecordSchema (or stageReady from the seed schema) and zod
      // silently strips it on load — data loss with no error. This goes red.
      const { store } = workbenchFixture()
      const stamped: WorkbenchRecord = {
        ...record(),
        understandApprovedAt: NOW,
        understandBaseline: {
          at: NOW,
          criteria: [{ id: 'C1', text: '导出走异步', sourceSection: 'PRD#3.1' }],
          findings: [{ id: '44444444-4444-4444-8444-444444444444', status: 'resolved', category: 'risk', severity: 'high', title: '大表全量' }],
          clarifications: [{ question: '批量上限？', answer: '一万行' }],
        },
        splitApprovedAt: NOW,
        splitBaseline: { at: NOW, prd: [], disposedFindings: 1, understandApprovedAt: NOW, answeredClarifications: 2 },
        analysis: {
          session: { sessionId: 'sess-a', boundAt: NOW },
          seed: { sessionId: 'sess-a', contentHash: 'a'.repeat(64), seededAt: NOW, findings: 1, criteria: 1, clarifications: 2, stageReady: true },
          findings: [],
          criteria: [],
          clarifications: [],
        },
      }
      await store.save(0, [stamped])
      const loaded = store.load()
      expect(loaded.ok).toBe(true)
      if (!loaded.ok) return
      const row = loaded.value.records[0]!
      expect(row.understandApprovedAt).toBe(NOW)
      expect(row.understandBaseline).toEqual(stamped.understandBaseline)
      expect(row.splitBaseline?.understandApprovedAt).toBe(NOW)
      expect(row.splitBaseline?.answeredClarifications).toBe(2)
      expect(row.analysis?.seed?.stageReady).toBe(true)
      expect(isWorkbenchRecord(row)).toBe(true)
    })

    it('round-trips the 0008 doc anchors — understandBaseline.docHash + splitBaseline.requirementDocHash', async () => {
      const { store } = workbenchFixture()
      const stamped: WorkbenchRecord = {
        ...record(),
        understandApprovedAt: NOW,
        understandBaseline: { at: NOW, criteria: [], findings: [], clarifications: [], docHash: 'e'.repeat(64) },
        splitApprovedAt: NOW,
        splitBaseline: { at: NOW, prd: [], disposedFindings: 0, requirementDocHash: 'e'.repeat(64) },
      }
      await store.save(0, [stamped])
      const loaded = store.load()
      expect(loaded.ok).toBe(true)
      if (!loaded.ok) return
      const row = loaded.value.records[0]!
      expect(row.understandBaseline?.docHash).toBe('e'.repeat(64))
      expect(row.splitBaseline?.requirementDocHash).toBe('e'.repeat(64))
      expect(isWorkbenchRecord(row)).toBe(true)
    })

    it('parses a hand-written legal file (hand-edited yaml stays loadable)', () => {
      const { store, file } = workbenchFixture()
      writeFileSync(
        file,
        [
          'version: 1',
          'revision: 3',
          'records:',
          `  - requirementId: ${randomUUID()}`,
          '    stage: review',
          '    stageHistory:',
          '      - stage: understand',
          `        at: ${NOW}`,
          '      - stage: plan',
          '        at: 2026-09-29T10:00:00.000Z',
          '        note: 计划定稿',
          '    criteria: []',
          '    findings: []',
          '    workPackages: []',
          '    releaseItems: []',
          '    reviewReports: []',
          '    knowledgeCandidates: []',
        ].join('\n'),
        'utf8',
      )
      const loaded = store.load()
      expect(loaded.ok && loaded.value.revision).toBe(3)
      expect(loaded.ok && loaded.value.records[0]?.stage).toBe('review')
      expect(loaded.ok && loaded.value.records[0]?.stageHistory).toHaveLength(2)
    })

    it('advances revision on legal edits and keeps the previous version in .bak', async () => {
      const { store, file } = workbenchFixture()
      const first = [record()]
      await store.save(0, first)
      const second = [...first, record()]
      const saved = await store.save(1, second)
      expect(saved).toEqual({ ok: true, revision: 2 })

      expect(existsSync(`${file}.bak`)).toBe(true)
      const backup = new WorkbenchFileStore(`${file}.bak`).load()
      expect(backup.ok && backup.value.records[0]?.requirementId).toBe(first[0]!.requirementId)
      expect(backup.ok && backup.value.records).toHaveLength(1)
      const live = new WorkbenchFileStore(file).load()
      expect(live.ok && live.value.records).toHaveLength(2)
    })
  })

  describe('revision guard', () => {
    it('rejects stale revisions with the current revision reported', async () => {
      const { store } = workbenchFixture()
      await store.save(0, [record()])
      await store.save(1, [record(), record()])
      const stale = await store.save(1, [record()])
      expect(stale).toEqual({ ok: false, rejected: 'stale-revision', currentRevision: 2 })
    })

    it('serializes concurrent saves with the same expectedRevision: exactly one wins', async () => {
      const { store } = workbenchFixture()
      await store.save(0, [record()])
      const [a, b] = await Promise.all([
        store.save(1, [record(), record()]),
        store.save(1, [record(), record()]),
      ])
      const outcomes = [a, b].map((r) => (r.ok ? 'ok' : r.rejected))
      expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1)
      expect(outcomes.filter((o) => o === 'stale-revision')).toHaveLength(1)
      const loser = [a, b].find((r): r is typeof a => !r.ok) ?? a
      expect(loser.ok).toBe(false)
      expect(loser.ok === false && loser.rejected === 'stale-revision' && loser.currentRevision).toBe(2)
      const loaded = store.load()
      expect(loaded.ok && loaded.value.revision).toBe(2)
      expect(loaded.ok && loaded.value.records).toHaveLength(2)
    })
  })

  describe('degraded loads never throw', () => {
    it('degrades parse failures and schema mismatches separately', async () => {
      const { store, file } = workbenchFixture()
      // Two saves so a .bak exists (backup is only taken when the main file exists).
      await store.save(0, [record()])
      await store.save(1, [record(), record()])

      writeFileSync(file, 'records: [ 这不是合法 YAML :::\n  - {broken', 'utf8')
      const parse = store.load()
      expect(parse.ok).toBe(false)
      expect(parse.ok === false && parse.reason).toBe('parse')
      expect(parse.ok === false && parse.hasBackup).toBe(true)

      writeFileSync(
        file,
        [
          'version: 1',
          'revision: 0',
          'records:',
          `  - requirementId: ${randomUUID()}`,
          '    stage: bogus',
          '    stageHistory: []',
          '    criteria: []',
          '    findings: []',
          '    workPackages: []',
          '    releaseItems: []',
          '    reviewReports: []',
          '    knowledgeCandidates: []',
        ].join('\n'),
        'utf8',
      )
      const schema = store.load()
      expect(schema.ok).toBe(false)
      expect(schema.ok === false && schema.reason).toBe('schema')
      expect(schema.ok === false && schema.detail).toContain('stage')
    })

    it('degrades io failures when the path is unreadable', () => {
      const { store, file } = workbenchFixture()
      // A directory where the yaml should be: existsSync passes, readFileSync throws.
      mkdirSync(file)
      const io = store.load()
      expect(io.ok).toBe(false)
      expect(io.ok === false && io.reason).toBe('io')
      expect(io.ok === false && io.hasBackup).toBe(false)
    })

    it('recovers from .bak after manual restore', async () => {
      const { store, file } = workbenchFixture()
      const first = [record()]
      await store.save(0, first)
      await store.save(1, [...first, record()])
      writeFileSync(file, 'broken: [', 'utf8')
      copyFileSync(`${file}.bak`, file)
      const recovered = store.load()
      expect(recovered.ok && recovered.value.records[0]?.requirementId).toBe(first[0]!.requirementId)
      expect(recovered.ok && recovered.value.records).toHaveLength(1)
    })

    it('refuses to save over an unreadable file (preserve the scene)', async () => {
      const { store, file } = workbenchFixture()
      await store.save(0, [record()])
      writeFileSync(file, 'broken: [', 'utf8')
      const refused = await store.save(1, [])
      expect(refused).toEqual({ ok: false, rejected: 'unreadable-file' })
      expect(readFileSync(file, 'utf8')).toBe('broken: [')
    })
  })

  describe('rename backoff (injected io)', () => {
    it('retries EPERM transients with escalating waits and succeeds', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'workbench-file-test-'))
      dirs.push(dir)
      const file = join(dir, 'workbench.yaml')
      const waits: number[] = []
      let failuresLeft = 2
      const io: WorkbenchFileIo = {
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
      const store = new WorkbenchFileStore(file, io)
      const saved = await store.save(0, [record()])
      expect(saved).toEqual({ ok: true, revision: 1 })
      expect(waits).toEqual([20, 40])
      expect(store.load().ok && true).toBe(true)
    })
  })
})

describe('KnowledgeFileStore', () => {
  describe('read/write roundtrip (representative subset)', () => {
    it('treats a missing file as pristine revision 0 and advances revision with .bak', async () => {
      const { store, file } = knowledgeFixture()
      const initial = store.load()
      expect(initial).toEqual({ ok: true, value: { version: 1, revision: 0, records: [] } })

      const first = [knowledgeRow()]
      await store.save(0, first)
      const second = [...first, knowledgeRow({ scope: 'requirement', requirementId: randomUUID(), title: '需求级守则' })]
      const saved = await store.save(1, second)
      expect(saved).toEqual({ ok: true, revision: 2 })

      expect(existsSync(`${file}.bak`)).toBe(true)
      const backup = new KnowledgeFileStore(`${file}.bak`).load()
      expect(backup.ok && backup.value.records).toHaveLength(1)
      const live = store.load()
      expect(live.ok && live.value.records).toHaveLength(2)
      expect(readFileSync(file, 'utf8')).toContain('需求级守则')
    })
  })

  describe('revision guard', () => {
    it('serializes concurrent saves with the same expectedRevision: exactly one wins', async () => {
      const { store } = knowledgeFixture()
      await store.save(0, [knowledgeRow()])
      const [a, b] = await Promise.all([
        store.save(1, [knowledgeRow(), knowledgeRow()]),
        store.save(1, [knowledgeRow(), knowledgeRow()]),
      ])
      const outcomes = [a, b].map((r) => (r.ok ? 'ok' : r.rejected))
      expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1)
      expect(outcomes.filter((o) => o === 'stale-revision')).toHaveLength(1)
      const loaded = store.load()
      expect(loaded.ok && loaded.value.revision).toBe(2)
    })
  })

  describe('degraded loads never throw', () => {
    it('degrades parse failures with .bak availability reported', async () => {
      const { store, file } = knowledgeFixture()
      await store.save(0, [knowledgeRow()])
      await store.save(1, [knowledgeRow(), knowledgeRow()])

      writeFileSync(file, 'records: [ 这不是合法 YAML :::\n  - {broken', 'utf8')
      const parse = store.load()
      expect(parse.ok).toBe(false)
      expect(parse.ok === false && parse.reason).toBe('parse')
      expect(parse.ok === false && parse.hasBackup).toBe(true)
    })

    it('refuses to save over an unreadable file (preserve the scene)', async () => {
      const { store, file } = knowledgeFixture()
      await store.save(0, [knowledgeRow()])
      writeFileSync(file, 'broken: [', 'utf8')
      const refused = await store.save(1, [])
      expect(refused).toEqual({ ok: false, rejected: 'unreadable-file' })
      expect(readFileSync(file, 'utf8')).toBe('broken: [')
    })
  })

  describe('superRefine coupling (KnowledgeRecordSchema)', () => {
    it('keeps scope global loadable without ownership keys and degrades requirement scope missing requirementId', async () => {
      const { store, file } = knowledgeFixture()
      // Positive side through the store: global needs nothing; requirement scope with the key passes.
      const saved = await store.save(0, [
        knowledgeRow(),
        knowledgeRow({ scope: 'requirement', requirementId: randomUUID() }),
      ])
      expect(saved).toEqual({ ok: true, revision: 1 })

      // Negative side by hand: requirement scope without requirementId → whole file schema-degraded.
      writeFileSync(
        file,
        [
          'version: 1',
          'revision: 0',
          'records:',
          `  - id: ${randomUUID()}`,
          '    scope: requirement',
          '    type: convention',
          '    title: 需求级知识',
          '    content: ""',
          '    trigger: { mode: always }',
          '    status: active',
          `    provenance: { at: ${NOW} }`,
        ].join('\n'),
        'utf8',
      )
      const degraded = store.load()
      expect(degraded.ok).toBe(false)
      expect(degraded.ok === false && degraded.reason).toBe('schema')
      expect(degraded.ok === false && degraded.detail).toContain('requirementId')
    })
  })
})
