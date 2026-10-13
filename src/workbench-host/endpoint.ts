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
  WORKBENCH_DECLARE_PATH,
  WORKBENCH_PATH,
  WORKBENCH_SCAN_PATH,
  DECLARE_MAX_CHARS,
  isWorkPackageId,
  isPlanVersion,
  isReviewId,
} from '../workbench-shared/protocol.js'
import type {
  DeclareCommitResponseOk,
  DeclareFetchResponse,
  DeclarePreviewResponseOk,
  DeclareSkip,
  ErrorResponse,
  ReviewFetchResponse,
  ReviewVerdict,
  WorkbenchDetailResponseOk,
  WorkbenchListResponse,
  WorkbenchRecord,
} from '../workbench-shared/protocol.js'
import { planDocPath, reviewDocPath } from './artifact-path.js'
import { ArtifactStore, contentHashOf } from './artifact-store.js'
import { scanWorkbenchArtifacts } from './orphan-scan.js'
import { applyRecordAction, applyAnalysisSeed, nextReleaseItemId } from './record-actions.js'
import { parseDeclare } from './declare-parse.js'
import { parseReviewFindings } from './review-parse.js'
import type { SessionDeclareReader } from './declare-reader.js'
import type { KnowledgeFileStore } from './knowledge-file.js'
import type { KnowledgeRecord } from './types.js'
import type { WorkbenchFileStore } from './workbench-file.js'
import { DeclareImportSchema, WorkbenchMutateSchema } from './types.js'

