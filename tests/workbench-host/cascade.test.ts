/**
 * D6 graded cascade (decisions/0005): the pinned order ①→②→③④⑤ across the
 * two-phase interface, per-step failure injection (tombstone io throw, stale
 * ledger save, EPERM/EBUSY rename), scope-split knowledge removal, degraded
 * ledgers never blocking a delete, and idempotent re-runs.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import { WorkbenchCascadeService, type CascadeIo } from '../../src/workbench-host/cascade-service.js'
import { KnowledgeFileStore } from '../../src/workbench-host/knowledge-file.js'
import { WorkbenchFileStore } from '../../src/workbench-host/workbench-file.js'

const RID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-09-29T08:00:00.000Z'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function requirement(): RequirementRecord {
  return { id: RID, title: '订单导出优化', description: '', workspacePath: '', linkedRepos: [], createdAt: AT, updatedAt: AT }
}

function workbenchRecord(): WorkbenchRecord {
  return {
    requirementId: RID,
    stage: 'plan',
    stageHistory: [{ stage: 'understand', at: AT }, { stage: 'plan', at: AT }],
    criteria: [],
    findings: [],
    workPackages: [{
      id: 'WP1', title: 'm', boundary: '', order: 0, dependsOn: [], covers: [], status: 'planned',
      plans: [{ version: 1, contentHash: 'a'.repeat(64) }], sessions: [], commits: [], acceptances: [],
    }],
    releaseItems: [],
    reviewReports: [],
    knowledgeCandidates: [],
  }
}

function knowledgeRow(id: string, scope: 'global' | 'workspace' | 'requirement') {
  return {
    id,
    scope,
    type: 'business' as const,
    title: `知识-${scope}`,
    content: '内容',
    ...(scope === 'workspace' ? { path: 'C:/repos/main' } : {}),
    ...(scope === 'requirement' ? { requirementId: RID } : {}),
    trigger: { mode: 'always' as const },
    status: 'active' as const,
    provenance: { at: AT },
  }
}

interface Fixture {
  dir: string
  root: string
  workbenchFile: WorkbenchFileStore
  knowledgeFile: KnowledgeFileStore
  logs: unknown[]
  records(): readonly WorkbenchRecord[]
  knowledgeScopes(): readonly string[]
}

async function setup(seed?: { workbench?: readonly WorkbenchRecord[]; knowledge?: readonly unknown[] }): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-cascade-'))
  dirs.push(dir)
  const root = join(dir, 'workbench')
  const workbenchFile = new WorkbenchFileStore(join(dir, 'workbench.yaml'))
  const knowledgeFile = new KnowledgeFileStore(join(dir, 'knowledge.yaml'))
  const savedWorkbench = await workbenchFile.save(0, seed?.workbench ?? [workbenchRecord()])
  expect(savedWorkbench.ok).toBe(true)
  const savedKnowledge = await knowledgeFile.save(0, (seed?.knowledge ?? [
    knowledgeRow('22222222-2222-4222-8222-222222222222', 'requirement'),
    knowledgeRow('33333333-3333-4333-8333-333333333333', 'global'),
    knowledgeRow('44444444-4444-4444-8444-444444444444', 'workspace'),
  ]) as never)
  expect(savedKnowledge.ok).toBe(true)
  const logs: unknown[] = []
  const records = () => {
    const load = workbenchFile.load()
    return load.ok ? load.value.records : []
  }
  const knowledgeScopes = () => {
    const load = knowledgeFile.load()
    return load.ok ? load.value.records.map((row) => row.scope) : []
  }
  return { dir, root, workbenchFile, knowledgeFile, logs, records, knowledgeScopes }
}

function cascade(fx: Fixture, io?: CascadeIo): WorkbenchCascadeService {
  return new WorkbenchCascadeService({
    workbenchFile: fx.workbenchFile,
    knowledgeFile: fx.knowledgeFile,
    workbenchRoot: fx.root,
    log: (error) => fx.logs.push(error),
    ...(io !== undefined ? { io } : {}),
  })
}

/** Tombstone writer that bypasses the atomic ArtifactStore (plain mkdir+write). */
function plainTombstone(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text, 'utf8')
}

function ioWith(overrides: Partial<CascadeIo>): CascadeIo {
  return { rename: renameSync, writeTombstone: plainTombstone, ...overrides }
}

