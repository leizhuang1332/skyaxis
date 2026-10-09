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
  WorkbenchKnowledgeRecord,
  WorkbenchWorkPackage,
  WorkbenchRecord,
} from '../../src/workbench-shared/protocol.js'
import {
  KNOWLEDGE_INJECTION_MAX_BYTES,
  KNOWLEDGE_INJECTION_MAX_ENTRIES,
  WORKBENCH_INLINE_MAX_CHARS,
  WORKBENCH_STAGES,
  isArtifactContentResponse,
  isArtifactWriteResponseOk,
  isErrorResponse,
  isWorkPackageId,
  isPlanVersion,
  isReleaseItemId,
  isReviewId,
  isWorkbenchDetailResponse,
  isWorkbenchKnowledgeListResponse,
  isWorkbenchKnowledgeRecord,
  isWorkbenchKnowledgeSaveResponseOk,
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

  it('review verdicts carry an optional host-minted id anchor (P4)', () => {
    const withId = reviewReport({ verdicts: [{ id: '44444444-4444-4444-8444-444444444444', title: '空指针', severity: 'high', verdict: 'confirmed' }] })
    expect(isWorkbenchRecord(record({ reviewReports: [withId] }))).toBe(true)
    // Pre-P4 rows (no id) stay legal — the field-evolution discipline.
    const legacy = reviewReport({ verdicts: [{ title: '空指针', severity: 'high', verdict: 'confirmed' }] })
    expect(isWorkbenchRecord(record({ reviewReports: [legacy] }))).toBe(true)
    const badId = reviewReport({ verdicts: [{ id: 42 as never, title: 'x', severity: 'low', verdict: 'rejected', note: 'r' }] })
    expect(isWorkbenchRecord(record({ reviewReports: [badId] }))).toBe(false)
  })

  it('P5b: read-side guard accepts the host-minted proposed verdict (three-valued on read, two on write)', () => {
    const proposed = reviewReport({ verdicts: [{ id: '44444444-4444-4444-8444-444444444444', title: 'AI 报的', severity: 'high', verdict: 'proposed' }] })
    expect(isWorkbenchRecord(record({ reviewReports: [proposed] }))).toBe(true)
    // An unknown verdict value is still rejected — the enum is closed, just wider.
    const bogus = reviewReport({ verdicts: [{ title: 'x', severity: 'low', verdict: 'maybe' as never }] })
    expect(isWorkbenchRecord(record({ reviewReports: [bogus] }))).toBe(false)
  })

  it('P5b: splitBaseline is optional and shape-guarded (present ⇒ at/prd/disposedFindings all valid)', () => {
    expect(isWorkbenchRecord(record({ splitBaseline: { at: '2026-10-09T00:00:00.000Z', prd: [{ name: 'prd.md', size: 10, modifiedAt: 1 }], disposedFindings: 2 } }))).toBe(true)
    // Absent stays legal (pre-P5b approvals carry none).
    expect(isWorkbenchRecord(record())).toBe(true)
    // Malformed rows collapse to a guard failure, not a half-join.
    expect(isWorkbenchRecord(record({ splitBaseline: { at: '', prd: [], disposedFindings: 0 } }))).toBe(false)
    expect(isWorkbenchRecord(record({ splitBaseline: { at: '2026-10-09T00:00:00.000Z', prd: [{ name: 'p', size: 'x' as never, modifiedAt: 1 }], disposedFindings: 0 } }))).toBe(false)
  })

  it('isReleaseItemId: R#### only — an unpadded R1 is the ledger-poisoning shape (P3a)', () => {
    expect(isReleaseItemId('R0001')).toBe(true)
    expect(isReleaseItemId('R12345')).toBe(true) // 五位也合法（>9999 之后自然增长）
    expect(isReleaseItemId('R1')).toBe(false)
    expect(isReleaseItemId('R001')).toBe(false)
    expect(isReleaseItemId('r0001')).toBe(false)
    expect(isReleaseItemId('WP0001')).toBe(false)
    // guard 层联动：无补零 id 的整条记录被拒
    expect(isWorkbenchRecord(record({ releaseItems: [releaseItem({ id: 'R1' })] }))).toBe(false)
    // 新 optional 字段的 guard 放宽（note / rollbackPlanConfirmedAt）
    expect(isWorkbenchRecord(record({ releaseItems: [releaseItem({ note: '随 v1.2 上线' })] }))).toBe(true)
    expect(isWorkbenchRecord(record({ rollbackPlanConfirmedAt: '2026-10-08T00:00:00.000Z' }))).toBe(true)
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

  it('isWorkbenchDetailResponse: record null + fileExists rows + releaseDrifted required (P3a)', () => {
    expect(isWorkbenchDetailResponse({
      ok: true,
      revision: 1,
      record: null,
      planFileExists: [],
      reviewFileExists: [],
      releaseDrifted: [],
    })).toBe(true)
    expect(isWorkbenchDetailResponse({
      ok: true,
      revision: 1,
      record: record(),
      planFileExists: [{ workPackageId: 'WP3', version: 2, exists: false }],
      reviewFileExists: [{ reviewId: 'rev-a1', exists: true }],
      releaseDrifted: ['R0001', 'R0002'],
    })).toBe(true)
    expect(isWorkbenchDetailResponse({
      ok: true,
      revision: 1,
      record: record(),
      planFileExists: [{ workPackageId: 'WP3', version: 0, exists: true }],
      reviewFileExists: [],
      releaseDrifted: [],
    })).toBe(false)
    expect(isWorkbenchDetailResponse({ ok: true, revision: 1, record: undefined, planFileExists: [], reviewFileExists: [], releaseDrifted: [] })).toBe(false)
    // releaseDrifted 缺席 = 拒形（响应面字段与 fileExists 同为 required 形态）
    expect(isWorkbenchDetailResponse({ ok: true, revision: 1, record: null, planFileExists: [], reviewFileExists: [] })).toBe(false)
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

// ---------------------------------------------------------------------------
// P2 knowledge guards + 注入常量（scope 耦合按 repos-pool addressSlotOk 先例）
// ---------------------------------------------------------------------------

describe('knowledge guards + injection constants (P2)', () => {
  function kbRow(overrides: Partial<WorkbenchKnowledgeRecord> = {}): WorkbenchKnowledgeRecord {
    return {
      id: '33333333-3333-4333-8333-333333333333',
      scope: 'global',
      type: 'business',
      title: '异步导出约定',
      content: '大表禁止全量拉取',
      trigger: { mode: 'always' },
      status: 'active',
      provenance: { at: AT },
      ...overrides,
    }
  }

  it('isWorkbenchKnowledgeRecord：三 scope 正例（workspace 带 path / requirement 带 requirementId）', () => {
    expect(isWorkbenchKnowledgeRecord(kbRow())).toBe(true)
    expect(isWorkbenchKnowledgeRecord(kbRow({ scope: 'workspace', path: 'C:/repos/main' }))).toBe(true)
    expect(isWorkbenchKnowledgeRecord(kbRow({ scope: 'requirement', requirementId: RID }))).toBe(true)
  })

  it('scope 耦合反例：workspace 无 path / requirement 无 requirementId ⇒ 拒', () => {
    expect(isWorkbenchKnowledgeRecord(kbRow({ scope: 'workspace' }))).toBe(false)
    expect(isWorkbenchKnowledgeRecord(kbRow({ scope: 'requirement' }))).toBe(false)
  })

  it('trigger 坏 mode 拒；status 坏值拒；provenance 缺 at 拒', () => {
    expect(isWorkbenchKnowledgeRecord(kbRow({ trigger: { mode: 'cron' as never } }))).toBe(false)
    expect(isWorkbenchKnowledgeRecord(kbRow({ trigger: { mode: 'keyword' } }))).toBe(true) // value 可缺席（mode 决定消费）
    expect(isWorkbenchKnowledgeRecord(kbRow({ status: 'draft' as never }))).toBe(false)
    expect(isWorkbenchKnowledgeRecord({ ...kbRow(), provenance: { sessionId: 'sess-1' } })).toBe(false)
  })

  it('isWorkbenchKnowledgeListResponse：ok / degraded 双臂', () => {
    expect(isWorkbenchKnowledgeListResponse({ ok: true, revision: 3, records: [kbRow()] })).toBe(true)
    expect(isWorkbenchKnowledgeListResponse({ ok: true, revision: 3, records: [kbRow({ status: 'bogus' as never })] })).toBe(false)
    expect(isWorkbenchKnowledgeListResponse({ ok: false, degraded: true, reason: 'schema', hasBackup: true })).toBe(true)
    expect(isWorkbenchKnowledgeListResponse({ ok: false, degraded: true, reason: 'weird', hasBackup: false })).toBe(false)
    expect(isWorkbenchKnowledgeListResponse({ ok: false, degraded: true, hasBackup: false })).toBe(false)
  })

  it('isWorkbenchKnowledgeSaveResponseOk', () => {
    expect(isWorkbenchKnowledgeSaveResponseOk({ ok: true, revision: 2, record: kbRow() })).toBe(true)
    expect(isWorkbenchKnowledgeSaveResponseOk({ ok: true, revision: 2, record: kbRow({ scope: 'workspace' }) })).toBe(false)
    expect(isWorkbenchKnowledgeSaveResponseOk({ ok: true, revision: 2 })).toBe(false)
  })

  it('注入常量钉值（SOW：8 条 / 8192 字节）', () => {
    expect(KNOWLEDGE_INJECTION_MAX_ENTRIES).toBe(8)
    expect(KNOWLEDGE_INJECTION_MAX_BYTES).toBe(8192)
  })
})