export interface WorkbenchEndpointServices {
  readonly file: WorkbenchFileStore
  /** knowledge.yaml store — consumed by the activate-candidate dual-ledger tail write (P2). */
  readonly knowledgeFile: KnowledgeFileStore
  /** $DSH_HOME/skyaxis/workbench — the artifacts root. */
  readonly workbenchRoot: string
  /** Session-log declare fetch (P3b) — engine optionally injected, absent ⇒ GET degrades to no-service. */
  readonly declareReader: SessionDeclareReader
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
    workPackages: [],
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
        releaseDrifted: [],
      }
      return json(body)
    }
    // Existence probing is a RESPONSE projection (细化④②): statSync per
    // reference, flat rows; the ledger itself stays path-free.
    const body: WorkbenchDetailResponseOk = {
      ok: true,
      revision: current.value.revision,
      record,
      planFileExists: record.workPackages.flatMap((workPackage) =>
        workPackage.plans.map((plan) => ({
          workPackageId: workPackage.id,
          version: plan.version,
          exists: existsSync(planDocPath(services.workbenchRoot, requirementId, workPackage.id, plan.version)),
        })),
      ),
      reviewFileExists: record.reviewReports.map((report) => ({
        reviewId: report.id,
        exists: existsSync(reviewDocPath(services.workbenchRoot, requirementId, report.id)),
      })),
      // Drift is recomputed at READ time, never stored (细化④②'s projection
      // discipline applied to inline content): the endpoint re-hashes every
      // item's content and compares with the registration-time contentHash.
      // Content written through THIS endpoint always re-hashes in the same
      // write, so a mismatch has exactly one cause — the ledger file was
      // edited outside the endpoint (research §7.3's Flyway-checksum story,
      // corrected for the inline form: the drift channel is external
      // tampering, not in-product editing).
      releaseDrifted: record.releaseItems
        .filter((item) => contentHashOf(item.content) !== item.contentHash)
        .map((item) => item.id),
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

    // seedAnalysis (回传轮) is the ONE action with its own flow: its input is
    // a sessionId and its payload lives in the session log, so the shell owns
    // the read IO before the pure core (applyRecordAction stays IO-free).
    // No implicit-create here — seeding requires a prior bindAnalysisSession
    // (the container names the watched session; a missing record has none).
    if (body.action === 'seedAnalysis') return seedAnalysisFlow(body, existing, current.value)

    // All business guards (target existence, split lock, state-machine
    // legality, referential integrity) live in the pure action core.
    const applied = applyRecordAction(base, body)
    if (!applied.ok) return errorResponse(applied.status, applied.code)
    const next = applied.record

    // Dual-ledger activate (P2): the candidate row for knowledge.yaml rides
    // on the result. Readability is a PRE-check — knowledge degraded ⇒ 409
    // with the workbench ledger untouched (no promote without its projection).
    if (applied.knowledgeRow !== undefined) {
      const knowledge = services.knowledgeFile.load()
      if (!knowledge.ok) return errorResponse(409, 'unreadable-file')
    }

    // Idempotent no-op (repeat bind / repeat dismiss / promoted-already):
    // skip the ledger save — the revision must not bump for nothing.
    if (applied.unchanged === true) {
      if (applied.knowledgeRow !== undefined) {
        const repair = await upsertKnowledgeRow(services.knowledgeFile, applied.knowledgeRow, log)
        if (!repair) return errorResponse(500, 'internal')
      }
      return json({ ok: true, revision: current.value.revision, record: next })
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
      // Tail write (the D6-cascade discipline): the workbench ledger is
      // committed and authoritative; the knowledge.yaml upsert is a
      // best-effort projection. A failure answers 500 (retry converges via
      // the unchanged branch above — candidate promoted + row missing).
      if (applied.knowledgeRow !== undefined) {
        const projected = await upsertKnowledgeRow(services.knowledgeFile, applied.knowledgeRow, log)
        if (!projected) return errorResponse(500, 'internal')
      }
      return json({ ok: true, revision: saved.revision, record: next })
    } catch (error) {
      log?.(error)
      return errorResponse(500, 'internal')
    }
  }

  /**
   * seedAnalysis (回传轮): read the bound session's declare block, parse its
   * proposal rows, replace the pending batch (idempotency = sessionId +
   * contentHash anchor inside applyAnalysisSeed). Every NON-committing
   * outcome answers 200 ZERO-WRITE — {ok, revision, record: existing} with
   * no banner field, no revision bump — so the watcher retries silently:
   *   session missing (no-service / not-found / unreadable / no-block) — the
   *   report may not exist yet; block-level YAML syntax error — advisory,
   *   the user may re-run the session;
   *   anchor hit — unchanged (user-deleted rows never resurrect).
   * Concurrency: the session read is slow IO between load and save — any
   * interleaved write moves the revision, this save hits stale-revision →
   * 409, and the client converges by re-opening. A stale success therefore
   * cannot land out of order.
   */
  async function seedAnalysisFlow(
    body: { expectedRevision: number; requirementId: string; action: 'seedAnalysis'; sessionId: string },
    existing: WorkbenchRecord | undefined,
    current: { revision: number; records: readonly WorkbenchRecord[] },
  ): Promise<Response> {
    if (existing === undefined
      || existing.analysis === undefined
      || existing.analysis.session.sessionId !== body.sessionId) {
      return errorResponse(404, 'not-found')
    }
    let base = existing
    let sessionId = body.sessionId
    let read = await services.declareReader.readDeclareText(sessionId)
    // 回传轮 shell repair (四次诊断): the delivery's created session can be a
    // config-only SHELL (DSH's send flow materializes the real conversation
    // under a fresh id). When the bound log holds NO user message at all and
    // the container carries the task-book anchor, content-address the real
    // session and swap the pointer in-memory — the swap persists only with a
    // successful seed (one write path; a miss on the repaired id keeps the
    // original record and re-runs the search on the next attempt).
    if (read.status === 'missing' && read.reason === 'no-declare-block' && read.shell === true) {
      const anchor = existing.analysis.session.anchor
      const repaired = anchor !== undefined ? await services.declareReader.findTaskbookSession(anchor, sessionId) : undefined
      if (repaired !== undefined) {
        const rebound = applyRecordAction(base, {
          expectedRevision: body.expectedRevision,
          requirementId: body.requirementId,
          action: 'bindAnalysisSession',
          sessionId: repaired,
        })
        if (rebound.ok) {
          base = rebound.record
          sessionId = repaired
          read = await services.declareReader.readDeclareText(sessionId)
        }
      }
    }
    if (read.status !== 'ok') {
      return json({
        ok: true,
        revision: current.revision,
        record: existing,
        seedMissing: read.reason,
        ...(read.scan !== undefined ? { seedScan: read.scan } : {}),
        ...(read.shell === true ? { seedShell: true } : {}),
      })
    }
    const parsed = parseDeclare({ text: read.text, record: base })
    if (!parsed.ok) return json({ ok: true, revision: current.revision, record: existing, seedMissing: 'yaml-syntax' })
    const applied = applyAnalysisSeed(base, {
      sessionId,
      contentHash: contentHashOf(read.text),
      findings: parsed.proposals.findings,
      criteria: parsed.proposals.criteria,
    })
    if (!applied.ok) return errorResponse(applied.status, applied.code)
    if (applied.unchanged === true) {
      return json({ ok: true, revision: current.revision, record: applied.record })
    }
    const nextRecords = current.records.map((candidate) => (candidate.requirementId === body.requirementId ? applied.record : candidate))
    try {
      const saved = await file.save(body.expectedRevision, nextRecords)
      if (!saved.ok) {
        if (saved.rejected === 'stale-revision') {
          return errorResponse(409, 'conflict', { currentRevision: saved.currentRevision })
        }
        return errorResponse(409, 'unreadable-file')
      }
      return json({ ok: true, revision: saved.revision, record: applied.record })
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

    const workPackageId = kind === 'plan' ? url.searchParams.get('workPackageId') : null
    if (kind === 'plan' && (workPackageId === null || !isWorkPackageId(workPackageId))) return errorResponse(400, 'bad-request')
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
      return planWriteFlow(record, current.value.records, current.value.revision, requirementId, workPackageId!, planNote, text, expectedRevision)
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
    workPackageId: string,
    note: string | null,
    text: string,
    expectedRevision: number,
  ): Promise<Response> {
    const workPackage = record.workPackages.find((candidate) => candidate.id === workPackageId)
    if (workPackage === undefined) return errorResponse(404, 'not-found')
    // Hard gate ① shadows plan writes too: a revoked split re-locks the
    // whole lifecycle. Checked BEFORE the idempotent branch — after a
    // revoke, even a byte-identical retry is a locked write (a dangling
    // file left on disk converges after re-approval or via the scan).
    if (record.splitApprovedAt === undefined) return errorResponse(400, 'locked-split')
    const hash = contentHashOf(text)

    // The tail draft: the LAST unapproved plan entry — draft edits overwrite
    // the same version and re-hash; there is exactly one draft at a time.
    const draft = [...workPackage.plans].reverse().find((plan) => plan.approvedAt === undefined)
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
      const target = planDocPath(services.workbenchRoot, requirementId, workPackageId, draft.version)
      const read = artifacts.read(target)
      if (read.status !== 'ok' || read.sha256 !== hash) {
        try {
          artifacts.write(target, text)
        } catch (error) {
          log?.(error)
          return errorResponse(500, 'internal')
        }
      }
      return json({ ok: true, revision: ledgerRevision, kind: 'plan', workPackageId, version: draft.version })
    }

    let version: number
    let nextPlans: WorkbenchRecord['workPackages'][number]['plans']
    if (draft !== undefined) {
      // Fuse (unreachable by construction — the draft selection excludes
      // approved entries): an approved target must never be overwritten;
      // "批准锁定" is an endpoint contract, not a slogan (细化③).
      if (draft.approvedAt !== undefined) return errorResponse(400, 'locked-version')
      version = draft.version
      nextPlans = workPackage.plans.map((plan) =>
        plan.version === version
          ? { ...plan, contentHash: hash, ...(note !== null ? { note } : {}) }
          : plan,
      )
    } else {
      version = workPackage.plans.reduce((max, plan) => Math.max(max, plan.version), 0) + 1
      nextPlans = [...workPackage.plans, { version, contentHash: hash, ...(note !== null ? { note } : {}) }]
    }

    if (ledgerRevision !== expectedRevision) {
      return errorResponse(409, 'conflict', { currentRevision: ledgerRevision })
    }
    // The planned → plan-draft flip rides the SAME ledger save as the first
    // plan entry (atomic — no "plan exists but status didn't move" middle
    // state); the idempotent branch skips the save, which by construction
    // already flipped it. Later writes keep whatever status the lifecycle
    // holds (approving/re-baselining is approvePlan's business).
    const nextRecord: WorkbenchRecord = {
      ...record,
      workPackages: record.workPackages.map((candidate) => (candidate.id === workPackageId
        ? { ...candidate, plans: nextPlans, ...(candidate.status === 'planned' ? { status: 'plan-draft' as const } : {}) }
        : candidate)),
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
        artifacts.write(planDocPath(services.workbenchRoot, requirementId, workPackageId, version), text)
      } catch (error) {
        log?.(error)
        return errorResponse(500, 'internal')
      }
      return json({ ok: true, revision: saved.revision, kind: 'plan', workPackageId, version })
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
    const hash = contentHashOf(text)

    // Idempotency anchor (P4, the planWriteFlow byte-identical convergence
    // applied to reviews): a retry carrying the SAME content and title
    // converges onto the existing report — no second entry, no revision
    // bump; a missing/stale body file is repaired in passing. The import
    // modal's retry-after-failure path depends on this (the P1b open item).
    //
    // The convergence branch NEVER re-seeds verdicts (P5b): a retry of an
    // already-imported report must not resurrect rows the user deleted. Only
    // the NEW-report branch below seeds. So re-importing identical content
    // after deleting some findings converges without re-adding them — the
    // correct idempotent behavior (a test pins it).
    const existing = record.reviewReports.find((entry) => entry.contentHash === hash && (entry.title ?? '') === (title ?? ''))
    if (existing !== undefined) {
      const target = reviewDocPath(services.workbenchRoot, requirementId, existing.id)
      const read = artifacts.read(target)
      if (read.status !== 'ok' || read.sha256 !== hash) {
        try {
          artifacts.write(target, text)
        } catch (error) {
          log?.(error)
          return errorResponse(500, 'internal')
        }
      }
      return json({ ok: true, revision: ledgerRevision, kind: 'review', reviewId: existing.id })
    }

    // P5b: seed proposed verdict rows from a `# skyaxis-review` block. A
    // missing/unparseable block is ADVISORY, not blocking — the report is
    // free-form markdown and imports regardless (verdicts stays empty); the
    // response carries seeded count + blockError for honest disclosure. Each
    // finding is host-minted as a 'proposed' verdict (the AI-proposal state a
    // client can never write); bad rows are skipped, never truncated.
    const reviewParse = parseReviewFindings(text)
    const seededVerdicts: ReviewVerdict[] = reviewParse.ok
      ? reviewParse.findings.map((finding) => ({
        id: randomUUID(),
        title: finding.title,
        severity: finding.severity,
        verdict: 'proposed',
      }))
      : []
    const reviewAdvisory = reviewParse.ok
      ? {}
      : {
        reviewBlockError: reviewParse.blockError,
        ...(reviewParse.blockErrorLine !== undefined ? { reviewBlockErrorLine: reviewParse.blockErrorLine } : {}),
      }

    const reviewId = randomUUID()
    if (ledgerRevision !== expectedRevision) {
      return errorResponse(409, 'conflict', { currentRevision: ledgerRevision })
    }
    const nextRecord: WorkbenchRecord = {
      ...record,
      reviewReports: [
        ...record.reviewReports,
        { id: reviewId, at: new Date().toISOString(), ...(title !== null ? { title } : {}), contentHash: hash, verdicts: seededVerdicts },
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
      return json({ ok: true, revision: saved.revision, kind: 'review', reviewId, seeded: seededVerdicts.length, ...reviewAdvisory })
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
      const workPackageId = url.searchParams.get('workPackageId')
      const version = Number(url.searchParams.get('version'))
      if (workPackageId === null || !isWorkPackageId(workPackageId) || !isPlanVersion(version)) return errorResponse(400, 'bad-request')
      const workPackage = record.workPackages.find((candidate) => candidate.id === workPackageId)
      if (workPackage === undefined) return errorResponse(404, 'not-found')
      const entry = workPackage.plans.find((plan) => plan.version === version)
      if (entry === undefined) return errorResponse(404, 'not-found')
      target = planDocPath(services.workbenchRoot, requirementId, workPackageId, version)
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

  // -------------------------------------------------------------------------
  // Declare-block import (P3b): GET fetches a session's final declare text
  // (pure read — 200 degrade envelope, never an error status); POST runs the
  // two-stage import (dryRun preview / commit) over the SAME workbench.yaml
  // revision space as the main union — the repos-pool import precedent.
  // -------------------------------------------------------------------------

  connection.fetch.register({
    path: WORKBENCH_DECLARE_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'GET') return blockFetchFlow(request)
      return declareImportFlow(request)
    },
  })

  /**
   * Session-block fetch, query-discriminated by `kind` (the artifacts route's
   * precedent — one reader engine, two markers). `kind=review` (P5b) returns
   * the whole assistant message carrying a `# skyaxis-review` block; the
   * default returns the declare fence body. Both degrade in a 200 envelope.
   */
  async function blockFetchFlow(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId')
    if (sessionId === null || sessionId.length === 0) return errorResponse(400, 'bad-request')
    const kind = url.searchParams.get('kind')
    if (kind === 'review') {
      const result = await services.declareReader.readReviewText(sessionId)
      const body: ReviewFetchResponse = result.status === 'ok'
        ? { ok: true, text: result.text }
        : { ok: true, missing: result.reason }
      return json(body)
    }
    const result = await services.declareReader.readDeclareText(sessionId)
    const body: DeclareFetchResponse = result.status === 'ok'
      ? { ok: true, text: result.text }
      : { ok: true, missing: result.reason }
    return json(body)
  }

  async function declareImportFlow(request: Request): Promise<Response> {
    const parsed = DeclareImportSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) return errorResponse(400, 'bad-request')
    const body = parsed.data
    if (!REQUIREMENT_ID_RE.test(body.requirementId)) return errorResponse(400, 'bad-request')
    if (body.text.length > DECLARE_MAX_CHARS) return errorResponse(413, 'too-large')

    const current = file.load()
    if (!current.ok) return errorResponse(409, 'unreadable-file')
    // dry-run checks the revision too: the preview must be anchored to the
    // same snapshot the follow-up real import would fold onto (repos-pool).
    if (current.value.revision !== body.expectedRevision) {
      return errorResponse(409, 'conflict', { currentRevision: current.value.revision })
    }
    const existing = current.value.records.find((candidate) => candidate.requirementId === body.requirementId)
    const base = existing ?? emptyRecord(body.requirementId)

    const parse = parseDeclare({ text: body.text, record: base })
    if (!parse.ok) {
      const preview: DeclarePreviewResponseOk = {
        ok: true,
        revision: current.value.revision,
        entries: [],
        skipped: [],
        stageReady: false,
        blockError: parse.blockError,
        ...(parse.blockErrorLine !== undefined ? { blockErrorLine: parse.blockErrorLine } : {}),
      }
      return json(preview)
    }

    if (body.dryRun === true) {
      // Preview only — zero writes (byte-identical file asserted in tests).
      const preview: DeclarePreviewResponseOk = {
        ok: true,
        revision: current.value.revision,
        entries: parse.entries,
        skipped: parse.skipped,
        stageReady: parse.stageReady,
      }
      return json(preview)
    }

    // Commit: re-parse verdicts already in hand (same pure function over the
    // same text); fold ONLY the selected keys through the real guards.
    const selected = new Set(body.selected ?? [])
    const skipped: DeclareSkip[] = []
    let record = base
    let builtCount = 0
    let artifactCount = 0
    let knowledgeCount = 0

    for (const entry of parse.entries) {
      if (!selected.has(entry.key)) continue
      if (entry.kind === 'built') {
        // Reuse the REAL lifecycle guard — a race between preview and commit
        // (revoke, re-baseline) lands in skipped, not a whole-batch reject.
        const applied = applyRecordAction(record, {
          expectedRevision: body.expectedRevision,
          requirementId: body.requirementId,
          action: 'markWorkPackageBuilt',
          id: entry.workPackageId,
        })
        if (applied.ok) {
          record = applied.record
          builtCount++
        } else {
          skipped.push({ key: entry.key, label: entry.workPackageId, reason: applied.status === 404 ? 'wp-not-found' : 'wp-not-in-dev' })
        }
        continue
      }
      if (entry.kind === 'artifact') {
        record = {
          ...record,
          releaseItems: [
            ...record.releaseItems,
            {
              id: nextReleaseItemId(record.releaseItems.map((item) => item.id)),
              type: entry.type,
              title: entry.title,
              content: entry.content,
              contentHash: contentHashOf(entry.content),
              envs: [...entry.envs],
              ...(entry.workPackageId !== undefined ? { workPackageId: entry.workPackageId } : {}),
              ...(body.sessionId !== undefined ? { sessionId: body.sessionId } : {}),
              status: 'pending' as const,
            },
          ],
        }
        artifactCount++
        continue
      }
      record = {
        ...record,
        knowledgeCandidates: [
          ...record.knowledgeCandidates,
          {
            id: randomUUID(),
            title: entry.title,
            draft: entry.draft,
            type: entry.type,
            ...(body.sessionId !== undefined ? { proposedSessionId: body.sessionId } : {}),
            at: new Date().toISOString(),
            status: 'pending' as const,
          },
        ],
      }
      knowledgeCount++
    }

    const applied = builtCount + artifactCount + knowledgeCount
    // The done report carries the COMPLETE outcome: parse-time skips (rows
    // that never were importable) alongside commit-time guard rejections.
    const reportSkipped: readonly DeclareSkip[] = [...parse.skipped, ...skipped]
    if (applied === 0) {
      // Zero real change (nothing selected / all guard-rejected): skip the
      // write entirely — no revision bump, no .bak churn (repos-pool).
      return json({ ok: true, revision: current.value.revision, record, report: { built: 0, artifacts: 0, knowledge: 0, skipped: reportSkipped } })
    }

    const nextRecords = existing === undefined
      ? [...current.value.records, record]
      : current.value.records.map((candidate) => (candidate.requirementId === body.requirementId ? record : candidate))
    try {
      const saved = await file.save(body.expectedRevision, nextRecords)
      if (!saved.ok) {
        if (saved.rejected === 'stale-revision') {
          return errorResponse(409, 'conflict', { currentRevision: saved.currentRevision })
        }
        return errorResponse(409, 'unreadable-file')
      }
      const responseBody: DeclareCommitResponseOk = {
        ok: true,
        revision: saved.revision,
        record,
        report: { built: builtCount, artifacts: artifactCount, knowledge: knowledgeCount, skipped: reportSkipped },
      }
      return json(responseBody)
    } catch (error) {
      log?.(error)
      return errorResponse(500, 'internal')
    }
  }
}