function errno(code: string): Error & { code: string } {
  const error = new Error(`${code} simulated`) as Error & { code: string }
  error.code = code
  return error
}

function trashEntries(root: string): string[] {
  const trash = join(root, '.trash')
  return existsSync(trash) ? readdirSync(trash) : []
}

function readTombstone(root: string, trashName: string): Record<string, unknown> {
  return YAML.parse(readFileSync(join(root, '.trash', trashName, 'deleted-record.yaml'), 'utf8')) as Record<string, unknown>
}

describe('WorkbenchCascadeService: full run', () => {
  it('archives everything in the pinned order with a three-segment tombstone snapshot', async () => {
    const fx = await setup()
    const service = cascade(fx)

    // Step ① — tombstone into the LIVE directory; ledgers untouched, no trash yet.
    service.beginRemoval(requirement())
    expect(existsSync(join(fx.root, RID, 'deleted-record.yaml'))).toBe(true)
    expect(fx.records()).toHaveLength(1)
    expect(existsSync(join(fx.root, '.trash'))).toBe(false)

    // Steps ③④⑤.
    await service.completeRemoval(requirement())
    expect(fx.records()).toHaveLength(0)
    // Scope split: requirement-scope gone, global/workspace untouched.
    expect([...fx.knowledgeScopes()].sort()).toEqual(['global', 'workspace'])

    const entries = trashEntries(fx.root)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatch(new RegExp(`^${RID}-\\d{4}-\\d{2}-\\d{2}T`))
    expect(entries[0]).not.toContain(':')
    const tombstone = readTombstone(fx.root, entries[0]!)
    expect(tombstone['version']).toBe(1)
    expect((tombstone['requirement'] as Record<string, unknown>)['id']).toBe(RID)
    expect((tombstone['workbench'] as Record<string, unknown>)['requirementId']).toBe(RID)
    expect(tombstone['knowledge']).toHaveLength(1)
    expect(existsSync(join(fx.root, RID))).toBe(false)
    expect(fx.logs).toHaveLength(0)
  })

  it('beginRemoval alone is side-effect-bounded: tombstone only, no ledger change, no trash', async () => {
    const fx = await setup()
    cascade(fx).beginRemoval(requirement())
    expect(fx.records()).toHaveLength(1)
    expect(existsSync(join(fx.root, '.trash'))).toBe(false)
  })
})

