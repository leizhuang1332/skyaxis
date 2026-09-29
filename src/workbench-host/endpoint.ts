/**
 * Workbench endpoints (0006 P1b): records (GET list/detail + POST action
 * union) over workbench.yaml, artifact documents (GET/POST plain-text bodies,
 * query-discriminated) over the conventional file layout, and the orphan
 * reconciliation scan. Route constants live in workbench-shared/protocol.ts.
 *
 * Preconditions deliberately DROP the no-workspace check the PRD endpoints
 * carry (decisions/0005 细化①): workbench artifacts depend on no workspace
 * binding — an S1 requirement without a workspace can still record findings
 * and write plans. The remaining ladder is 账本可读(409) → 记录存在(404).
 *
 * Validation order (the repos-pool pinned style): wire validation → ledger
 * readable → record exists → business guards → revision → side effects. The
 * artifact write pipeline is ledger-first throughout (D4-③): a 409 returns
 * with zero file side effects, and the only post-save failure mode is a
 * dangling reference — visible via fileExists/scan, converging on retry
 * through the byte-identical idempotent branch.
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import {
  WORKBENCH_ARTIFACTS_PATH,
  WORKBENCH_ARTIFACT_MAX_CHARS,
  WORKBENCH_PATH,
  WORKBENCH_SCAN_PATH,
  isModuleId,
  isPlanVersion,
  isReviewId,
} from '../workbench-shared/protocol.js'
import type {
  ErrorResponse,
  WorkbenchDetailResponseOk,
  WorkbenchFinding,
  WorkbenchListResponse,
  WorkbenchRecord,
} from '../workbench-shared/protocol.js'
import { planDocPath, reviewDocPath } from './artifact-path.js'
import { ArtifactStore, contentHashOf } from './artifact-store.js'
import { scanWorkbenchArtifacts } from './orphan-scan.js'
import type { WorkbenchFileStore } from './workbench-file.js'
import { WorkbenchMutateSchema } from './types.js'

export interface WorkbenchEndpointServices {
  readonly file: WorkbenchFileStore
  /** $DSH_HOME/skyaxis/workbench — the artifacts root. */
  readonly workbenchRoot: string
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

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

const REQUIREMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Implicit ledger creation (the requirements uuid-fallback family): first action on a requirement mints the empty record. */
function emptyRecord(requirementId: string): WorkbenchRecord {
  const at = new Date().toISOString()
  return {
    requirementId,
    stage: 'understand',
    stageHistory: [{ stage: 'understand', at }],
    criteria: [],
    findings: [],
    modules: [],
    releaseItems: [],
    reviewReports: [],
    knowledgeCandidates: [],
  }
}

