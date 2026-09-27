/**
 * PRD document endpoints (P3c): the requirement workspace's prds/ directory
 * is the source of truth — scanned, never ledgered. Every successful
 * mutation answers with the fresh listing (one envelope, one fetcher guard).
 *
 * Route 1 (buffered, GET+POST): list / read markdown content / create / delete.
 * Route 2 (streaming, POST): byte upload — the request body is a Web
 * ReadableStream consumed chunk-by-chunk into a temp file, byte-capped by the
 * handler itself (the channel imposes no aggregate limit), then atomically
 * renamed into place. Errors keep the skyaxis status-code style (413/415/409
 * + ErrorResponse), NOT the host file-upload's constant-200 style.
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import {
  REQUIREMENTS_PRDS_PATH,
  REQUIREMENTS_PRD_UPLOAD_PATH,
} from '../requirements-shared/protocol.js'
import type { ErrorResponse, PrdDocSummary } from '../requirements-shared/protocol.js'
import { PRD_READ_MAX_BYTES, PRD_UPLOAD_MAX_BYTES, sanitizePrdFileName } from '../requirements-shared/prd-file.js'
import type { RequirementsFileStore } from './requirements-file.js'
import { PrdRequestSchema } from './types.js'

export interface RequirementsPrdServices {
  readonly file: RequirementsFileStore
  /** Host log face for unexpected handler failures (500s). */
  readonly log?: (error: unknown) => void
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function errorResponse(status: number, code: ErrorResponse['code']): Response {
  return json({ ok: false, code }, status)
}

/** Scan the prds/ directory; a missing directory is an empty listing, not an error. */
function scanPrdDocs(prdsDir: string): readonly PrdDocSummary[] {
  if (statSync(prdsDir, { throwIfNoEntry: false })?.isDirectory() !== true) return []
  const rows: PrdDocSummary[] = []
  for (const entry of readdirSync(prdsDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.endsWith('.tmp')) continue
    const info = statSync(join(prdsDir, entry.name), { throwIfNoEntry: false })
    if (info === undefined) continue
    rows.push({ name: entry.name, size: info.size, modifiedAt: info.mtimeMs })
  }
  rows.sort((a, b) => (b.modifiedAt - a.modifiedAt) || (a.name < b.name ? -1 : 1))
  return rows
}

/** Shared preconditions: ledger readable, record exists, workspace bound. */
function prdContext(file: RequirementsFileStore, id: string):
  { ok: false; response: Response } | { ok: true; prdsDir: string } {
  const current = file.load()
  if (!current.ok) return { ok: false, response: errorResponse(409, 'unreadable-file') }
  const record = current.value.requirements.find((candidate) => candidate.id === id)
  if (record === undefined) return { ok: false, response: errorResponse(404, 'not-found') }
  if (record.workspacePath === '') return { ok: false, response: errorResponse(400, 'no-workspace') }
  return { ok: true, prdsDir: join(record.workspacePath, 'prds') }
}

