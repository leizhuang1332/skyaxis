/**
 * PRD endpoints against the real HostConnectionService: listing / markdown
 * read / create / delete / streaming upload. The streaming request bodies
 * are hand-built Web ReadableStreams (duplex:'half') — the harness calls the
 * shared handler directly, so the node→web bridge conversion is bypassed and
 * any non-empty body arrives as a ReadableStream either way.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { afterEach, describe, expect, it } from 'vitest'
import type { ErrorResponse } from '../../src/requirements-shared/protocol.js'
import {
  REQUIREMENTS_PRDS_PATH,
  REQUIREMENTS_PRD_UPLOAD_PATH,
  REQUIREMENTS_SAVE_PATH,
  REQUIREMENTS_WORKSPACE_PATH,
} from '../../src/requirements-shared/protocol.js'
import { registerRequirementsEndpoints } from '../../src/requirements-host/endpoint.js'
import { registerRequirementsPrdEndpoints } from '../../src/requirements-host/prd-endpoint.js'
import { RequirementsFileStore } from '../../src/requirements-host/requirements-file.js'
import { RequirementWorkspaceBinder } from '../../src/requirements-host/workspace.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'prd-endpoint-test-'))
  dirs.push(dir)
  const file = new RequirementsFileStore(join(dir, 'requirements.yaml'))
  const workspaces = new RequirementWorkspaceBinder()
  const ctx = new Context()
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], {} as never)
  })
  await fiber.await()
  const connection = ctx.get('connection') as HostConnectionHandle
  registerRequirementsEndpoints(connection, { file, workspaces })
  registerRequirementsPrdEndpoints(connection, { file })
  const shared = connection.createSharedFetchHandler('/api')
  const base = 'http://127.0.0.1'
  const get = (path: string) => shared.fetch(new Request(base + path))
  const post = (path: string, body: unknown) =>
    shared.fetch(new Request(base + path, { method: 'POST', body: JSON.stringify(body) }))
  const postStream = (path: string, chunks: readonly Uint8Array[], headers: Record<string, string> = {}) =>
    shared.fetch(new Request(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', ...headers },
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk)
          controller.close()
        },
      }),
      duplex: 'half',
      // duplex rides the undici RequestInit; the DOM lib type omits it.
    } as RequestInit))
  return { file, dir, get, post, postStream, dispose: () => fiber.dispose() }
}

/** Bound requirement factory; returns its id. */
async function bound(h: Awaited<ReturnType<typeof harness>>, wsName = 'ws'): Promise<string> {
  const created = await (await h.post(REQUIREMENTS_SAVE_PATH, {
    expectedRevision: 0,
    requirement: { title: 'alpha', description: '' },
  })).json() as { requirement: { id: string } }
  await h.post(REQUIREMENTS_WORKSPACE_PATH, {
    expectedRevision: 1,
    id: created.requirement.id,
    action: 'set',
    path: join(h.dir, wsName),
  })
  return created.requirement.id
}

const encoder = new TextEncoder()

