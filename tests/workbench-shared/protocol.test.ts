/**
 * Wire protocol guards (0006 P1b, decisions/0005 细化② narrow-regex defense
 * layer 1 + the browser-side guard family): enum matrices, optional-field
 * tolerance, envelope shapes.
 */
import { describe, expect, it } from 'vitest'
import type {
  ArtifactWriteResponseOk,
  PlanEntry,
  ReleaseItem,
  ReviewReportEntry,
  KnowledgeCandidate,
  WorkbenchFinding,
  WorkbenchCriterion,
  WorkbenchWorkPackage,
  WorkbenchRecord,
} from '../../src/workbench-shared/protocol.js'
import {
  WORKBENCH_INLINE_MAX_CHARS,
  WORKBENCH_STAGES,
  isArtifactContentResponse,
  isArtifactWriteResponseOk,
  isErrorResponse,
  isWorkPackageId,
  isPlanVersion,
  isReviewId,
  isWorkbenchDetailResponse,
  isWorkbenchListResponse,
  isWorkbenchRecord,
  isWorkbenchSaveResponseOk,
  isWorkbenchScanResponse,
} from '../../src/workbench-shared/protocol.js'

const RID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-09-29T08:00:00.000Z'

function planEntry(overrides: Partial<PlanEntry> = {}): PlanEntry {
  return { version: 1, contentHash: 'a'.repeat(64), ...overrides }
}

function workPackage(overrides: Partial<WorkbenchWorkPackage> = {}): WorkbenchWorkPackage {
  return {
    id: 'WP1',
    title: '订单导出工作包',
    boundary: 't_order 查询与导出',
    order: 0,
    dependsOn: [],
    covers: [],
    status: 'planned',
    plans: [planEntry()],
    sessions: [],
    commits: [],
    acceptances: [],
    ...overrides,
  }
}

function finding(overrides: Partial<WorkbenchFinding> = {}): WorkbenchFinding {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    category: 'risk',
    severity: 'medium',
    title: '全量导出有慢查询风险',
    detail: 't_order 无索引',
    status: 'open',
    createdAt: AT,
    ...overrides,
  }
}

function criterion(overrides: Partial<WorkbenchCriterion> = {}): WorkbenchCriterion {
  return { id: 'C1', text: '导出耗时 ≤ 5s', coveredBy: [], ...overrides }
}

function reviewReport(overrides: Partial<ReviewReportEntry> = {}): ReviewReportEntry {
  return {
    id: 'rev-2026-09-29-a1',
    at: AT,
    contentHash: 'b'.repeat(64),
    verdicts: [{ title: '缺回滚预案', severity: 'high', verdict: 'confirmed' }],
    ...overrides,
  }
}

function releaseItem(overrides: Partial<ReleaseItem> = {}): ReleaseItem {
  return {
    id: 'R0001',
    type: 'sql',
    title: 't_order 加索引',
    content: 'ALTER TABLE t_order ADD INDEX ...',
    contentHash: 'c'.repeat(64),
    envs: ['prod'],
    status: 'pending',
    ...overrides,
  }
}

function candidate(overrides: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    title: '导出功能必须走异步 + id 滚动',
    draft: '大表导出禁止全量一次拉取',
    type: 'convention',
    at: AT,
    status: 'pending',
    ...overrides,
  }
}

function record(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: RID,
    stage: 'understand',
    stageHistory: [{ stage: 'understand', at: AT }],
    criteria: [criterion()],
    findings: [finding()],
    workPackages: [workPackage()],
    releaseItems: [releaseItem()],
    reviewReports: [reviewReport()],
    knowledgeCandidates: [candidate()],
    ...overrides,
  }
}

describe('narrow id predicates (细化② layer 1)', () => {
  it('isWorkPackageId accepts M-prefixed positive integers only', () => {
    expect(isWorkPackageId('WP1')).toBe(true)
    expect(isWorkPackageId('WP12')).toBe(true)
    expect(isWorkPackageId('WP0')).toBe(false)
    expect(isWorkPackageId('WP01')).toBe(false)
    expect(isWorkPackageId('M')).toBe(false)
    expect(isWorkPackageId('wp1')).toBe(false)
    expect(isWorkPackageId('WP1a')).toBe(false)
    expect(isWorkPackageId('')).toBe(false)
    expect(isWorkPackageId('WP1 ')).toBe(false)
  })

  it('isPlanVersion accepts positive integers only', () => {
    expect(isPlanVersion(1)).toBe(true)
    expect(isPlanVersion(99)).toBe(true)
    expect(isPlanVersion(0)).toBe(false)
    expect(isPlanVersion(-1)).toBe(false)
    expect(isPlanVersion(1.5)).toBe(false)
    expect(isPlanVersion(Number.NaN)).toBe(false)
  })

  it('isReviewId accepts url-tokens up to 64 chars (uuid fits)', () => {
    expect(isReviewId('rev-a1')).toBe(true)
    expect(isReviewId(RID)).toBe(true)
    expect(isReviewId('a'.repeat(64))).toBe(true)
    expect(isReviewId('a'.repeat(65))).toBe(false)
    expect(isReviewId('a.b')).toBe(false)
    expect(isReviewId('a/b')).toBe(false)
    expect(isReviewId('')).toBe(false)
    expect(isReviewId('含中文')).toBe(false)
  })

  it('WORKBENCH_STAGES keeps the six fixed stages in rail order (D7)', () => {
    expect(WORKBENCH_STAGES).toEqual(['understand', 'plan', 'implement', 'review', 'deliver', 'retro'])
  })

  it('WORKBENCH_INLINE_MAX_CHARS is the pinned 32K code-unit cap', () => {
    expect(WORKBENCH_INLINE_MAX_CHARS).toBe(32 * 1024)
  })
})