describe('WorkbenchCascadeService: per-step failure injection', () => {
  it('tombstone write failure degrades to a tombstone-less archive — later steps all run', async () => {
    const fx = await setup()
    // Pre-existing artifacts on disk (the tombstone write fails, but there
    // IS a directory worth archiving — rename must still run).
    const planFile = join(fx.root, RID, 'plans', 'WP1-v1.md')
    mkdirSync(join(planFile, '..'), { recursive: true })
    writeFileSync(planFile, '# plan', 'utf8')
    const service = cascade(fx, ioWith({ writeTombstone: () => { throw new Error('disk full') } }))
    service.beginRemoval(requirement())
    expect(fx.logs).toHaveLength(1)
    await service.completeRemoval(requirement())
    expect(fx.records()).toHaveLength(0)
    const entries = trashEntries(fx.root)
    expect(entries).toHaveLength(1)
    expect(existsSync(join(fx.root, '.trash', entries[0]!, 'deleted-record.yaml'))).toBe(false)
    expect(existsSync(join(fx.root, '.trash', entries[0]!, 'plans', 'WP1-v1.md'))).toBe(true)
  })

  it('stale workbench save does not short-circuit knowledge cleanup or the rename', async () => {
    const fx = await setup()
    class StaleOnceStore extends WorkbenchFileStore {
      saveCalls = 0
      #calls = 0
      override save(expectedRevision: number, records: readonly WorkbenchRecord[]) {
        this.saveCalls += 1
        this.#calls += 1
        if (this.#calls === 1) {
          return Promise.resolve({ ok: false as const, rejected: 'stale-revision' as const, currentRevision: 99 })
        }
        return super.save(expectedRevision, records)
      }
    }
    const staleOnce = new StaleOnceStore(fx.workbenchFile.filePath)
    const service = new WorkbenchCascadeService({
      workbenchFile: staleOnce,
      knowledgeFile: fx.knowledgeFile,
      workbenchRoot: fx.root,
      log: (error) => fx.logs.push(error),
    })
    service.beginRemoval(requirement())
    await service.completeRemoval(requirement())
    expect(staleOnce.saveCalls).toBe(1)
    // Step ③ failed (record residue tolerated) — ④⑤ still ran.
    expect(fx.records()).toHaveLength(1)
    expect(fx.knowledgeScopes()).toEqual(['global', 'workspace'])
    expect(trashEntries(fx.root)).toHaveLength(1)
    expect(fx.logs.length).toBeGreaterThan(0)
  })

  it('rename EPERM degrades to in-place residue (lossless) and is logged', async () => {
    const fx = await setup()
    const service = cascade(fx, ioWith({ rename: () => { throw errno('EPERM') } }))
    service.beginRemoval(requirement())
    await service.completeRemoval(requirement())
    expect(fx.records()).toHaveLength(0)
    expect(existsSync(join(fx.root, RID, 'deleted-record.yaml'))).toBe(true)
    expect(trashEntries(fx.root)).toHaveLength(0)
    expect(fx.logs).toHaveLength(1)
  })

  it('rename EBUSY takes the same degradation path', async () => {
    const fx = await setup()
    const service = cascade(fx, ioWith({ rename: () => { throw errno('EBUSY') } }))
    service.beginRemoval(requirement())
    await service.completeRemoval(requirement())
    expect(existsSync(join(fx.root, RID))).toBe(true)
    expect(fx.logs).toHaveLength(1)
  })

  it('degraded ledgers snapshot their segment as null and never block the delete', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-cascade-'))
    dirs.push(dir)
    const root = join(dir, 'workbench')
    writeFileSync(join(dir, 'workbench.yaml'), 'broken: [', 'utf8')
    writeFileSync(join(dir, 'knowledge.yaml'), 'broken: [', 'utf8')
    const logs: unknown[] = []
    const service = new WorkbenchCascadeService({
      workbenchFile: new WorkbenchFileStore(join(dir, 'workbench.yaml')),
      knowledgeFile: new KnowledgeFileStore(join(dir, 'knowledge.yaml')),
      workbenchRoot: root,
      log: (error) => logs.push(error),
    })

    service.beginRemoval(requirement())
    const liveTombstone = YAML.parse(readFileSync(join(root, RID, 'deleted-record.yaml'), 'utf8')) as Record<string, unknown>
    expect(liveTombstone['workbench']).toBeNull()
    expect(liveTombstone['knowledge']).toEqual([])

    await service.completeRemoval(requirement())
    expect(trashEntries(root)).toHaveLength(1)
    expect(logs.length).toBeGreaterThanOrEqual(2)
  })
})

describe('WorkbenchCascadeService: idempotent re-runs', () => {
  it('a second completeRemoval after success is a no-op (no duplicate trash entry)', async () => {
    const fx = await setup()
    const service = cascade(fx)
    service.beginRemoval(requirement())
    await service.completeRemoval(requirement())
    await service.completeRemoval(requirement())
    expect(trashEntries(fx.root)).toHaveLength(1)
    expect(fx.records()).toHaveLength(0)
  })

  it('a residue re-run converges once the lock is gone', async () => {
    const fx = await setup()
    let locked = true
    const service = cascade(fx, ioWith({
      rename: (from, to) => {
        if (locked) throw errno('EPERM')
        renameSync(from, to)
      },
    }))
    service.beginRemoval(requirement())
    await service.completeRemoval(requirement())
    expect(existsSync(join(fx.root, RID))).toBe(true)

    locked = false
    await service.completeRemoval(requirement())
    expect(existsSync(join(fx.root, RID))).toBe(false)
    expect(trashEntries(fx.root)).toHaveLength(1)
  })
})

describe('WorkbenchCascadeService: workbench-unused requirement', () => {
  it('still archives a tombstone-only directory', async () => {
    const fx = await setup({ workbench: [], knowledge: [] })
    const service = cascade(fx)
    service.beginRemoval(requirement())
    await service.completeRemoval(requirement())
    const entries = trashEntries(fx.root)
    expect(entries).toHaveLength(1)
    const tombstone = readTombstone(fx.root, entries[0]!)
    expect(tombstone['workbench']).toBeNull()
    expect(tombstone['knowledge']).toEqual([])
  })
})
