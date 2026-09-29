/**
 * Reconciliation scan (decisions/0005 细化④): disk-vs-ledger both ways plus
 * the .trash listing — including the D6 revival-window convergence (an
 * on-disk directory with NO ledger record at all).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import { scanWorkbenchArtifacts } from '../../src/workbench-host/orphan-scan.js'

const RID = '11111111-1111-4111-8111-111111111111'
const RID2 = '22222222-2222-4222-8222-222222222222'
const AT = '2026-09-29T08:00:00.000Z'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-scan-'))
  dirs.push(dir)
  return dir
}

function record(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: RID,
    stage: 'understand',
    stageHistory: [{ stage: 'understand', at: AT }],
    criteria: [],
    findings: [],
    modules: [{
      id: 'M1',
      title: 'm',
      boundary: '',
      order: 0,
      dependsOn: [],
      covers: [],
      status: 'planned',
      plans: [{ version: 1, contentHash: 'a'.repeat(64) }],
      sessions: [],
      commits: [],
      acceptances: [],
    }],
    releaseItems: [],
    reviewReports: [{ id: 'rev-a1', at: AT, verdicts: [] }],
    knowledgeCandidates: [],
    ...overrides,
  }
}

function put(root: string, requirementId: string, relative: string, text = '# doc'): void {
  const target = join(root, requirementId, relative)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, text, 'utf8')
}

describe('scanWorkbenchArtifacts', () => {
  it('missing root = three empty faces (scan never fails)', () => {
    const result = scanWorkbenchArtifacts(join(tempRoot(), 'workbench'), [])
    expect(result).toEqual({ orphans: [], missing: [], trash: [] })
  })

  it('healthy layout: no orphans, no missing', () => {
    const root = tempRoot()
    put(root, RID, join('plans', 'M1-v1.md'))
    put(root, RID, join('reviews', 'rev-a1.md'))
    const result = scanWorkbenchArtifacts(root, [record()])
    expect(result.orphans).toEqual([])
    expect(result.missing).toEqual([])
    expect(result.trash).toEqual([])
  })

  it('orphan = on disk, unreferenced (plan version beyond the ledger)', () => {
    const root = tempRoot()
    put(root, RID, join('plans', 'M1-v1.md'))
    put(root, RID, join('plans', 'M1-v2.md'))
    put(root, RID, join('reviews', 'rev-a1.md'))
    const result = scanWorkbenchArtifacts(root, [record()])
    expect(result.orphans).toEqual([{ requirementId: RID, kind: 'plan', moduleId: 'M1', version: 2 }])
    expect(result.missing).toEqual([])
  })

  it('missing = in the ledger, absent on disk (dangling references)', () => {
    const root = tempRoot()
    put(root, RID, join('plans', 'M1-v1.md'))
    const result = scanWorkbenchArtifacts(root, [record()])
    expect(result.orphans).toEqual([])
    expect(result.missing).toEqual([{ requirementId: RID, kind: 'review', reviewId: 'rev-a1' }])
  })

  it('D6 revival window: a whole directory with NO ledger record is all orphans', () => {
    const root = tempRoot()
    put(root, RID2, join('plans', 'M3-v1.md'))
    put(root, RID2, join('reviews', 'rev-z9.md'))
    const result = scanWorkbenchArtifacts(root, [record()])
    expect(result.orphans).toEqual([
      { requirementId: RID2, kind: 'plan', moduleId: 'M3', version: 1 },
      { requirementId: RID2, kind: 'review', reviewId: 'rev-z9' },
    ])
  })

  it('convention-violating files report kind unknown with their name', () => {
    const root = tempRoot()
    put(root, RID, join('plans', 'M1-v1.md'))
    put(root, RID, join('plans', 'notes.txt'))
    put(root, RID, join('plans', 'M1-v2.md.9f0e0d6c-0000-4000-8000-000000000000.tmp'))
    put(root, RID, 'stray.txt')
    const result = scanWorkbenchArtifacts(root, [record()])
    expect(result.orphans).toEqual([
      { requirementId: RID, kind: 'unknown', name: 'M1-v2.md.9f0e0d6c-0000-4000-8000-000000000000.tmp' },
      { requirementId: RID, kind: 'unknown', name: 'notes.txt' },
      { requirementId: RID, kind: 'unknown', name: 'stray.txt' },
    ])
  })

  it('live-directory deleted-record.yaml is cascade bookkeeping — skipped', () => {
    const root = tempRoot()
    put(root, RID, join('plans', 'M1-v1.md'))
    put(root, RID, 'deleted-record.yaml', 'version: 1')
    const result = scanWorkbenchArtifacts(root, [record()])
    expect(result.orphans).toEqual([])
  })

  it('.trash listing: convention dirs parsed, junk skipped', () => {
    const root = tempRoot()
    put(root, RID, join('plans', 'M1-v1.md'))
    const trash = join(root, '.trash')
    mkdirSync(join(trash, `${RID}-2026-09-29T10-00-00.000Z`), { recursive: true })
    mkdirSync(join(trash, 'not-a-uuid'), { recursive: true })
    const result = scanWorkbenchArtifacts(root, [record()])
    expect(result.trash).toEqual([{ requirementId: RID, deletedAt: '2026-09-29T10-00-00.000Z' }])
  })

  it('dot-directories under the root are not requirement directories', () => {
    const root = tempRoot()
    put(root, RID, join('plans', 'M1-v1.md'))
    mkdirSync(join(root, '.staging'), { recursive: true })
    writeFileSync(join(root, '.staging', 'M1-v9.md'), 'x', 'utf8')
    const result = scanWorkbenchArtifacts(root, [record()])
    expect(result.orphans).toEqual([])
  })
})