describe('isWorkbenchRecord', () => {
  it('accepts a full record', () => {
    expect(isWorkbenchRecord(record())).toBe(true)
  })

  it('accepts the minimal empty record and unknown extra keys (forward compatibility)', () => {
    const minimal = record({
      criteria: [],
      findings: [],
      workPackages: [],
      releaseItems: [],
      reviewReports: [],
      knowledgeCandidates: [],
    })
    expect(isWorkbenchRecord(minimal)).toBe(true)
    expect(isWorkbenchRecord({ ...minimal, futureField: true })).toBe(true)
  })

  it('tolerates absent optional fields (approvedAt/note/contentHash/title)', () => {
    expect(isWorkbenchRecord(record({
      workPackages: [workPackage({ plans: [{ version: 2 }] })],
      reviewReports: [reviewReport({ contentHash: undefined, title: undefined })],
    }))).toBe(true)
  })

  it('rejects a bad stage value', () => {
    expect(isWorkbenchRecord(record({ stage: 'bogus' as never }))).toBe(false)
    expect(isWorkbenchRecord(record({ stage: 'closed', stageHistory: [] }))).toBe(true)
  })

  it('rejects enum breaks across every nested vocabulary', () => {
    const breaks: Partial<WorkbenchRecord>[] = [
      { findings: [finding({ category: 'perf' as never })] },
      { findings: [finding({ severity: 'critical' as never })] },
      { findings: [finding({ status: 'closed' as never })] },
      { workPackages: [workPackage({ status: 'done' as never })] },
      { releaseItems: [releaseItem({ type: 'db' as never })] },
      { releaseItems: [releaseItem({ status: 'applied ' as never })] },
      { reviewReports: [reviewReport({ verdicts: [{ title: 't', severity: 'high', verdict: 'maybe' as never }] })] },
      { knowledgeCandidates: [candidate({ type: 'note' as never })] },
    ]
    for (const mutation of breaks) {
      expect(isWorkbenchRecord(record(mutation))).toBe(false)
    }
  })

  it('rejects narrow-regex violations inside nested rows', () => {
    expect(isWorkbenchRecord(record({ workPackages: [workPackage({ id: 'wp1' })] }))).toBe(false)
    expect(isWorkbenchRecord(record({ workPackages: [workPackage({ dependsOn: ['WP0'] })] }))).toBe(false)
    expect(isWorkbenchRecord(record({ workPackages: [workPackage({ plans: [planEntry({ version: 0 })] })] }))).toBe(false)
    expect(isWorkbenchRecord(record({ reviewReports: [reviewReport({ id: 'bad id' })] }))).toBe(false)
    expect(isWorkbenchRecord(record({ releaseItems: [releaseItem({ workPackageId: 'WP01' })] }))).toBe(false)
  })

  it('rejects missing required arrays and empty identity fields', () => {
    const { requirementId: _rid, ...noId } = record()
    expect(isWorkbenchRecord(noId)).toBe(false)
    const { findings: _f, ...noFindings } = record()
    expect(isWorkbenchRecord(noFindings)).toBe(false)
    expect(isWorkbenchRecord(record({ requirementId: '' }))).toBe(false)
    expect(isWorkbenchRecord(record({ findings: [finding({ title: '' })] }))).toBe(false)
    expect(isWorkbenchRecord(record({ stageHistory: [{ stage: 'understand', at: '' }] }))).toBe(false)
  })

  it('coveredBy holds WORK-PACKAGE ids — a C-pattern here poisoned live ledgers (acceptance round 2)', () => {
    expect(isWorkbenchRecord(record({ criteria: [criterion({ coveredBy: ['WP1', 'WP2'] })] }))).toBe(true)
    expect(isWorkbenchRecord(record({ criteria: [criterion({ coveredBy: ['C1'] })] }))).toBe(false)
  })

  it('releaseItems keep contentHash REQUIRED (Flyway checksum mode)', () => {
    const { contentHash: _h, ...noHash } = releaseItem()
    expect(isWorkbenchRecord(record({ releaseItems: [noHash as ReleaseItem] }))).toBe(false)
  })
})

