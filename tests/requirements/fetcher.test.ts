// @vitest-environment jsdom
/**
 * Endpoint client against a stubbed global fetch: result narrowing, guard
 * rejections, error-body parsing, and transport-failure collapse.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequirementsFetcher } from '../../src/client/requirements/fetcher.js'

const record = (id: string) => ({
  id,
  title: `需求-${id}`,
  description: `说明 ${id}`,
  workspacePath: '',
  linkedRepos: [],
  createdAt: '2026-09-25T09:30:00.000Z',
  updatedAt: '2026-09-25T09:30:00.000Z',
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createRequirementsFetcher', () => {
  it('narrows a healthy list response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, revision: 3, requirements: [record('a'), record('b')] })))
    const result = await createRequirementsFetcher().list()
    expect(result).toEqual({ kind: 'ok', revision: 3, requirements: [record('a'), record('b')] })
  })

  it('narrows the degraded envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false, degraded: true, reason: 'parse', hasBackup: true })))
    const result = await createRequirementsFetcher().list()
    expect(result).toEqual({ kind: 'degraded', reason: 'parse', hasBackup: true })
  })

  it('parses error bodies on non-2xx (conflict carries currentRevision)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false, code: 'conflict', currentRevision: 7 }, 409)))
    const result = await createRequirementsFetcher().save({
      expectedRevision: 3,
      requirement: { title: 'x', description: '' },
    })
    expect(result).toEqual({ kind: 'http-error', status: 409, code: 'conflict', currentRevision: 7 })
  })

  it('collapses transport failures to network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(createRequirementsFetcher().list()).resolves.toEqual({ kind: 'network' })
    await expect(createRequirementsFetcher().save({ expectedRevision: 0, requirement: { title: 'x', description: '' } })).resolves.toEqual({ kind: 'network' })
  })

  it('rejects 2xx bodies that fail the shape guards', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, revision: 'not-a-number', requirements: [] })))
    const result = await createRequirementsFetcher().list()
    expect(result).toEqual({ kind: 'http-error', status: 200 })
  })

  it('surfaces save success with the record and revision', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, revision: 4, requirement: record('new') })))
    const result = await createRequirementsFetcher().save({
      expectedRevision: 3,
      requirement: { title: '需求-new', description: '说明 new' },
    })
    expect(result).toEqual({ kind: 'ok', revision: 4, requirement: record('new') })
  })
})

describe('createRequirementsFetcher: workspace endpoints', () => {
  it('narrows a healthy workspace status response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ok: true, bound: true, path: '/tmp/x', directoryExists: true, registered: true, suggestedPath: '/home/.dsh/skyaxis/workspaces/alpha',
    })))
    const result = await createRequirementsFetcher().workspaceStatus('a')
    expect(result).toEqual({
      kind: 'ok', bound: true, path: '/tmp/x', directoryExists: true, registered: true, suggestedPath: '/home/.dsh/skyaxis/workspaces/alpha',
    })
  })

  it('posts the set body to the workspace route and narrows the record envelope', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, revision: 5, requirement: record('a') }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await createRequirementsFetcher().setWorkspace({ expectedRevision: 4, id: 'a', action: 'set', path: '/tmp/x' })
    expect(result).toEqual({ kind: 'ok', revision: 5, requirement: record('a') })
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe('/api/skyaxis/requirements/workspace')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ expectedRevision: 4, id: 'a', action: 'set', path: '/tmp/x' })
  })

  it('collapses 2xx status bodies missing the fields to http-error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, bound: 'yes' })))
    const result = await createRequirementsFetcher().workspaceStatus('a')
    expect(result).toEqual({ kind: 'http-error', status: 200 })
  })
})


describe('createRequirementsFetcher: rebind', () => {
  it('posts the bare rebind body and narrows the status envelope', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      ok: true, bound: true, path: '/tmp/x', directoryExists: true, registered: true, suggestedPath: '/s',
    }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await createRequirementsFetcher().rebindWorkspace('a')
    expect(result).toEqual({
      kind: 'ok', bound: true, path: '/tmp/x', directoryExists: true, registered: true, suggestedPath: '/s',
    })
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe('/api/skyaxis/requirements/workspace')
    expect(JSON.parse(init.body as string)).toEqual({ id: 'a', action: 'rebind' })
  })
})

describe('createRequirementsFetcher: repos scan', () => {
  it('narrows a healthy scan response with the id+scan query', async () => {
    const fetchMock = vi.fn(async (_url: unknown) => jsonResponse({ ok: true, dirs: [
      { name: 'repo-a', isGitRepo: true, branch: 'main', remoteUrl: 'git@example.com:org/a.git' },
      { name: 'plain', isGitRepo: false },
    ] }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await createRequirementsFetcher().repoScan('11111111-1111-4111-8111-111111111111')
    expect(result).toEqual({ kind: 'ok', dirs: [
      { name: 'repo-a', isGitRepo: true, branch: 'main', remoteUrl: 'git@example.com:org/a.git' },
      { name: 'plain', isGitRepo: false },
    ] })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/skyaxis/requirements/repos?id=11111111-1111-4111-8111-111111111111&scan=1')
  })

  it('rejects 2xx bodies failing the scan guard and parses error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, dirs: [{ name: 'x', isGitRepo: 'yes' }] })))
    const bad = await createRequirementsFetcher().repoScan('a')
    expect(bad).toEqual({ kind: 'http-error', status: 200 })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false, code: 'no-workspace' }, 400)))
    const rejected = await createRequirementsFetcher().repoScan('a')
    expect(rejected).toEqual({ kind: 'http-error', status: 400, code: 'no-workspace' })
  })
})

describe('createRequirementsFetcher: prd documents', () => {  it('lists docs with the id query', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, docs: [{ name: 'a.md', size: 3, modifiedAt: 1 }] }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await createRequirementsFetcher().prdDocs('x')
    expect(result).toEqual({ kind: 'ok', docs: [{ name: 'a.md', size: 3, modifiedAt: 1 }] })
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/skyaxis/requirements/prds?id=x')
  })

  it('reads content as text on ok and parses error bodies otherwise', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# hello', { status: 200, headers: { 'content-type': 'text/plain' } })))
    await expect(createRequirementsFetcher().prdDocContent('x', 'a.md')).resolves.toEqual({ kind: 'ok', text: '# hello' })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false, code: 'too-large' }, 413)))
    await expect(createRequirementsFetcher().prdDocContent('x', 'a.md')).resolves.toEqual({ kind: 'http-error', status: 413, code: 'too-large' })
  })

  it('uploads with an octet-stream body carrying the File reference', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, docs: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['bytes'], '需求 文档.pdf')
    const result = await createRequirementsFetcher().uploadPrdDoc('x', file.name, file)
    expect(result).toEqual({ kind: 'ok', docs: [] })
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe(`/api/skyaxis/requirements/prd-upload?id=x&name=${encodeURIComponent('需求 文档.pdf')}`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/octet-stream')
    expect(init.body).toBe(file)
  })

  it('parses duplicate-name rejections and collapses transport failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false, code: 'duplicate-name' }, 409)))
    await expect(createRequirementsFetcher().uploadPrdDoc('x', 'a.md', new File(['b'], 'a.md'))).resolves.toEqual({
      kind: 'http-error', status: 409, code: 'duplicate-name',
    })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(createRequirementsFetcher().prdDocs('x')).resolves.toEqual({ kind: 'network' })
  })
})