export function registerRequirementsPrdEndpoints(connection: HostConnectionHandle, services: RequirementsPrdServices): void {
  const { file, log } = services

  connection.fetch.register({
    path: REQUIREMENTS_PRDS_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'GET') return prdsGetFlow(request)
      return prdsPostFlow(request)
    },
  })

  async function prdsGetFlow(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (id === null) return errorResponse(400, 'bad-request')
    const ctx = prdContext(file, id)
    if (!ctx.ok) return ctx.response

    const name = url.searchParams.get('name')
    if (name === null) return json({ ok: true, docs: scanPrdDocs(ctx.prdsDir) })

    // Content read: markdown only, sanitized-name invariant (traversal guard),
    // size-capped so the preview channel never freezes on a huge file.
    if (sanitizePrdFileName(name) !== name || !name.toLowerCase().endsWith('.md')) {
      return errorResponse(400, 'bad-request')
    }
    const target = join(ctx.prdsDir, name)
    const info = statSync(target, { throwIfNoEntry: false })
    if (info === undefined || !info.isFile()) return errorResponse(404, 'not-found')
    if (info.size > PRD_READ_MAX_BYTES) return errorResponse(413, 'too-large')
    return new Response(readFileSync(target), {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  async function prdsPostFlow(request: Request): Promise<Response> {
    const parsed = PrdRequestSchema.safeParse(await request.json().catch(() => undefined))
    if (!parsed.success) return errorResponse(400, 'bad-request')
    const body = parsed.data
    const ctx = prdContext(file, body.id)
    if (!ctx.ok) return ctx.response
    if (sanitizePrdFileName(body.name) !== body.name) return errorResponse(400, 'bad-request')
    const final = join(ctx.prdsDir, body.name)

    if (body.action === 'delete') {
      // force absorbs ENOENT — deleting an absent file is an idempotent ok.
      try {
        rmSync(final, { force: true, maxRetries: 3, retryDelay: 100 })
      } catch (error) {
        log?.(error)
        return errorResponse(500, 'internal')
      }
      return json({ ok: true, docs: scanPrdDocs(ctx.prdsDir) })
    }

    // create
    if (existsSync(final)) return errorResponse(409, 'duplicate-name')
    try {
      mkdirSync(ctx.prdsDir, { recursive: true })
      const tmp = `${final}.${randomUUID()}.tmp`
      writeFileSync(tmp, body.content, 'utf8')
      renameSync(tmp, final)
    } catch (error) {
      log?.(error)
      return errorResponse(500, 'internal')
    }
    return json({ ok: true, docs: scanPrdDocs(ctx.prdsDir) })
  }

  connection.fetch.register({
    path: REQUIREMENTS_PRD_UPLOAD_PATH,
    methods: ['POST'],
    requestBody: 'streaming',
    fetch: async (request) => uploadFlow(request),
  })

  async function uploadFlow(request: Request): Promise<Response> {
    const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (mediaType !== 'application/octet-stream') return errorResponse(415, 'bad-content-type')

    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    const rawName = url.searchParams.get('name')
    if (id === null || rawName === null) return errorResponse(400, 'bad-request')
    const name = sanitizePrdFileName(rawName)
    if (name === '' || name !== rawName) return errorResponse(400, 'bad-request')

    const ctx = prdContext(file, id)
    if (!ctx.ok) return ctx.response
    const final = join(ctx.prdsDir, name)
    if (existsSync(final)) return errorResponse(409, 'duplicate-name')

    try {
      mkdirSync(ctx.prdsDir, { recursive: true })
    } catch (error) {
      log?.(error)
      return errorResponse(500, 'internal')
    }

    // Stream to a temp file, counting bytes — the channel has no aggregate
    // cap, so the 32MB guard lives here.
    const tmp = `${final}.${randomUUID()}.tmp`
    let bytes = 0
    let fd: number | undefined
    const reader = request.body?.getReader()
    if (reader === undefined) return errorResponse(400, 'bad-request')
    try {
      fd = openSync(tmp, 'w')
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > PRD_UPLOAD_MAX_BYTES) {
          closeSync(fd)
          fd = undefined
          rmSync(tmp, { force: true })
          return errorResponse(413, 'too-large')
        }
        writeSync(fd, chunk.value)
      }
      closeSync(fd)
      fd = undefined
    } catch (error) {
      if (fd !== undefined) {
        try { closeSync(fd) } catch { /* already closed */ }
      }
      rmSync(tmp, { force: true })
      log?.(error)
      // A client disconnect surfaces here; nobody reads the response anyway.
      return errorResponse(500, 'internal')
    } finally {
      void reader.cancel().catch(() => undefined)
    }

    // Narrow the duplicate window (TOCTOU): re-check right before the rename.
    if (existsSync(final)) {
      rmSync(tmp, { force: true })
      return errorResponse(409, 'duplicate-name')
    }
    try {
      renameSync(tmp, final)
    } catch (error) {
      rmSync(tmp, { force: true })
      log?.(error)
      return errorResponse(500, 'internal')
    }
    return json({ ok: true, docs: scanPrdDocs(ctx.prdsDir) })
  }
}
