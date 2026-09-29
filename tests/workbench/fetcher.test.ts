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
      reviewFileExists: [],
    })))
    const empty = await createWorkbenchFetcher().detail(RID)
    expect(empty).toEqual({ kind: 'ok', revision: 1, record: null, planFileExists: [], reviewFileExists: [] })

    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      ok: true,
      revision: 1,
      record: okRecord(),
      planFileExists: [{ workPackageId: 'WP1', version: 1, exists: false }],
      reviewFileExists: [],
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
})