describe('requirements endpoints: prd documents', () => {
  it('lists an absent prds directory as an empty listing, rejects unbound and ghost ids', async () => {
    const h = await harness()
    const id = await bound(h)
    const listed = await h.get(`${REQUIREMENTS_PRDS_PATH}?id=${id}`)
    expect(listed.status).toBe(200)
    expect(((await listed.json()) as { ok: true; docs: unknown[] }).docs).toEqual([])

    const unbound = await (await h.post(REQUIREMENTS_SAVE_PATH, {
      expectedRevision: 2,
      requirement: { title: 'beta', description: '' },
    })).json() as { requirement: { id: string } }
    const noWs = await h.get(`${REQUIREMENTS_PRDS_PATH}?id=${unbound.requirement.id}`)
    expect(noWs.status).toBe(400)
    expect(((await noWs.json()) as ErrorResponse).code).toBe('no-workspace')

    const ghost = await h.get(`${REQUIREMENTS_PRDS_PATH}?id=00000000-0000-4000-8000-000000000000`)
    expect(ghost.status).toBe(404)
    const noId = await h.get(REQUIREMENTS_PRDS_PATH)
    expect(noId.status).toBe(400)
    await h.dispose()
  })

  it('creates markdown with exact bytes, auto-creates prds/, answers with the fresh listing', async () => {
    const h = await harness()
    const id = await bound(h)
    const res = await h.post(REQUIREMENTS_PRDS_PATH, {
      id, action: 'create', name: '需求 方案.md', content: '# 标题\n\n正文内容',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; docs: Array<{ name: string; size: number }> }
    expect(body.docs).toHaveLength(1)
    expect(body.docs[0]?.name).toBe('需求 方案.md')
    expect(readFileSync(join(h.dir, 'ws', 'prds', '需求 方案.md'), 'utf8')).toBe('# 标题\n\n正文内容')
    await h.dispose()
  })

  it('create rejects duplicates and traversal names', async () => {
    const h = await harness()
    const id = await bound(h)
    await h.post(REQUIREMENTS_PRDS_PATH, { id, action: 'create', name: 'a.md', content: 'x' })
    const dup = await h.post(REQUIREMENTS_PRDS_PATH, { id, action: 'create', name: 'a.md', content: 'y' })
    expect(dup.status).toBe(409)
    expect(((await dup.json()) as ErrorResponse).code).toBe('duplicate-name')

    const evil = await h.post(REQUIREMENTS_PRDS_PATH, { id, action: 'create', name: '../evil.md', content: 'x' })
    expect(evil.status).toBe(400)
    expect(statSync(join(h.dir, 'evil.md'), { throwIfNoEntry: false })).toBeUndefined()
    await h.dispose()
  })

  it('reads markdown content as text/plain and rejects non-md, missing, traversal, oversized', async () => {
    const h = await harness()
    const id = await bound(h)
    await h.post(REQUIREMENTS_PRDS_PATH, { id, action: 'create', name: 'doc.md', content: '# 你好' })

    const good = await h.get(`${REQUIREMENTS_PRDS_PATH}?id=${id}&name=${encodeURIComponent('doc.md')}`)
    expect(good.status).toBe(200)
    expect(good.headers.get('content-type')).toContain('text/plain')
    expect(await good.text()).toBe('# 你好')

    // Non-md present on disk (written out-of-band): read refuses.
    writeFileSync(join(h.dir, 'ws', 'prds', 'big.bin'), Buffer.alloc(4))
    const nonMd = await h.get(`${REQUIREMENTS_PRDS_PATH}?id=${id}&name=${encodeURIComponent('big.bin')}`)
    expect(nonMd.status).toBe(400)

    const missing = await h.get(`${REQUIREMENTS_PRDS_PATH}?id=${id}&name=${encodeURIComponent('none.md')}`)
    expect(missing.status).toBe(404)

    const evil = await h.get(`${REQUIREMENTS_PRDS_PATH}?id=${id}&name=${encodeURIComponent('../requirements.yaml')}`)
    expect(evil.status).toBe(400)

    // Oversized preview: a 2MB markdown file on disk bypasses the create cap.
    writeFileSync(join(h.dir, 'ws', 'prds', 'huge.md'), Buffer.alloc(2 * 1024 * 1024))
    const huge = await h.get(`${REQUIREMENTS_PRDS_PATH}?id=${id}&name=${encodeURIComponent('huge.md')}`)
    expect(huge.status).toBe(413)
    expect(((await huge.json()) as ErrorResponse).code).toBe('too-large')
    await h.dispose()
  })

  it('deletes files idempotently and the listing reflects it', async () => {
    const h = await harness()
    const id = await bound(h)
    await h.post(REQUIREMENTS_PRDS_PATH, { id, action: 'create', name: 'a.md', content: 'x' })
    const del = await h.post(REQUIREMENTS_PRDS_PATH, { id, action: 'delete', name: 'a.md' })
    expect(del.status).toBe(200)
    expect(((await del.json()) as { docs: unknown[] }).docs).toEqual([])
    expect(statSync(join(h.dir, 'ws', 'prds', 'a.md'), { throwIfNoEntry: false })).toBeUndefined()

    const again = await h.post(REQUIREMENTS_PRDS_PATH, { id, action: 'delete', name: 'a.md' })
    expect(again.status).toBe(200)
    await h.dispose()
  })

  it('filters .tmp staging files from the listing', async () => {
    const h = await harness()
    const id = await bound(h)
    const prds = join(h.dir, 'ws', 'prds')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(prds, { recursive: true })
    writeFileSync(join(prds, 'real.md'), '# r')
    writeFileSync(join(prds, 'leftover.abc.tmp'), 'junk')
    const listed = await (await h.get(`${REQUIREMENTS_PRDS_PATH}?id=${id}`)).json() as { docs: Array<{ name: string }> }
    expect(listed.docs.map((doc) => doc.name)).toEqual(['real.md'])
    await h.dispose()
  })

  it('streams a multi-chunk upload to disk atomically', async () => {
    const h = await harness()
    const id = await bound(h)
    const res = await h.postStream(
      `${REQUIREMENTS_PRD_UPLOAD_PATH}?id=${id}&name=${encodeURIComponent('上传 文档.pdf')}`,
      [encoder.encode('%PDF-1.4\n'), encoder.encode('binary-ish body')],
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; docs: Array<{ name: string }> }
    expect(body.docs[0]?.name).toBe('上传 文档.pdf')
    expect(readFileSync(join(h.dir, 'ws', 'prds', '上传 文档.pdf'), 'utf8')).toBe('%PDF-1.4\nbinary-ish body')
    await h.dispose()
  })

  it('upload rejects wrong content-type (415), bad names, unbound ids, and duplicates (409)', async () => {
    const h = await harness()
    const id = await bound(h)
    const wrongType = await h.postStream(
      `${REQUIREMENTS_PRD_UPLOAD_PATH}?id=${id}&name=a.md`,
      [encoder.encode('x')],
      { 'content-type': 'application/json' },
    )
    expect(wrongType.status).toBe(415)
    expect(((await wrongType.json()) as ErrorResponse).code).toBe('bad-content-type')

    const badName = await h.postStream(
      `${REQUIREMENTS_PRD_UPLOAD_PATH}?id=${id}&name=${encodeURIComponent('../evil.md')}`,
      [encoder.encode('x')],
    )
    expect(badName.status).toBe(400)

    const noName = await h.postStream(`${REQUIREMENTS_PRD_UPLOAD_PATH}?id=${id}`, [encoder.encode('x')])
    expect(noName.status).toBe(400)

    const unbound = await (await h.post(REQUIREMENTS_SAVE_PATH, {
      expectedRevision: 2,
      requirement: { title: 'beta', description: '' },
    })).json() as { requirement: { id: string } }
    const noWs = await h.postStream(
      `${REQUIREMENTS_PRD_UPLOAD_PATH}?id=${unbound.requirement.id}&name=a.md`,
      [encoder.encode('x')],
    )
    expect(noWs.status).toBe(400)
    expect(((await noWs.json()) as ErrorResponse).code).toBe('no-workspace')

    await h.postStream(`${REQUIREMENTS_PRD_UPLOAD_PATH}?id=${id}&name=a.md`, [encoder.encode('first')])
    const dup = await h.postStream(`${REQUIREMENTS_PRD_UPLOAD_PATH}?id=${id}&name=a.md`, [encoder.encode('second')])
    expect(dup.status).toBe(409)
    expect(readFileSync(join(h.dir, 'ws', 'prds', 'a.md'), 'utf8')).toBe('first')
    await h.dispose()
  })

  it('caps uploads at 32MB (413) and leaves no .tmp behind', async () => {
    const h = await harness()
    const id = await bound(h)
    // One 1MB zero-cost buffer enqueued 33 times ≈ 33MB.
    const chunk = Buffer.alloc(1024 * 1024)
    const res = await h.postStream(`${REQUIREMENTS_PRD_UPLOAD_PATH}?id=${id}&name=big.bin`, Array.from({ length: 33 }, () => chunk))
    expect(res.status).toBe(413)
    expect(((await res.json()) as ErrorResponse).code).toBe('too-large')
    const prds = join(h.dir, 'ws', 'prds')
    expect(readdirSync(prds).filter((name) => name.endsWith('.tmp'))).toEqual([])
    expect(statSync(join(prds, 'big.bin'), { throwIfNoEntry: false })).toBeUndefined()
    await h.dispose()
  })
})
