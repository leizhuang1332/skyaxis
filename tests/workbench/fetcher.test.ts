/**
 * Workbench fetcher: guard narrowing, the three-way error split, and the
 * artifact content envelope (tamper marker passes through). Same shape as
 * the requirements fetcher tests (stubbed global fetch).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import { createWorkbenchFetcher } from '../../src/client/workbench/fetcher.js'

const RID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-09-29T08:00:00.000Z'

const RECORD: WorkbenchRecord = {
  requirementId: RID,
  stage: 'understand',
  stageHistory: [{ stage: 'understand', at: AT }],
  criteria: [],
  findings: [],
  workPackages: [],
  releaseItems: [],
  reviewReports: [],
  knowledgeCandidates: [],
}

function okRecord(): WorkbenchRecord {
  return { ...RECORD }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('workbench fetcher', () => {
  it('list narrows a healthy envelope and a degraded envelope', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true, revision: 2, records: [okRecord()] })))
    const ok = await createWorkbenchFetcher().list()
    expect(ok).toEqual({ kind: 'ok', revision: 2, records: [RECORD] })

    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: false, degraded: true, reason: 'schema', hasBackup: true })))
    const degraded = await createWorkbenchFetcher().list()
    expect(degraded).toEqual({ kind: 'degraded', reason: 'schema', hasBackup: true })
  })

  it('detail narrows record null and the fileExists rows', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      ok: true,
      revision: 1,
      record: null,
      planFileExists: [],
      reviewFileExists: [], releaseDrifted: [],
    })))
    const empty = await createWorkbenchFetcher().detail(RID)
    expect(empty).toEqual({ kind: 'ok', revision: 1, record: null, planFileExists: [], reviewFileExists: [], releaseDrifted: [] })

    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      ok: true,
      revision: 1,
      record: okRecord(),
      planFileExists: [{ workPackageId: 'WP1', version: 1, exists: false }],
      reviewFileExists: [], releaseDrifted: [],
    })))
    const filled = await createWorkbenchFetcher().detail(RID)
    expect(filled.kind).toBe('ok')
    if (filled.kind !== 'ok') return
    expect(filled.planFileExists).toEqual([{ workPackageId: 'WP1', version: 1, exists: false }])
  })

  it('mutate parses conflict + currentRevision out of a 409 error body', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: false, code: 'conflict', currentRevision: 7 }), { status: 409 }))
    const result = await createWorkbenchFetcher().advanceStage(RID, 3, 'plan')
    expect(result).toEqual({ kind: 'http-error', status: 409, code: 'conflict', currentRevision: 7 })
  })

  it('transport failures collapse to network; guard failures collapse to http-error', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('offline') })
    expect(await createWorkbenchFetcher().list()).toEqual({ kind: 'network' })

    // 2xx with a body the guards reject = http-error (status preserved, no code).
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true, revision: 'x' })))
    const result = await createWorkbenchFetcher().list()
    expect(result).toEqual({ kind: 'http-error', status: 200 })
  })

  it('planContent returns the tamper marker verbatim', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true, content: '# plan', contentTampered: true })))
    const result = await createWorkbenchFetcher().planContent(RID, 'WP1', 2)
    expect(result).toEqual({ kind: 'ok', content: '# plan', contentTampered: true })
  })

  it('writePlan posts a text/plain body with query discrimination', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ ok: true, revision: 4, kind: 'plan', workPackageId: 'WP1', version: 2 }))
    })
    const result = await createWorkbenchFetcher().writePlan(RID, 'WP1', '# plan body', 3, 'second try')
    expect(result).toEqual({ kind: 'ok', revision: 4, anchor: { ok: true, revision: 4, kind: 'plan', workPackageId: 'WP1', version: 2 } })
    expect(calls[0].url).toBe(`/api/skyaxis/workbench/artifacts?kind=plan&requirementId=${RID}&workPackageId=WP1&expectedRevision=3&note=second+try`)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers).toEqual({ 'content-type': 'text/plain' })
    expect(calls[0].init.body).toBe('# plan body')
  })

  it('saveFinding posts the action union body', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ ok: true, revision: 2, record: okRecord() }))
    })
    const result = await createWorkbenchFetcher().saveFinding(RID, 1, { category: 'risk', severity: 'high', title: '慢查询', detail: '…', status: 'open' })
    expect(result.kind).toBe('ok')
    expect(calls[0].url).toBe('/api/skyaxis/workbench')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      expectedRevision: 1,
      requirementId: RID,
      action: 'saveFinding',
      finding: { category: 'risk', severity: 'high', title: '慢查询', detail: '…', status: 'open' },
    })
  })

  it('removeFinding posts the remove action; writeReview and reviewContent use the review query shape', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (String(url).includes('artifacts')) {
        if (init.method === 'GET') {
          return new Response(JSON.stringify({ ok: true, content: '# report', contentTampered: false }))
        }
        return new Response(JSON.stringify({ ok: true, revision: 5, kind: 'review', reviewId: 'rev-a1' }))
      }
      return new Response(JSON.stringify({ ok: true, revision: 5, record: okRecord() }))
    })
    const fetcher = createWorkbenchFetcher()
    expect((await fetcher.removeFinding(RID, 2, '22222222-2222-4222-8222-222222222222')).kind).toBe('ok')
    expect((await fetcher.writeReview(RID, '# report', 2, '评审报告', undefined)).kind).toBe('ok')
    expect((await fetcher.reviewContent(RID, 'rev-a1')).kind).toBe('ok')

    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      expectedRevision: 2,
      requirementId: RID,
      action: 'removeFinding',
      id: '22222222-2222-4222-8222-222222222222',
    })
    expect(calls[1].url).toBe(`/api/skyaxis/workbench/artifacts?kind=review&requirementId=${RID}&expectedRevision=2&title=${encodeURIComponent('评审报告')}`)
    expect(calls[1].init.body).toBe('# report')
    expect(calls[2].url).toBe(`/api/skyaxis/workbench/artifacts?kind=review&requirementId=${RID}&reviewId=rev-a1`)
  })

  it('文件交付轮 methods: answer/dismissAnalysisClarification post the discriminated bodies; analysisReportContent hits the analysis-report query face', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (String(url).includes('artifacts')) {
        return new Response(JSON.stringify({ ok: true, content: '# 报告', contentTampered: false }))
      }
      return new Response(JSON.stringify({ ok: true, revision: 6, record: okRecord() }))
    })
    const fetcher = createWorkbenchFetcher()
    expect((await fetcher.answerAnalysisClarification(RID, 5, '99999999-9999-4999-8999-999999999999', '按百万行')).kind).toBe('ok')
    expect((await fetcher.dismissAnalysisClarification(RID, 5, '99999999-9999-4999-8999-999999999999')).kind).toBe('ok')
    expect((await fetcher.analysisReportContent(RID)).kind).toBe('ok')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      expectedRevision: 5,
      requirementId: RID,
      action: 'answerAnalysisClarification',
      id: '99999999-9999-4999-8999-999999999999',
      answer: '按百万行',
    })
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      expectedRevision: 5,
      requirementId: RID,
      action: 'dismissAnalysisClarification',
      id: '99999999-9999-4999-8999-999999999999',
    })
    expect(calls[2].url).toBe(`/api/skyaxis/workbench/artifacts?kind=analysis-report&requirementId=${RID}`)
    expect(calls[2].init.method).toBe('GET')
  })

  it('second-knife action methods post their discriminated bodies (split gates + lifecycle)', async () => {
    const calls: unknown[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ ok: true, revision: 9, record: okRecord() }))
    })
    const fetcher = createWorkbenchFetcher()
    expect((await fetcher.approveSplit(RID, 4)).kind).toBe('ok')
    expect((await fetcher.approvePlan(RID, 4, 'WP1')).kind).toBe('ok')
    expect((await fetcher.moveWorkPackage(RID, 4, 'WP2', 'up')).kind).toBe('ok')
    expect((await fetcher.acceptWorkPackage(RID, 4, 'WP3', 'fail', '缺回滚')).kind).toBe('ok')
    expect((await fetcher.saveWorkPackage(RID, 4, { title: 'T', boundary: '', dependsOn: [], covers: [] })).kind).toBe('ok')
    expect((await fetcher.saveCriterion(RID, 4, { text: 'C' })).kind).toBe('ok')

    expect(calls[0]).toEqual({ expectedRevision: 4, requirementId: RID, action: 'approveSplit' })
    expect(calls[1]).toEqual({ expectedRevision: 4, requirementId: RID, action: 'approvePlan', id: 'WP1' })
    expect(calls[2]).toEqual({ expectedRevision: 4, requirementId: RID, action: 'moveWorkPackage', id: 'WP2', direction: 'up' })
    expect(calls[3]).toEqual({ expectedRevision: 4, requirementId: RID, action: 'acceptWorkPackage', id: 'WP3', result: 'fail', note: '缺回滚' })
    expect(calls[4]).toEqual({ expectedRevision: 4, requirementId: RID, action: 'saveWorkPackage', workPackage: { title: 'T', boundary: '', dependsOn: [], covers: [] } })
    expect(calls[5]).toEqual({ expectedRevision: 4, requirementId: RID, action: 'saveCriterion', criterion: { text: 'C' } })
  })

  it('locked-split and locked-version error codes parse into the failure shape', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: false, code: 'locked-split' }), { status: 400 }))
    const result = await createWorkbenchFetcher().approvePlan(RID, 1, 'WP1')
    expect(result).toEqual({ kind: 'http-error', status: 400, code: 'locked-split' })
  })

  it('P3a release methods post their discriminated bodies (no contentHash on the wire — host mints it)', async () => {
    const calls: unknown[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ ok: true, revision: 9, record: okRecord() }))
    })
    const fetcher = createWorkbenchFetcher()
    expect((await fetcher.saveReleaseItem(RID, 4, { type: 'sql', title: '加索引', content: 'ALTER', envs: ['prod'] })).kind).toBe('ok')
    expect((await fetcher.saveReleaseItem(RID, 4, { id: 'R0001', type: 'sql', title: '改', content: 'ALTER2', envs: [], workPackageId: 'WP1', note: 'n' })).kind).toBe('ok')
    expect((await fetcher.removeReleaseItem(RID, 4, 'R0001')).kind).toBe('ok')
    expect((await fetcher.confirmReleaseItem(RID, 4, 'R0001')).kind).toBe('ok')
    expect((await fetcher.markReleaseItemApplied(RID, 4, 'R0001')).kind).toBe('ok')
    expect((await fetcher.markReleaseItemVerified(RID, 4, 'R0001')).kind).toBe('ok')
    expect((await fetcher.rollbackReleaseItem(RID, 4, 'R0001')).kind).toBe('ok')
    expect((await fetcher.confirmRollbackPlan(RID, 4)).kind).toBe('ok')
    expect((await fetcher.revokeRollbackPlan(RID, 4)).kind).toBe('ok')

    expect(calls[0]).toEqual({ expectedRevision: 4, requirementId: RID, action: 'saveReleaseItem', releaseItem: { type: 'sql', title: '加索引', content: 'ALTER', envs: ['prod'] } })
    expect(calls[1]).toEqual({ expectedRevision: 4, requirementId: RID, action: 'saveReleaseItem', releaseItem: { id: 'R0001', type: 'sql', title: '改', content: 'ALTER2', envs: [], workPackageId: 'WP1', note: 'n' } })
    expect(calls[2]).toEqual({ expectedRevision: 4, requirementId: RID, action: 'removeReleaseItem', id: 'R0001' })
    expect(calls[3]).toEqual({ expectedRevision: 4, requirementId: RID, action: 'confirmReleaseItem', id: 'R0001' })
    expect(calls[4]).toEqual({ expectedRevision: 4, requirementId: RID, action: 'markReleaseItemApplied', id: 'R0001' })
    expect(calls[5]).toEqual({ expectedRevision: 4, requirementId: RID, action: 'markReleaseItemVerified', id: 'R0001' })
    expect(calls[6]).toEqual({ expectedRevision: 4, requirementId: RID, action: 'rollbackReleaseItem', id: 'R0001' })
    expect(calls[7]).toEqual({ expectedRevision: 4, requirementId: RID, action: 'confirmRollbackPlan' })
    expect(calls[8]).toEqual({ expectedRevision: 4, requirementId: RID, action: 'revokeRollbackPlan' })
  })
})

describe('挂账轮 scan（孤儿对账三面）', () => {
  it('narrows the three faces; a 409 unreadable ledger degrades to http-error', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      ok: true,
      orphans: [
        { requirementId: RID, kind: 'plan', workPackageId: 'WP1', version: 2 },
        { requirementId: RID, kind: 'unknown', name: 'stray.txt' },
      ],
      missing: [{ requirementId: RID, kind: 'review', reviewId: '48b3597e-58b8-40e5-a62b-4a052a41b917' }],
      trash: [{ requirementId: RID, deletedAt: AT }],
    })))
    const ok = await createWorkbenchFetcher().scan()
    expect(ok.kind).toBe('ok')
    if (ok.kind !== 'ok') return
    expect(ok.response.orphans).toHaveLength(2)
    expect(ok.response.missing[0]?.reviewId).toBe('48b3597e-58b8-40e5-a62b-4a052a41b917')
    expect(ok.response.trash[0]?.deletedAt).toBe(AT)

    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: false, code: 'unreadable-file' }), { status: 409 }))
    const refused = await createWorkbenchFetcher().scan()
    expect(refused).toEqual({ kind: 'http-error', status: 409, code: 'unreadable-file' })
  })
})

describe('P5a knowledgeList workspacePath 参数', () => {
  it('带参数上送；空串/undefined 省略参数（旧行为）', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ ok: true, revision: 1, records: [] }))
    })
    const fetcher = createWorkbenchFetcher()
    expect((await fetcher.knowledgeList(RID, 'C:/ws/quote')).kind).toBe('ok')
    expect((await fetcher.knowledgeList(RID, '')).kind).toBe('ok')
    expect((await fetcher.knowledgeList(RID)).kind).toBe('ok')
    expect(calls[0]).toContain('workspacePath=C%3A%2Fws%2Fquote')
    expect(calls[1]).not.toContain('workspacePath')
    expect(calls[2]).not.toContain('workspacePath')
  })
})
