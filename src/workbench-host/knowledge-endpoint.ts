/**
 * knowledge.yaml endpoints (P2): a SEPARATE route with its own action union
 * and its own optimistic lock — the knowledge base is a global asset store,
 * not a per-requirement ledger (no implicit-record semantics, no split gate;
 * the D6 cascade and the activate-candidate tail write are its only
 * cross-ledger writers besides this route).
 *
 * GET  ?requirementId=<uuid> — the user-ratified P2 view: scope==='requirement'
 *      && id match ∪ scope==='global' (workspace rows join P5 path matching).
 *      Both statuses travel; the client filters active. A degraded ledger
 *      answers 200 + degraded envelope (the main list route's convention),
 *      never 409 — reads degrade, they don't error.
 * POST — saveKnowledge (absent id = create, host mints uuid + status active;
 *      present id = full-row replace, scope changes legal) / archiveKnowledge
 *      (idempotent skip-save — the revision never bumps for nothing).
 *
 * Scope coupling (workspace ⇒ path, requirement ⇒ requirementId) and
 * keyword/path ⇒ non-empty value are BUSINESS guards at this write boundary:
 * KnowledgeRecordSchema's superRefine is the load-side backstop — a row that
 * sneaks through poisons the whole file on the next load, so it never gets
 * written in the first place.
 */
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { randomUUID } from 'node:crypto'
import { WORKBENCH_KNOWLEDGE_PATH } from '../workbench-shared/protocol.js'
import type { ErrorResponse, WorkbenchKnowledgeListResponse } from '../workbench-shared/protocol.js'
import type { KnowledgeRecord } from './types.js'
import { WorkbenchKnowledgeMutateSchema } from './types.js'
import type { KnowledgeFileStore } from './knowledge-file.js'

export interface WorkbenchKnowledgeEndpointServices {
  readonly file: KnowledgeFileStore
  /** Host log face for unexpected handler failures (500s). */
  readonly log?: (error: unknown) => void
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function errorResponse(status: number, code: ErrorResponse['code'], extra?: Omit<ErrorResponse, 'ok' | 'code'>): Response {
  return json({ ok: false, code, ...extra }, status)
}

const REQUIREMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Normalized trigger: value kept only where the mode consumes it. */
function normalizeTrigger(mode: 'always' | 'path' | 'keyword' | 'manual', value?: string): KnowledgeRecord['trigger'] | null {
  if (mode === 'keyword' || mode === 'path') {
    const trimmed = value?.trim()
    return trimmed !== undefined && trimmed.length > 0 ? { mode, value: trimmed } : null
  }
  return { mode }
}

export function registerWorkbenchKnowledgeEndpoints(connection: HostConnectionHandle, services: WorkbenchKnowledgeEndpointServices): void {
  const { file, log } = services

  connection.fetch.register({
    path: WORKBENCH_KNOWLEDGE_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'GET') return listFlow(request)
      return mutateFlow(request)
    },
  })

  function listFlow(request: Request): Response {
    const url = new URL(request.url)
    const requirementId = url.searchParams.get('requirementId')
    if (requirementId === null || !REQUIREMENT_ID_RE.test(requirementId)) return errorResponse(400, 'bad-request')
    const current = file.load()
    const body: WorkbenchKnowledgeListResponse = current.ok
      ? {
        ok: true,
        revision: current.value.revision,
        records: current.value.records.filter((row) =>
          row.scope === 'global' || (row.scope === 'requirement' && row.requirementId === requirementId)),
      }
      : { ok: false, degraded: true, reason: current.reason, hasBackup: current.hasBackup }
    return json(body)
  }

  async function mutateFlow(request: Request): Promise<Response> {
    let parsedBody: unknown
    try {
      parsedBody = await request.json()
    } catch {
      parsedBody = undefined
    }
    const parsed = WorkbenchKnowledgeMutateSchema.safeParse(parsedBody)
    if (!parsed.success) return errorResponse(400, 'bad-request')
    const body = parsed.data

    const current = file.load()
    if (!current.ok) return errorResponse(409, 'unreadable-file')
    if (current.value.revision !== body.expectedRevision) {
      return errorResponse(409, 'conflict', { currentRevision: current.value.revision })
    }

    let next: KnowledgeRecord
    let nextRecords: readonly KnowledgeRecord[]
    if (body.action === 'saveKnowledge') {
      const input = body.knowledge
      if (input.scope === 'workspace' && (input.path === undefined || input.path.trim().length === 0)) {
        return errorResponse(400, 'bad-request')
      }
      if (input.scope === 'requirement' && input.requirementId === undefined) {
        return errorResponse(400, 'bad-request')
      }
      const trigger = normalizeTrigger(input.trigger.mode, input.trigger.value)
      if (trigger === null) return errorResponse(400, 'bad-request')

      if (input.id !== undefined) {
        // Full-row replace (scope changes legal — promote semantics); status
        // and provenance are store-owned and carried over.
        const existing = current.value.records.find((row) => row.id === input.id)
        if (existing === undefined) return errorResponse(404, 'not-found')
        next = {
          ...existing,
          scope: input.scope,
          type: input.type,
          title: input.title,
          content: input.content,
          ...(input.scope === 'workspace' ? { path: input.path!.trim() } : { path: undefined }),
          ...(input.scope === 'requirement' ? { requirementId: input.requirementId } : { requirementId: undefined }),
          trigger,
        }
        nextRecords = current.value.records.map((row) => (row.id === input.id ? next : row))
      } else {
        next = {
          id: randomUUID(),
          scope: input.scope,
          type: input.type,
          title: input.title,
          content: input.content,
          ...(input.scope === 'workspace' ? { path: input.path!.trim() } : {}),
          ...(input.scope === 'requirement' ? { requirementId: input.requirementId } : {}),
          trigger,
          status: 'active',
          provenance: { at: new Date().toISOString() },
        }
        nextRecords = [...current.value.records, next]
      }
    } else {
      // archiveKnowledge — idempotent re-archive skips the save entirely.
      const target = current.value.records.find((row) => row.id === body.id)
      if (target === undefined) return errorResponse(404, 'not-found')
      if (target.status === 'archived') {
        return json({ ok: true, revision: current.value.revision, record: target })
      }
      next = { ...target, status: 'archived' }
      nextRecords = current.value.records.map((row) => (row.id === body.id ? next : row))
    }

    try {
      const saved = await file.save(body.expectedRevision, nextRecords)
      if (!saved.ok) {
        if (saved.rejected === 'stale-revision') {
          return errorResponse(409, 'conflict', { currentRevision: saved.currentRevision })
        }
        return errorResponse(409, 'unreadable-file')
      }
      return json({ ok: true, revision: saved.revision, record: next })
    } catch (error) {
      log?.(error)
      return errorResponse(500, 'internal')
    }
  }
}