describe('envelope guards', () => {
  it('isWorkbenchListResponse: ok and degraded branches', () => {
    expect(isWorkbenchListResponse({ ok: true, revision: 3, records: [record()] })).toBe(true)
    expect(isWorkbenchListResponse({ ok: true, revision: 3, records: [record({ stage: 'nope' as never })] })).toBe(false)
    expect(isWorkbenchListResponse({ ok: false, degraded: true, reason: 'schema', hasBackup: true })).toBe(true)
    expect(isWorkbenchListResponse({ ok: false, degraded: true, reason: 'weird', hasBackup: false })).toBe(false)
    expect(isWorkbenchListResponse({ ok: false, degraded: true, hasBackup: false })).toBe(false)
  })

  it('isWorkbenchDetailResponse: record null + fileExists rows', () => {
    expect(isWorkbenchDetailResponse({
      ok: true,
      revision: 1,
      record: null,
      planFileExists: [],
      reviewFileExists: [],
    })).toBe(true)
    expect(isWorkbenchDetailResponse({
      ok: true,
      revision: 1,
      record: record(),
      planFileExists: [{ workPackageId: 'WP3', version: 2, exists: false }],
      reviewFileExists: [{ reviewId: 'rev-a1', exists: true }],
    })).toBe(true)
    expect(isWorkbenchDetailResponse({
      ok: true,
      revision: 1,
      record: record(),
      planFileExists: [{ workPackageId: 'WP3', version: 0, exists: true }],
      reviewFileExists: [],
    })).toBe(false)
    expect(isWorkbenchDetailResponse({ ok: true, revision: 1, record: undefined, planFileExists: [], reviewFileExists: [] })).toBe(false)
  })

  it('isArtifactWriteResponseOk: kind-specific optional anchors', () => {
    const plan: ArtifactWriteResponseOk = { ok: true, revision: 5, kind: 'plan', workPackageId: 'WP3', version: 2 }
    const review: ArtifactWriteResponseOk = { ok: true, revision: 5, kind: 'review', reviewId: 'rev-a1' }
    expect(isArtifactWriteResponseOk(plan)).toBe(true)
    expect(isArtifactWriteResponseOk(review)).toBe(true)
    expect(isArtifactWriteResponseOk({ ok: true, revision: 5, kind: 'doc' })).toBe(false)
    expect(isArtifactWriteResponseOk({ ok: true, revision: 5, kind: 'plan', workPackageId: 'wp3', version: 2 })).toBe(false)
  })

  it('isArtifactContentResponse (tamper marker is part of the envelope)', () => {
    expect(isArtifactContentResponse({ ok: true, content: '# plan', contentTampered: false })).toBe(true)
    expect(isArtifactContentResponse({ ok: true, content: '# plan', contentTampered: true })).toBe(true)
    expect(isArtifactContentResponse({ ok: true, content: '# plan' })).toBe(false)
    expect(isArtifactContentResponse({ ok: true, content: 42, contentTampered: false })).toBe(false)
  })

  it('isWorkbenchSaveResponseOk', () => {
    expect(isWorkbenchSaveResponseOk({ ok: true, revision: 2, record: record() })).toBe(true)
    expect(isWorkbenchSaveResponseOk({ ok: true, revision: 2, record: { stage: 'x' } })).toBe(false)
  })

  it('isWorkbenchScanResponse: three reconciliation faces', () => {
    const scan = {
      ok: true as const,
      orphans: [
        { requirementId: RID, kind: 'plan' as const, workPackageId: 'WP1', version: 3 },
        { requirementId: RID, kind: 'unknown' as const, name: 'notes.txt' },
      ],
      missing: [{ requirementId: RID, kind: 'review' as const, reviewId: 'rev-gone' }],
      trash: [{ requirementId: RID, deletedAt: '2026-09-29T10-00-00.000Z' }],
    }
    expect(isWorkbenchScanResponse(scan)).toBe(true)
    expect(isWorkbenchScanResponse({ ...scan, orphans: [{ requirementId: RID, kind: 'plan' }] })).toBe(false)
    expect(isWorkbenchScanResponse({ ...scan, trash: [{ requirementId: RID }] })).toBe(false)
  })

  it('isErrorResponse accepts any string code (codes are endpoint-scoped)', () => {
    expect(isErrorResponse({ ok: false, code: 'locked-version' })).toBe(true)
    expect(isErrorResponse({ ok: false, code: 'conflict', currentRevision: 7 })).toBe(true)
    expect(isErrorResponse({ ok: false, code: 'conflict', currentRevision: '7' })).toBe(false)
    expect(isErrorResponse({ code: 'conflict' })).toBe(false)
  })
})