/** The records array with `next` replacing the requirement's row. */
function withRecord(records: readonly WorkbenchRecord[], requirementId: string, next: WorkbenchRecord): readonly WorkbenchRecord[] {
  return records.map((candidate) => (candidate.requirementId === requirementId ? next : candidate))
}

/**
 * knowledge.yaml idempotent upsert by row id (the dual-ledger promote's tail
 * write): replace-or-append under a FRESH load's revision (the tail never
 * trusts the client's expectedRevision — that key belongs to workbench.yaml).
 */
async function upsertKnowledgeRow(
  knowledgeFile: KnowledgeFileStore,
  row: KnowledgeRecord,
  log?: (error: unknown) => void,
): Promise<boolean> {
  try {
    const current = knowledgeFile.load()
    if (!current.ok) {
      log?.(new Error('knowledge tail write skipped: degraded ledger'))
      return false
    }
    // Row-equivalence short-circuit: a byte-identical retry (the unchanged
    // branch re-mints provenance.at each call, so compare the IDENTITY-
    // meaningful fields) must not bump the knowledge revision either — the
    // idempotent-convergence contract covers BOTH ledgers.
    const existing = current.value.records.find((candidate) => candidate.id === row.id)
    if (existing !== undefined && knowledgeRowEquivalent(existing, row)) return true
    const nextRecords = existing !== undefined
      ? current.value.records.map((candidate) => (candidate.id === row.id ? row : candidate))
      : [...current.value.records, row]
    const saved = await knowledgeFile.save(current.value.revision, nextRecords)
    if (!saved.ok) {
      log?.(new Error(`knowledge tail write rejected: ${saved.rejected}`))
      return false
    }
    return true
  } catch (error) {
    log?.(error)
    return false
  }
}

/**
 * Identity-field equivalence for the activate upsert short-circuit: the
 * re-minted provenance.at (and provenance.sessionId when the candidate
 * gained one) is intentionally excluded — a retry refreshing the timestamp
 * alone is NOT a data change and must not write.
 */
function knowledgeRowEquivalent(a: KnowledgeRecord, b: KnowledgeRecord): boolean {
  return a.id === b.id
    && a.scope === b.scope
    && a.type === b.type
    && a.title === b.title
    && a.content === b.content
    && a.path === b.path
    && a.requirementId === b.requirementId
    && a.trigger.mode === b.trigger.mode
    && a.trigger.value === b.trigger.value
    && a.status === b.status
}
