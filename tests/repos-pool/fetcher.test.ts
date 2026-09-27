// @vitest-environment jsdom
/**
 * Endpoint client against a stubbed global fetch: result narrowing, guard
 * rejections, error-body parsing, and transport-failure collapse.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReposFetcher } from '../../src/client/repos-pool/fetcher.js'

const record = (id: string) => ({
  id,
  name: `repo-${id}`,
  urlHttp: `https://example.com/${id}.git`,
  description: '',
  statusHttp: 'verified' as const,
  validatedAtHttp: '2026-09-24T09:30:00.000Z',
  lastErrorHttp: null,
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createReposFetcher', () => {
  it('narrows a healthy list response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, revision: 3, repos: [record('a'), record('b')] })))
    const result = await createReposFetcher().list()
    expect(result).toEqual({ kind: 'ok', revision: 3, repos: [record('a'), record('b')] })
  })

  it('narrows the degraded envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false, degraded: true, reason: 'parse', hasBackup: true })))
    const result = await createReposFetcher().list()
    expect(result).toEqual({ kind: 'degraded', reason: 'parse', hasBackup: true })
  })

  it('parses error bodies on non-2xx (conflict carries currentRevision)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false, code: 'conflict', currentRevision: 7 }, 409)))
    const result = await createReposFetcher().save({
      expectedRevision: 3,
      repo: { name: 'x', urlHttp: 'https://example.com/x.git', description: '' },
      validation: { http: { kind: 'verified' } },
    })
    expect(result).toEqual({ kind: 'http-error', status: 409, code: 'conflict', currentRevision: 7 })
  })

  it('collapses transport failures to network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(createReposFetcher().list()).resolves.toEqual({ kind: 'network' })
    await expect(createReposFetcher().validate('https://example.com/x.git')).resolves.toEqual({ kind: 'network' })
  })

  it('rejects 2xx bodies that fail the shape guards', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, revision: 'not-a-number', repos: [] })))
    const result = await createReposFetcher().list()
    expect(result).toEqual({ kind: 'http-error', status: 200 })
  })

  it('passes validate outcomes through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ok: true,
      syntax: { acceptable: true, kind: 'https' },
      reachability: { classification: 'auth', detail: 'could not read Username' },
    })))
    const result = await createReposFetcher().validate('https://github.com/org/private.git')
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.outcome.reachability?.classification).toBe('auth')
      expect(result.outcome.reachability?.detail).toBe('could not read Username')
    }
  })

  it('surfaces save success with the record and revision', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, revision: 4, repo: record('new') })))
    const result = await createReposFetcher().save({
      expectedRevision: 3,
      repo: { name: 'repo-new', urlHttp: 'https://example.com/new.git', description: '' },
      validation: { http: { kind: 'verified' } },
    })
    expect(result).toEqual({ kind: 'ok', revision: 4, repo: record('new') })
  })
})