export function registerWorkbenchEndpoints(connection: HostConnectionHandle, services: WorkbenchEndpointServices): void {
  const { file, log } = services
  const artifacts = new ArtifactStore()

  // -------------------------------------------------------------------------
  // Records: GET list / GET ?requirementId= detail / POST action union.
  // -------------------------------------------------------------------------

  connection.fetch.register({
    path: WORKBENCH_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'GET') return readFlow(request)
      return mutateFlow(request)
    },
  })

  async function readFlow(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const requirementId = url.searchParams.get('requirementId')
    if (requirementId === null) {
      const result = file.load()
      const body: WorkbenchListResponse = result.ok
        ? { ok: true, revision: result.value.revision, records: result.value.records }
        : { ok: false, degraded: true, reason: result.reason, hasBackup: result.hasBackup }
      return json(body)
    }
    if (!REQUIREMENT_ID_RE.test(requirementId)) return errorResponse(400, 'bad-request')
    const current = file.load()
    if (!current.ok) return errorResponse(409, 'unreadable-file')
    const record = current.value.records.find((candidate) => candidate.requirementId === requirementId)
    if (record === undefined) {
      // No record yet is NOT an error — GET never creates (zero read-path
      // side effects); the client renders the first-use empty state.
      const body: WorkbenchDetailResponseOk = {
        ok: true,
        revision: current.value.revision,
        record: null,
        planFileExists: [],
        reviewFileExists: [],
      }
      return json(body)
    }
    // Existence probing is a RESPONSE projection (细化④②): statSync per
    // reference, flat rows; the ledger itself stays path-free.
    const body: WorkbenchDetailResponseOk = {
      ok: true,
      revision: current.value.revision,
      record,
      planFileExists: record.modules.flatMap((module) =>
        module.plans.map((plan) => ({
          moduleId: module.id,
          version: plan.version,
          exists: existsSync(planDocPath(services.workbenchRoot, requirementId, module.id, plan.version)),
        })),
      ),
      reviewFileExists: record.reviewReports.map((report) => ({
        reviewId: report.id,
        exists: existsSync(reviewDocPath(services.workbenchRoot, requirementId, report.id)),
      })),
    }
    return json(body)
  }

  async function mutateFlow(request: Request): Promise<Response> {
    const parsed = WorkbenchMutateSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) return errorResponse(400, 'bad-request')
    const body = parsed.data
    // z.uuid() tolerates uppercase; artifact paths and the detail route are
    // lowercase-only — a non-lowercase id must never mint a ghost record.
    if (!REQUIREMENT_ID_RE.test(body.requirementId)) return errorResponse(400, 'bad-request')

    const current = file.load()
    if (!current.ok) return errorResponse(409, 'unreadable-file')
    if (current.value.revision !== body.expectedRevision) {
      return errorResponse(409, 'conflict', { currentRevision: current.value.revision })
    }
    const existing = current.value.records.find((candidate) => candidate.requirementId === body.requirementId)
    const base = existing ?? emptyRecord(body.requirementId)

    let next: WorkbenchRecord
    if (body.action === 'advanceStage') {
      const at = new Date().toISOString()
      next = {
        ...base,
        stage: body.stage,
        stageHistory: [
          ...base.stageHistory,
          { stage: body.stage, at, ...(body.note !== undefined ? { note: body.note } : {}) },
        ],
      }
    } else if (body.action === 'saveFinding') {
      if (body.finding.id !== undefined) {
        const target = base.findings.find((finding) => finding.id === body.finding.id)
        if (target === undefined) return errorResponse(404, 'not-found')
        // Edit semantics: present fields overwrite, absent fields carry over
        // (id and createdAt are host-owned and never overwritten).
        const { id: _id, ...fields } = body.finding
        next = {
          ...base,
          findings: base.findings.map((finding) => (finding.id === body.finding.id ? { ...finding, ...fields } : finding)),
        }
      } else {
        const created: WorkbenchFinding = {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          ...body.finding,
        }
        next = { ...base, findings: [...base.findings, created] }
      }
    } else {
      if (!base.findings.some((finding) => finding.id === body.id)) return errorResponse(404, 'not-found')
      next = { ...base, findings: base.findings.filter((finding) => finding.id !== body.id) }
    }

    const nextRecords = existing === undefined
      ? [...current.value.records, next]
      : current.value.records.map((candidate) => (candidate.requirementId === body.requirementId ? next : candidate))
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

  // -------------------------------------------------------------------------
  // Artifact documents: POST text/plain bodies (query-discriminated) + GET
  // content reads. The prd / prd-upload two-path precedent — inline JSON
  // fields (32K cap) and markdown bodies (512K cap) never share a body.
  // -------------------------------------------------------------------------

  connection.fetch.register({
    path: WORKBENCH_ARTIFACTS_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'GET') return artifactReadFlow(request)
      return artifactWriteFlow(request)
    },
  })

  async function artifactWriteFlow(request: Request): Promise<Response> {
    const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (mediaType !== 'text/plain') return errorResponse(415, 'bad-content-type')

    const url = new URL(request.url)
    const kind = url.searchParams.get('kind')
    const requirementId = url.searchParams.get('requirementId')
    // Strict numeric parse: Number(null) === 0 would smuggle a missing param
    // through the integer gate and misreport it as a stale revision (409).
    const revisionParam = url.searchParams.get('expectedRevision')
    const expectedRevision = revisionParam !== null && /^\d+$/.test(revisionParam) ? Number(revisionParam) : Number.NaN
    if (requirementId === null || !REQUIREMENT_ID_RE.test(requirementId)) return errorResponse(400, 'bad-request')
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return errorResponse(400, 'bad-request')

    const moduleId = kind === 'plan' ? url.searchParams.get('moduleId') : null
    if (kind === 'plan' && (moduleId === null || !isModuleId(moduleId))) return errorResponse(400, 'bad-request')
    const reviewTitle = kind === 'review' ? url.searchParams.get('title') : null
    if (kind === 'review' && reviewTitle !== null && reviewTitle.length > 128) return errorResponse(400, 'bad-request')
    if (kind !== 'plan' && kind !== 'review') return errorResponse(400, 'bad-request')
    const planNote = kind === 'plan' ? url.searchParams.get('note') : null
    if (kind === 'plan' && planNote !== null && planNote.length > 2000) return errorResponse(400, 'bad-request')

    // UTF-16 code units, the shared one-truth cap (码元 not bytes — CJK text).
    const text = await request.text()
    if (text.length > WORKBENCH_ARTIFACT_MAX_CHARS) return errorResponse(413, 'too-large')

    const current = file.load()
    if (!current.ok) return errorResponse(409, 'unreadable-file')
    const record = current.value.records.find((candidate) => candidate.requirementId === requirementId)
    if (record === undefined) return errorResponse(404, 'not-found')

    if (kind === 'plan') {
      return planWriteFlow(record, current.value.records, current.value.revision, requirementId, moduleId!, planNote, text, expectedRevision)
    }
    return reviewWriteFlow(record, current.value.records, current.value.revision, requirementId, reviewTitle, text, expectedRevision)
  }

  /**
   * Plan write pipeline (D4-③): tail-draft semantics + approved-version lock
   * + byte-identical idempotent convergence, ledger-first throughout.
   */
  async function planWriteFlow(
    record: WorkbenchRecord,
    ledgerRecords: readonly WorkbenchRecord[],
    ledgerRevision: number,
    requirementId: string,
    moduleId: string,
    note: string | null,
    text: string,
    expectedRevision: number,
  ): Promise<Response> {
    const module = record.modules.find((candidate) => candidate.id === moduleId)
    if (module === undefined) return errorResponse(404, 'not-found')
    const hash = contentHashOf(text)

    // The tail draft: the LAST unapproved plan entry — draft edits overwrite
    // the same version and re-hash; there is exactly one draft at a time.
    const draft = [...module.plans].reverse().find((plan) => plan.approvedAt === undefined)
    // A note-only change still needs the ledger write — the idempotent
    // branch below must not swallow it with a 200.
    const noteUnchanged = draft === undefined
      ? true
      : (note === null ? draft.note === undefined : draft.note === note)

    if (draft !== undefined && draft.contentHash === hash && noteUnchanged) {
      // Byte-identical retry: converge without a ledger write. "Converged"
      // means disk == ledger — a MISSING file (write interrupted) and a
      // STALE file (an overwritten draft whose post-save write failed,
      // leaving the previous bytes on disk) both get repaired here; only a
      // disk that already hashes to the ledger value is left untouched.
      const target = planDocPath(services.workbenchRoot, requirementId, moduleId, draft.version)
      const read = artifacts.read(target)
      if (read.status !== 'ok' || read.sha256 !== hash) {
        try {
          artifacts.write(target, text)
        } catch (error) {
          log?.(error)
          return errorResponse(500, 'internal')
        }
      }
      return json({ ok: true, revision: ledgerRevision, kind: 'plan', moduleId, version: draft.version })
    }

    let version: number
    let nextPlans: WorkbenchRecord['modules'][number]['plans']
    if (draft !== undefined) {
      // Fuse (unreachable by construction — the draft selection excludes
      // approved entries): an approved target must never be overwritten;
      // "批准锁定" is an endpoint contract, not a slogan (细化③).
      if (draft.approvedAt !== undefined) return errorResponse(400, 'locked-version')
      version = draft.version
      nextPlans = module.plans.map((plan) =>
        plan.version === version
          ? { ...plan, contentHash: hash, ...(note !== null ? { note } : {}) }
          : plan,
      )
    } else {
      version = module.plans.reduce((max, plan) => Math.max(max, plan.version), 0) + 1
      nextPlans = [...module.plans, { version, contentHash: hash, ...(note !== null ? { note } : {}) }]
    }

    if (ledgerRevision !== expectedRevision) {
      return errorResponse(409, 'conflict', { currentRevision: ledgerRevision })
    }
    const nextRecord: WorkbenchRecord = {
      ...record,
      modules: record.modules.map((candidate) => (candidate.id === moduleId ? { ...candidate, plans: nextPlans } : candidate)),
    }
    try {
      const saved = await file.save(expectedRevision, withRecord(ledgerRecords, requirementId, nextRecord))
      if (!saved.ok) {
        if (saved.rejected === 'stale-revision') {
          return errorResponse(409, 'conflict', { currentRevision: saved.currentRevision })
        }
        return errorResponse(409, 'unreadable-file')
      }
      // Ledger committed; the file write is the only post-commit step. Its
      // failure leaves a dangling reference (500) — retry hits the
      // idempotent branch above and converges without another save.
      try {
        artifacts.write(planDocPath(services.workbenchRoot, requirementId, moduleId, version), text)
      } catch (error) {
        log?.(error)
        return errorResponse(500, 'internal')
      }
      return json({ ok: true, revision: saved.revision, kind: 'plan', moduleId, version })
    } catch (error) {
      log?.(error)
      return errorResponse(500, 'internal')
    }
  }

  async function reviewWriteFlow(
    record: WorkbenchRecord,
    ledgerRecords: readonly WorkbenchRecord[],
    ledgerRevision: number,
    requirementId: string,
    title: string | null,
    text: string,
    expectedRevision: number,
  ): Promise<Response> {
    // Reviews have no version anchor this round (each write mints a fresh
    // uuid); an idempotency key is a P4 concern if import interactions need
    // retry-without-duplicate semantics (recorded as an open item).
    const reviewId = randomUUID()
    const hash = contentHashOf(text)
    if (ledgerRevision !== expectedRevision) {
      return errorResponse(409, 'conflict', { currentRevision: ledgerRevision })
    }
    const nextRecord: WorkbenchRecord = {
      ...record,
      reviewReports: [
        ...record.reviewReports,
        { id: reviewId, at: new Date().toISOString(), ...(title !== null ? { title } : {}), contentHash: hash, verdicts: [] },
      ],
    }
    const nextRecords = withRecord(ledgerRecords, requirementId, nextRecord)
    try {
      const saved = await file.save(expectedRevision, nextRecords)
      if (!saved.ok) {
        if (saved.rejected === 'stale-revision') {
          return errorResponse(409, 'conflict', { currentRevision: saved.currentRevision })
        }
        return errorResponse(409, 'unreadable-file')
      }
      try {
        artifacts.write(reviewDocPath(services.workbenchRoot, requirementId, reviewId), text)
      } catch (error) {
        log?.(error)
        return errorResponse(500, 'internal')
      }
      return json({ ok: true, revision: saved.revision, kind: 'review', reviewId })
    } catch (error) {
      log?.(error)
      return errorResponse(500, 'internal')
    }
  }

  async function artifactReadFlow(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const kind = url.searchParams.get('kind')
    const requirementId = url.searchParams.get('requirementId')
    if (requirementId === null || !REQUIREMENT_ID_RE.test(requirementId)) return errorResponse(400, 'bad-request')
    if (kind !== 'plan' && kind !== 'review') return errorResponse(400, 'bad-request')

    const current = file.load()
    if (!current.ok) return errorResponse(409, 'unreadable-file')
    const record = current.value.records.find((candidate) => candidate.requirementId === requirementId)
    if (record === undefined) return errorResponse(404, 'not-found')

    let target: string
    let expectedHash: string | undefined
    if (kind === 'plan') {
      const moduleId = url.searchParams.get('moduleId')
      const version = Number(url.searchParams.get('version'))
      if (moduleId === null || !isModuleId(moduleId) || !isPlanVersion(version)) return errorResponse(400, 'bad-request')
      const module = record.modules.find((candidate) => candidate.id === moduleId)
      if (module === undefined) return errorResponse(404, 'not-found')
      const entry = module.plans.find((plan) => plan.version === version)
      if (entry === undefined) return errorResponse(404, 'not-found')
      target = planDocPath(services.workbenchRoot, requirementId, moduleId, version)
      expectedHash = entry.contentHash
    } else {
      const reviewId = url.searchParams.get('reviewId')
      if (reviewId === null || !isReviewId(reviewId)) return errorResponse(400, 'bad-request')
      const entry = record.reviewReports.find((report) => report.id === reviewId)
      if (entry === undefined) return errorResponse(404, 'not-found')
      target = reviewDocPath(services.workbenchRoot, requirementId, reviewId)
      expectedHash = entry.contentHash
    }

    const read = artifacts.read(target)
    if (read.status === 'missing') return errorResponse(404, 'not-found')
    if (read.status === 'too-large') return errorResponse(413, 'too-large')
    // Legacy entries without a hash read back untampered-silent (field-
    // evolution discipline); a present hash that disagrees answers 200 +
    // contentTampered — never silently, never blocking (细化④).
    const contentTampered = expectedHash !== undefined && expectedHash !== read.sha256
    return json({ ok: true, content: read.text, contentTampered })
  }

  // -------------------------------------------------------------------------
  // Orphan reconciliation scan (细化④): disk-vs-ledger both ways + .trash.
  // -------------------------------------------------------------------------

  connection.fetch.register({
    path: WORKBENCH_SCAN_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const current = file.load()
      if (!current.ok) return errorResponse(409, 'unreadable-file')
      return json({ ok: true, ...scanWorkbenchArtifacts(services.workbenchRoot, current.value.records) })
    },
  })
}

/** The records array with `next` replacing the requirement's row. */
function withRecord(records: readonly WorkbenchRecord[], requirementId: string, next: WorkbenchRecord): readonly WorkbenchRecord[] {
  return records.map((candidate) => (candidate.requirementId === requirementId ? next : candidate))
}
