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
  WORKBENCH_SESSION_DIGEST_PATH,
  SESSION_DIGEST_MAX_BYTES,
  SESSION_DIGEST_MAX_EVENTS,
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
  SessionDigestResponse,
  SessionDigestResponseOk,
  WorkbenchDetailResponseOk,
  WorkbenchListResponse,
  WorkbenchRecord,
} from '../workbench-shared/protocol.js'
import { planDocPath, workspacePlanPath, reviewDocPath, workspaceReviewPath, analysisReportPath, requirementDocPath, planningDocPath, splitResultPath, devDeclarePendingPath, devDeclareImportedPath, wpPlanPath } from './artifact-path.js'
import { ArtifactStore, contentHashOf } from './artifact-store.js'
import { scanWorkbenchArtifacts } from './orphan-scan.js'
import { applyRecordAction, applyAnalysisSeed, applySplitSeed, approveUnderstandWith, adoptPlanWith, nextReleaseItemId, applyDevDeclareSeed, stampDevDeclareImported, applyWpPlanSeed } from './record-actions.js'
import { parseDeclare, findDeclareFence } from './declare-parse.js'
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
  /**
   * 文件交付轮: bound-workspace resolver over requirements.yaml (the
   * prd-endpoint.ts:59-65 tolerant read-side join — the 0002 boundary's
   * read-path join, never a foreign key). '' = unbound / record absent.
   * Structurally optional: absent ⇒ the report-file channel degrades
   * honestly to the session chain (the declareReader no-service precedent).
   */
  readonly resolveWorkspacePath?: (requirementId: string) => string
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

/** 0016: block-level workPackage scope line inside a declare fence body (`workPackage: WP3`). */
const DEV_DECLARE_SCOPE_RE = /^workPackage:\s*(\S+)\s*$/m

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
        workPackage.plans.map((plan) => {
          // 0029 一并改道: dual-path existence — the body lives in EITHER channel.
          const locations = planBodyLocations(requirementId, workPackage.id, plan.version)
          return {
            workPackageId: workPackage.id,
            version: plan.version,
            exists: existsSync(locations.workspace ?? locations.legacy) || existsSync(locations.legacy),
          }
        }),
      ),
      reviewFileExists: record.reviewReports.map((report) => {
        // 0028 D2-A: dual-path existence — the body lives in EITHER channel.
        const locations = reviewBodyLocations(requirementId, report.id)
        return {
          reviewId: report.id,
          exists: existsSync(locations.workspace ?? locations.legacy) || existsSync(locations.legacy),
        }
      }),
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

    // approveUnderstand (0008 D4) is the SECOND dedicated flow: its docHash
    // anchor is IO-derived (the requirement-baseline doc's disk sha256) and
    // never rides the wire. Unlike seedAnalysis it KEEPS the implicit-create
    // semantics (an all-zero finalize is the ratified skip path) — the flow
    // applies it itself and passes `existing` on for the commit tail's append
    // arm.
    if (body.action === 'approveUnderstand') return approveUnderstandFlow(body, existing, current.value)

    // 0012 两步化轮: adoptPlan is the THIRD dedicated flow (its docHash anchor
    // is IO-derived from the planning doc, approveUnderstand's shape — it
    // keeps the implicit-create arm the same way); seedSplit is the FOURTH
    // (the split result file is the ONLY channel — no session-log fallback,
    // the analysis fallback exists for pre-file deliveries split never had;
    // no implicit-create — seeding requires a prior bindSplitSession).
    if (body.action === 'adoptPlan') return adoptPlanFlow(body, existing, current.value)
    if (body.action === 'seedSplit') return seedSplitFlow(body, existing, current.value)

    // 0016 P1a: seedDevDeclare is the FIFTH dedicated flow (the IO chain is
    // dev-specific: latest dev binding → readSession → fence scope check →
    // hash; no implicit-create — seeding presupposes a bound in-dev WP).
    if (body.action === 'seedDevDeclare') return seedDevDeclareFlow(body, existing, current.value)

    // 0018 工作包规划两步化: seedWpPlan is the SIXTH dedicated flow (the
    // wp-plan file channel's collector — the endpoint reads the prescribed
    // workspace file itself, seedSplit's per-WP shape; no implicit-create —
    // seeding presupposes a registered package).
    if (body.action === 'seedWpPlan') return seedWpPlanFlow(body, existing, current.value)

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
   * seedAnalysis (回传轮 + 文件交付轮): collect the bound analysis report and
   * replace the pending batch (idempotency = sessionId + contentHash anchor
   * inside applyAnalysisSeed). SOURCE LADDER: the workspace report file is
   * PRIMARY when the requirement has a bound workspace and the resolver is
   * present — the prescribed path is content-addressed and immune to the
   * shell-session addressing that plagued conversation extraction (五次诊断);
   * the file's whole text is hashed (any report evolution re-seeds). Every
   * file miss falls back to the session chain (legacy deliveries and
   * no-workspace requirements); when BOTH channels miss and the file channel
   * was armed, the disclosed reason is the FILE one (the actionable headline:
   * the task book prescribed a file that never landed), with the session
   * scan fingerprint still attached when present. Every NON-committing
   * outcome answers 200 ZERO-WRITE — {ok, revision, record: existing} with
   * no banner field, no revision bump — so the watcher retries silently:
   *   file missing / over cap / no valid declare fence — advisory, the
   *   session may not have finished or wrote a malformed file;
   *   session missing (no-service / not-found / unreadable / no-block) — the
   *   report may not exist yet; block-level YAML syntax error — advisory,
   *   the user may re-run the session;
   *   anchor hit — unchanged (user-deleted rows never resurrect).
   * Concurrency: the source read is slow IO between load and save — any
   * interleaved write moves the revision, this save hits stale-revision →
   * 409, and the client converges by re-opening. A stale success therefore
   * cannot land out of order. Provenance note: a file-channel seed stamps
   * the BOUND session id (shell repair is a session-chain concern; the
   * proposals' content does not depend on it).
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
    // --- 文件交付轮: primary channel. ---
    const reportFile = readAnalysisReportFile(existing.requirementId)
    if (reportFile.status === 'ok') {
      const parsed = parseDeclare({ text: reportFile.text, record: existing })
      if (!parsed.ok) return json({ ok: true, revision: current.revision, record: existing, seedMissing: 'report-file-syntax' })
      const applied = applyAnalysisSeed(existing, {
        sessionId: body.sessionId,
        contentHash: reportFile.sha256,
        stageReady: parsed.stageReady,
        findings: parsed.proposals.findings,
        criteria: parsed.proposals.criteria,
        clarifications: parsed.proposals.clarifications,
      })
      return commitSeedResponse(body, applied, current)
    }
    if (reportFile.status === 'too-large') {
      return json({ ok: true, revision: current.revision, record: existing, seedMissing: 'report-file-too-large' })
    }
    // --- Session chain: fallback (and the only channel when unarmed). ---
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
        // 文件交付轮 headline swap: with the file channel armed the file miss
        // is the actionable reason (the session scan still rides along).
        seedMissing: reportFile.status === 'missing' ? 'report-file-missing' : read.reason,
        ...(read.scan !== undefined ? { seedScan: read.scan } : {}),
        ...(read.shell === true ? { seedShell: true } : {}),
      })
    }
    const parsed = parseDeclare({ text: read.text, record: base })
    if (!parsed.ok) return json({ ok: true, revision: current.revision, record: existing, seedMissing: 'yaml-syntax' })
    const applied = applyAnalysisSeed(base, {
      sessionId,
      contentHash: contentHashOf(read.text),
      stageReady: parsed.stageReady,
      findings: parsed.proposals.findings,
      criteria: parsed.proposals.criteria,
      clarifications: parsed.proposals.clarifications,
    })
    return commitSeedResponse(body, applied, current)
  }

  /**
   * 文件交付轮: the workspace report file read — 'unarmed' means the channel
   * is OFF (no resolver service / no bound workspace / requirement record
   * absent), which is NOT a miss: the session chain is then simply the only
   * channel. The disk sha256 (not contentHashOf(text)) anchors idempotency —
   * the on-disk evidence hash, the artifact-store coordinate system.
   */
  function readAnalysisReportFile(requirementId: string): { status: 'ok'; text: string; sha256: string } | { status: 'missing' | 'too-large' | 'unarmed' } {
    const resolve = services.resolveWorkspacePath
    if (resolve === undefined) return { status: 'unarmed' }
    const workspace = resolve(requirementId)
    if (workspace === '') return { status: 'unarmed' }
    const read = artifacts.read(analysisReportPath(workspace, requirementId))
    if (read.status === 'ok') return { status: 'ok', text: read.text, sha256: read.sha256 }
    return { status: read.status }
  }

  /**
   * 0008 D4: approveUnderstand dedicated flow — read the requirement-baseline
   * doc off disk and hand the pure core its sha256. unarmed / missing ⇒ NO
   * anchor but the finalize STILL STANDS (软门：无文档可定稿——the ack modal
   * discloses it, the user has ruled); too-large ⇒ 413 (the doc is there but
   * unreadable — anchoring nothing would mis-certify "no doc", the
   * file-is-bad-don't-fallback precedent of 文件交付轮).
   */
  async function approveUnderstandFlow(
    body: { expectedRevision: number; requirementId: string },
    existing: WorkbenchRecord | undefined,
    current: { revision: number; records: readonly WorkbenchRecord[] },
  ): Promise<Response> {
    const base = existing ?? emptyRecord(body.requirementId) // implicit-create semantics preserved
    const doc = readRequirementDocFile(body.requirementId)
    if (doc.status === 'too-large') return errorResponse(413, 'too-large')
    const applied = approveUnderstandWith(base, doc.status === 'ok' ? doc.sha256 : undefined)
    return commitSeedResponse(body, applied, current, existing)
  }

  /** 0008: the requirement-baseline doc read (the analysis-report channel family). */
  function readRequirementDocFile(requirementId: string): { status: 'ok'; text: string; sha256: string } | { status: 'missing' | 'too-large' | 'unarmed' } {
    const resolve = services.resolveWorkspacePath
    if (resolve === undefined) return { status: 'unarmed' }
    const workspace = resolve(requirementId)
    if (workspace === '') return { status: 'unarmed' }
    const read = artifacts.read(requirementDocPath(workspace, requirementId))
    if (read.status === 'ok') return { status: 'ok', text: read.text, sha256: read.sha256 }
    return { status: read.status }
  }

  /** 0012: the planning-doc read (third member of the channel family). */
  function readPlanningDocFile(requirementId: string): { status: 'ok'; text: string; sha256: string } | { status: 'missing' | 'too-large' | 'unarmed' } {
    const resolve = services.resolveWorkspacePath
    if (resolve === undefined) return { status: 'unarmed' }
    const workspace = resolve(requirementId)
    if (workspace === '') return { status: 'unarmed' }
    const read = artifacts.read(planningDocPath(workspace, requirementId))
    if (read.status === 'ok') return { status: 'ok', text: read.text, sha256: read.sha256 }
    return { status: read.status }
  }

  /** 0012: the split result file read (fourth member of the channel family). */
  function readSplitResultFile(requirementId: string): { status: 'ok'; text: string; sha256: string } | { status: 'missing' | 'too-large' | 'unarmed' } {
    const resolve = services.resolveWorkspacePath
    if (resolve === undefined) return { status: 'unarmed' }
    const workspace = resolve(requirementId)
    if (workspace === '') return { status: 'unarmed' }
    const read = artifacts.read(splitResultPath(workspace, requirementId))
    if (read.status === 'ok') return { status: 'ok', text: read.text, sha256: read.sha256 }
    return { status: read.status }
  }

  /** 0018: the per-WP plan file read (fifth member of the channel family). */
  function readWpPlanFile(requirementId: string, workPackageId: string): { status: 'ok'; text: string; sha256: string } | { status: 'missing' | 'too-large' | 'unarmed' } {
    const resolve = services.resolveWorkspacePath
    if (resolve === undefined) return { status: 'unarmed' }
    const workspace = resolve(requirementId)
    if (workspace === '') return { status: 'unarmed' }
    const read = artifacts.read(wpPlanPath(workspace, workPackageId))
    if (read.status === 'ok') return { status: 'ok', text: read.text, sha256: read.sha256 }
    return { status: read.status }
  }

  /**
   * 0012: adoptPlan dedicated flow — approveUnderstandFlow's twin verbatim:
   * read the planning doc off disk and hand the pure core its sha256.
   * unarmed / missing ⇒ NO anchor but the adoption STILL STANDS (软门：无文档
   * 可采纳——the ack modal discloses it, the user has ruled); too-large ⇒ 413
   * (the doc is there but unreadable — anchoring nothing would mis-certify
   * "no doc", the file-is-bad-don't-fallback precedent).
   */
  async function adoptPlanFlow(
    body: { expectedRevision: number; requirementId: string },
    existing: WorkbenchRecord | undefined,
    current: { revision: number; records: readonly WorkbenchRecord[] },
  ): Promise<Response> {
    const base = existing ?? emptyRecord(body.requirementId) // implicit-create semantics preserved (an all-zero adoption is a legal first action)
    const doc = readPlanningDocFile(body.requirementId)
    if (doc.status === 'too-large') return errorResponse(413, 'too-large')
    const applied = adoptPlanWith(base, doc.status === 'ok' ? doc.sha256 : undefined)
    return commitSeedResponse(body, applied, current, existing)
  }

  /**
   * 0012: seedSplit dedicated flow — the split result FILE is the only
   * channel (the session log is never scanned: the analysis fallback exists
   * for pre-file-channel deliveries, which split never had). Misses answer
   * 200 zero-write with the actionable reason (the waiting row discloses it
   * — the seedAnalysis observability discipline); a declare miss or a
   * syntax break likewise (the retry path stays open).
   */
  async function seedSplitFlow(
    body: { expectedRevision: number; requirementId: string; action: 'seedSplit'; sessionId: string },
    existing: WorkbenchRecord | undefined,
    current: { revision: number; records: readonly WorkbenchRecord[] },
  ): Promise<Response> {
    if (existing === undefined
      || existing.splitProposals === undefined
      || existing.splitProposals.session.sessionId !== body.sessionId) {
      return errorResponse(404, 'not-found')
    }
    const resultFile = readSplitResultFile(existing.requirementId)
    if (resultFile.status !== 'ok') {
      return json({
        ok: true,
        revision: current.revision,
        record: existing,
        seedMissing: resultFile.status === 'missing' ? 'split-file-missing' : 'split-file-too-large',
      })
    }
    const parsed = parseDeclare({ text: resultFile.text, record: existing })
    if (!parsed.ok) return json({ ok: true, revision: current.revision, record: existing, seedMissing: 'split-file-syntax' })
    const applied = applySplitSeed(existing, {
      sessionId: body.sessionId,
      contentHash: resultFile.sha256,
      workPackages: parsed.proposals.workPackages,
    })
    return commitSeedResponse(body, applied, current)
  }

  /**
   * 0018: seedWpPlan dedicated flow — the WP-plan file channel's collector
   * (seedSplit's per-WP twin). The endpoint reads the prescribed file itself
   * (no session-log anything); misses answer 200 zero-write with the
   * actionable reason (missing covers unarmed — no workspace means no file
   * can exist; too-large stays advisory, the session may slim it). The pure
   * core (applyWpPlanSeed) owns the plans[] append + planned→plan-draft flip
   * + the planSeed hash stamp, all in ONE save.
   *
   * 缺陷修复（刀一实机验收漏面）：the seed ALSO copies the workspace file's
   * TEXT into the workbench artifact store (plans/<wpId>-v<version>.md) —
   * planWriteFlow's post-commit tail discipline, without which every seeded
   * version shows「计划文件缺失」(planFileExists probes the ARTIFACT store,
   * [endpoint.ts detail flow]; the ledger reference without the stored body
   * is a structural dangling). Not commitSeedResponse — that helper has no
   * file tail; this flow owns both arms:
   *   committed arm: save → artifacts.write(version from the result's tail
   *     entry) → 200; a write failure answers 500 (dangling visible via
   *     fileExists/scan, the retry converges below);
   *   unchanged arm: CONVERGES the artifact copy (missing or stale bytes ⇒
   *     rewritten; revision never bumps) — the planWriteFlow byte-identical
   *     convergence + ensureDeclareSnapshot discipline, and the repair path
   *     for存量 seeds that landed before this fix.
   */
  async function seedWpPlanFlow(
    body: { expectedRevision: number; requirementId: string; action: 'seedWpPlan'; workPackageId: string },
    existing: WorkbenchRecord | undefined,
    current: { revision: number; records: readonly WorkbenchRecord[] },
  ): Promise<Response> {
    if (existing === undefined) return errorResponse(404, 'not-found')
    // Pre-check the target (seedSplit's container pre-check shape): a missing
    // WP answers 404 before any disk IO; dropped stays in the pure core (the
    // file-present arm surfaces the 400 there — a fileless dropped WP is a
    // harmless zero-write miss).
    if (!existing.workPackages.some((candidate) => candidate.id === body.workPackageId)) return errorResponse(404, 'not-found')
    const planFile = readWpPlanFile(existing.requirementId, body.workPackageId)
    if (planFile.status !== 'ok') {
      return json({
        ok: true,
        revision: current.revision,
        record: existing,
        seedMissing: planFile.status === 'too-large' ? 'wp-plan-file-too-large' : 'wp-plan-file-missing',
      })
    }
    const applied = applyWpPlanSeed(existing, {
      workPackageId: body.workPackageId,
      contentHash: planFile.sha256,
    })
    if (!applied.ok) return errorResponse(applied.status, applied.code)
    // The version the artifact copy lands under: the result's TAIL plan entry
    // (the appended version on a commit; the already-seeded tail on the
    // unchanged replay — both shapes read the same way).
    const tailVersion = applied.record.workPackages.find((candidate) => candidate.id === body.workPackageId)?.plans.at(-1)?.version
    if (tailVersion === undefined) return errorResponse(500, 'internal')
    const artifactTarget = planDocPath(services.workbenchRoot, body.requirementId, body.workPackageId, tailVersion)
    if (applied.unchanged === true) {
      // Hash-identical replay: converge the artifact copy in passing (a
      // missing or stale store file is repaired; an intact one untouched),
      // never bumping the revision.
      const read = artifacts.read(artifactTarget)
      if (read.status !== 'ok' || read.sha256 !== planFile.sha256) {
        try {
          artifacts.write(artifactTarget, planFile.text)
        } catch (error) {
          log?.(error)
          return errorResponse(500, 'internal')
        }
      }
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
      // Ledger committed; the artifact copy is the only post-commit step
      // (planWriteFlow's tail discipline — a failure leaves the dangling
      // reference the retry converges above).
      try {
        artifacts.write(artifactTarget, planFile.text)
      } catch (error) {
        log?.(error)
        return errorResponse(500, 'internal')
      }
      return json({ ok: true, revision: saved.revision, record: applied.record })
    } catch (error) {
      log?.(error)
      return errorResponse(500, 'internal')
    }
  }

  /**
   * 0016 P1a + 刀一验收二修: seedDevDeclare dedicated flow — the dev-declare
   * twin of the seed family, with CONTENT-ADDRESSED binding repair. The
   * chain: the WP's LATEST dev binding (may be none, or a delivery SHELL —
   * DSH materializes the real conversation under a fresh id, and the LLM
   * later retitles it away from any marker, so TITLES are not a durable
   * address) → when the binding is absent or its log is a shell, the host
   * content-addresses the REAL session via searchSessions over the SOW head
   * (`# (skyaxis )?工作包任务书 WP<n>` — the first user message always carries
   * it verbatim, immune to retitling; 0021 去品牌后新锚为主、legacy 锚兜底)
   * and APPENDS the binding (bindSession
   * real guards; association is valid for any non-dropped WP — the user
   * generates dev SOWs before pressing 开始开发, and the strip owes them the
   * live state) → the in-dev gate → fence scope check → hash → seed. Every
   * non-committing outcome answers 200 ZERO-WRITE with devSeedMissing; a
   * two-dimensional anchor hit (session AND hash) is an unchanged 200
   * WITHOUT a miss field — and also repairs a missing/stale pending
   * snapshot (the planWriteFlow convergence branch). The pending snapshot
   * write is a POST-COMMIT best-effort tail: workspace-unarmed degrades to
   * hash-only anchoring (the session log stays the text source, the paste
   * channel stays alive).
   */
  async function seedDevDeclareFlow(
    body: { expectedRevision: number; requirementId: string; action: 'seedDevDeclare'; workPackageId: string },
    existing: WorkbenchRecord | undefined,
    current: { revision: number; records: readonly WorkbenchRecord[] },
  ): Promise<Response> {
    if (existing === undefined) return errorResponse(404, 'not-found')
    let workPackage = existing.workPackages.find((candidate) => candidate.id === body.workPackageId)
    if (workPackage === undefined) return errorResponse(404, 'not-found')
    if (workPackage.status === 'dropped') {
      return json({ ok: true, revision: current.revision, record: existing, devSeedMissing: 'wp-not-in-dev' })
    }
    // The revision the flow may WRITE under — the repair-bind's save bumps
    // it, and the seed save below must ride the FRESH value (the request's
    // expectedRevision is one behind after any landed bind).
    let writeRevision = body.expectedRevision
    // --- resolve the READ TARGET: latest dev binding, shell-repaired or
    // content-addressed from scratch (the repair-bind lands even for WPs
    // outside in-dev — the association is valid wherever the WP is).
    let record = existing
    let targetSession: string | undefined
    const binding = [...workPackage.sessions].reverse().find((row) => row.purpose === 'dev')
    if (binding !== undefined) {
      const read = await services.declareReader.readDeclareText(binding.sessionId)
      if (read.status === 'ok') {
        targetSession = binding.sessionId
      } else if (!(read.status === 'missing' && read.reason === 'no-declare-block' && read.shell === true)) {
        return json({ ok: true, revision: current.revision, record: existing, devSeedMissing: read.reason })
      } // else: the bound log is a delivery shell → fall through to repair
    }
    if (targetSession === undefined) {
      // 0021 渲染轮: 标题去品牌——先按新锚寻址，总 miss 才用 legacy 锚兜底
      // （在途旧标题会话，0018 存量修复先例；两锚皆 miss 即如实披露）。
      const repaired = await services.declareReader.findTaskbookSession(`# 工作包任务书 ${body.workPackageId}`, binding?.sessionId ?? '')
        ?? await services.declareReader.findTaskbookSession(`# skyaxis 工作包任务书 ${body.workPackageId}`, binding?.sessionId ?? '')
      if (repaired === undefined) {
        return json({ ok: true, revision: current.revision, record: existing, devSeedMissing: 'no-binding' })
      }
      const bound = applyRecordAction(record, {
        expectedRevision: writeRevision,
        requirementId: body.requirementId,
        action: 'bindSession',
        id: body.workPackageId,
        sessionId: repaired,
        purpose: 'dev',
      })
      if (!bound.ok) return errorResponse(bound.status, bound.code)
      if (bound.unchanged !== true) {
        const savedBind = await file.save(writeRevision, withRecord(current.records, body.requirementId, bound.record))
        if (!savedBind.ok) {
          if (savedBind.rejected === 'stale-revision') {
            return errorResponse(409, 'conflict', { currentRevision: savedBind.currentRevision })
          }
          return errorResponse(409, 'unreadable-file')
        }
        writeRevision = savedBind.revision
        record = bound.record
        workPackage = record.workPackages.find((candidate) => candidate.id === body.workPackageId)!
      }
      targetSession = repaired
    }
    // 刀一验收三修: the in-dev gate is REMOVED from the seed — collection is
    // information-gathering, valid wherever the WP lives (the user delivers
    // dev SOWs before pressing 开始开发). The IMPORT path's markWorkPackageBuilt
    // still enforces in-dev (the four-power state change). The card surfaces
    // the collected declaration; the import button disables when not in-dev.
    const read = await services.declareReader.readDeclareText(targetSession)
    if (read.status !== 'ok') {
      return json({ ok: true, revision: writeRevision, record, devSeedMissing: read.reason })
    }
    const scope = DEV_DECLARE_SCOPE_RE.exec(read.text)?.[1]
    if (scope !== body.workPackageId) {
      return json({ ok: true, revision: writeRevision, record, devSeedMissing: 'wp-mismatch' })
    }
    const hash = contentHashOf(read.text)
    // 0016 P2b: parse the fence for commit proposals — a light second parse
    // (the main parseDeclare call happens in the import flow, not here).
    const declareParsed = parseDeclare({ text: read.text, record })
    const seedCommits = declareParsed.ok ? declareParsed.declareCommits : undefined
    const applied = applyDevDeclareSeed(record, {
      workPackageId: body.workPackageId,
      sessionId: targetSession,
      contentHash: hash,
      ...(seedCommits !== undefined ? { commits: seedCommits } : {}),
    })
    if (!applied.ok) return errorResponse(applied.status, applied.code)
    if (applied.unchanged === true) {
      ensureDeclareSnapshot(existing.requirementId, body.workPackageId, 'pending', read.text, hash)
      return json({ ok: true, revision: writeRevision, record: applied.record })
    }
    const nextRecords = current.records.map((candidate) => (candidate.requirementId === body.requirementId ? applied.record : candidate))
    try {
      const saved = await file.save(writeRevision, nextRecords)
      if (!saved.ok) {
        if (saved.rejected === 'stale-revision') {
          return errorResponse(409, 'conflict', { currentRevision: saved.currentRevision })
        }
        return errorResponse(409, 'unreadable-file')
      }
      ensureDeclareSnapshot(existing.requirementId, body.workPackageId, 'pending', read.text, hash)
      return json({ ok: true, revision: saved.revision, record: applied.record })
    } catch (error) {
      log?.(error)
      return errorResponse(500, 'internal')
    }
  }

  /**
   * Declare-snapshot tail write (0016, best-effort by contract): `pending`
   * CONVERGES (a missing/stale file is repaired — the planWriteFlow
   * byte-identical branch), `imported` is a plain post-commit copy whose
   * failure answers 500 upstream (the ledger is already authoritative; the
   * receipt file is a distribution artifact). Workspace-unarmed ⇒ silent
   * no-op (the honest degrade, never an error).
   */
  function ensureDeclareSnapshot(
    requirementId: string,
    workPackageId: string,
    kind: 'pending' | { readonly importedSeq: number },
    text: string,
    hash: string,
  ): void {
    const resolve = services.resolveWorkspacePath
    if (resolve === undefined) return
    const workspace = resolve(requirementId)
    if (workspace === '') return
    const target = kind === 'pending'
      ? devDeclarePendingPath(workspace, requirementId, workPackageId)
      : devDeclareImportedPath(workspace, requirementId, workPackageId, kind.importedSeq)
    const read = artifacts.read(target)
    if (read.status === 'ok' && read.sha256 === hash) return
    try {
      artifacts.write(target, text)
    } catch (error) {
      log?.(error)
    }
  }

  /**
   * Shared commit tail: unchanged no-op, save, and the mapped error responses.
   * 0008: `existing` opts into the APPEND (implicit-create) arm — seedAnalysis
   * never passes it (its flow 404s without a record, so replace-only held);
   * approveUnderstand's implicit-create finalize needs the append (the
   * mutateFlow `existing === undefined ? [...records, next] : map(...)` shape).
   */
  async function commitSeedResponse(
    body: { expectedRevision: number; requirementId: string },
    applied: ReturnType<typeof applyAnalysisSeed>,
    current: { revision: number; records: readonly WorkbenchRecord[] },
    existing?: WorkbenchRecord,
  ): Promise<Response> {
    if (!applied.ok) return errorResponse(applied.status, applied.code)
    if (applied.unchanged === true) {
      return json({ ok: true, revision: current.revision, record: applied.record })
    }
    const nextRecords = existing === undefined && !current.records.some((candidate) => candidate.requirementId === body.requirementId)
      ? [...current.records, applied.record]
      : current.records.map((candidate) => (candidate.requirementId === body.requirementId ? applied.record : candidate))
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
   * 0028 D1-A (decisions/0028): review-body channel locations. `workspace`
   * is the bound-workspace channel when armed (absent when unbound / no
   * resolver); `legacy` is the plugin store. Writes target the CURRENT
   * channel; reads and convergence check BOTH — workspace first, legacy
   * fallback (D2-A dual-path: pre-0028 bodies stay readable in place, and a
   * convergence under an armed workspace migrates them across lazily).
   */
  function reviewBodyLocations(requirementId: string, reviewId: string): { workspace?: string; legacy: string } {
    const resolve = services.resolveWorkspacePath
    const workspaceRoot = resolve !== undefined ? resolve(requirementId) : ''
    return {
      ...(workspaceRoot !== '' ? { workspace: workspaceReviewPath(workspaceRoot, requirementId, reviewId) } : {}),
      legacy: reviewDocPath(services.workbenchRoot, requirementId, reviewId),
    }
  }

  /**
   * 0029 一并改道 (decisions/0029): plan-version channel locations — the
   * 0028 review rule verbatim (current-channel writes, dual-channel reads,
   * lazy migration on convergence). ONE extra hazard, handled at the read
   * face: plan DRAFTS are legitimately rewritten, so a channel transition
   * (armed write, then edited while unbound — or vice versa) can leave a
   * STALE copy in the other channel; plan reads therefore prefer the copy
   * whose sha256 matches the ledger contentHash (never first-found).
   */
  function planBodyLocations(requirementId: string, workPackageId: string, version: number): { workspace?: string; legacy: string } {
    const resolve = services.resolveWorkspacePath
    const workspaceRoot = resolve !== undefined ? resolve(requirementId) : ''
    return {
      ...(workspaceRoot !== '' ? { workspace: workspacePlanPath(workspaceRoot, requirementId, workPackageId, version) } : {}),
      legacy: planDocPath(services.workbenchRoot, requirementId, workPackageId, version),
    }
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
      // 0029 一并改道: channel-aware — armed ⇒ the workspace copy is the
      // canonical home (repaired AND lazily migrated from a legacy-only
      // body); unarmed ⇒ the legacy path stays the only home. The legacy
      // copy is never deleted (a legit duplicate, scan-clean).
      const locations = planBodyLocations(requirementId, workPackageId, draft.version)
      const target = locations.workspace ?? locations.legacy
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
      // 0029: the CURRENT channel — workspace when armed, legacy otherwise.
      try {
        artifacts.write(planBodyLocations(requirementId, workPackageId, version).workspace
          ?? planDocPath(services.workbenchRoot, requirementId, workPackageId, version), text)
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
      // 0028 D2-A: channel-aware convergence. Armed ⇒ the workspace copy is
      // the canonical home — a missing/stale copy is repaired here, and a
      // legacy-only body (pre-0028, or written while unbound) gets its
      // workspace copy on the first convergence (the lazy migration; the
      // legacy copy is never deleted — a legit duplicate, scan-clean).
      // Unarmed ⇒ the legacy path stays the only home (a reverse copy keeps
      // unarmed reads self-contained when a workspace went away later).
      const locations = reviewBodyLocations(requirementId, existing.id)
      const hashOk = (path: string): boolean => {
        const read = artifacts.read(path)
        return read.status === 'ok' && read.sha256 === hash
      }
      const target = locations.workspace ?? locations.legacy
      if (!hashOk(target)) {
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
    // 0023 D2-A: the block's criteriaChecks rows seed the report's
    // INFORMATIONAL conformance list — filtered here (not in parse, which is
    // ledger-blind) to refs the ledger's criteria actually carry: an unknown
    // ref would render as an unanchored row in the checks face. D4-A: each
    // seeded verdict carries the finding's detail (说明与证据) verbatim.
    const reviewParse = parseReviewFindings(text)
    const seededVerdicts: ReviewVerdict[] = reviewParse.ok
      ? reviewParse.findings.map((finding) => ({
        id: randomUUID(),
        title: finding.title,
        severity: finding.severity,
        verdict: 'proposed',
        ...(finding.detail !== undefined ? { detail: finding.detail } : {}),
      }))
      : []
    const knownCriteriaRefs = new Set(record.criteria.map((criterion) => criterion.id))
    const seededChecks = reviewParse.ok
      ? reviewParse.checks.filter((check) => knownCriteriaRefs.has(check.ref))
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
        {
          id: reviewId,
          at: new Date().toISOString(),
          ...(title !== null ? { title } : {}),
          contentHash: hash,
          verdicts: seededVerdicts,
          ...(seededChecks.length > 0 ? { criteriaChecks: seededChecks } : {}),
        },
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
        // 0028 D1-A: the CURRENT channel — workspace when armed, legacy otherwise.
        artifacts.write(reviewBodyLocations(requirementId, reviewId).workspace
          ?? reviewDocPath(services.workbenchRoot, requirementId, reviewId), text)
      } catch (error) {
        log?.(error)
        return errorResponse(500, 'internal')
      }
      return json({ ok: true, revision: saved.revision, kind: 'review', reviewId, seeded: seededVerdicts.length, seededChecks: seededChecks.length, ...reviewAdvisory })
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
    if (kind !== 'plan' && kind !== 'review' && kind !== 'analysis-report' && kind !== 'requirement-doc' && kind !== 'planning-doc' && kind !== 'split-result' && kind !== 'wp-plan-doc') return errorResponse(400, 'bad-request')

    // 文件交付轮 face: the workspace report file — readable even before a
    // seed lands (the file is the session's delivery; the ledger joins in
    // only for tamper detection). Unarmed channel / absent file ⇒ 404 (the
    // honest missing state; the S1 panel renders it, never a placeholder).
    if (kind === 'analysis-report') {
      const reportFile = readAnalysisReportFile(requirementId)
      if (reportFile.status !== 'ok') return errorResponse(404, 'not-found')
      const current = file.load()
      if (!current.ok) return errorResponse(409, 'unreadable-file')
      const record = current.value.records.find((candidate) => candidate.requirementId === requirementId)
      // 细化④ discipline: a present seed hash that disagrees answers 200 +
      // contentTampered — never silently, never blocking. The seed hash is
      // the disk-bytes sha256 (see readAnalysisReportFile), so like hashes
      // like. An unseeded record reads untampered-silent (field-evolution
      // leniency — the panel is the report, not a ledger projection).
      const expectedHash = record?.analysis?.seed?.contentHash
      const contentTampered = expectedHash !== undefined && expectedHash !== reportFile.sha256
      return json({ ok: true, content: reportFile.text, contentTampered })
    }

    // 0008 face: the requirement-baseline doc — same shape as the analysis
    // report (file first, readable before any finalize anchors it; the
    // ledger joins only for tamper compare against understandBaseline.docHash).
    if (kind === 'requirement-doc') {
      const doc = readRequirementDocFile(requirementId)
      if (doc.status !== 'ok') return errorResponse(404, 'not-found')
      const current = file.load()
      if (!current.ok) return errorResponse(409, 'unreadable-file')
      const record = current.value.records.find((candidate) => candidate.requirementId === requirementId)
      // An unfinalized record has no anchor yet — untampered-silent (the doc
      // is the deliverable; the anchor only exists once finalized).
      const expectedHash = record?.understandBaseline?.docHash
      const contentTampered = expectedHash !== undefined && expectedHash !== doc.sha256
      return json({ ok: true, content: doc.text, contentTampered })
    }

    // 0012 face: the technical planning doc — same shape (file first, readable
    // before any adoption anchors it; the ledger joins only for tamper compare
    // against planBaseline.docHash).
    if (kind === 'planning-doc') {
      const doc = readPlanningDocFile(requirementId)
      if (doc.status !== 'ok') return errorResponse(404, 'not-found')
      const current = file.load()
      if (!current.ok) return errorResponse(409, 'unreadable-file')
      const record = current.value.records.find((candidate) => candidate.requirementId === requirementId)
      // An unadopted record has no anchor yet — untampered-silent (the doc
      // is the deliverable; the anchor only exists once adopted).
      const expectedHash = record?.planBaseline?.docHash
      const contentTampered = expectedHash !== undefined && expectedHash !== doc.sha256
      return json({ ok: true, content: doc.text, contentTampered })
    }

    // 0012 face: the split result file — tamper compare against the seed's
    // contentHash (the disk-bytes sha256 the seed anchored, so like hashes
    // like; an unseeded container reads untampered-silent).
    if (kind === 'split-result') {
      const doc = readSplitResultFile(requirementId)
      if (doc.status !== 'ok') return errorResponse(404, 'not-found')
      const current = file.load()
      if (!current.ok) return errorResponse(409, 'unreadable-file')
      const record = current.value.records.find((candidate) => candidate.requirementId === requirementId)
      const expectedHash = record?.splitProposals?.seed?.contentHash
      const contentTampered = expectedHash !== undefined && expectedHash !== doc.sha256
      return json({ ok: true, content: doc.text, contentTampered })
    }

    // 0018 face: the per-WP plan file — file first (readable before any seed
    // lands; the ledger joins only for tamper compare against the planSeed's
    // contentHash — a NEXT delivery's overwrite legitimately moves the disk
    // on, which the next seed re-anchors; an unseeded package reads
    // untampered-silent).
    if (kind === 'wp-plan-doc') {
      const workPackageId = url.searchParams.get('workPackageId')
      if (workPackageId === null || !isWorkPackageId(workPackageId)) return errorResponse(400, 'bad-request')
      const planFile = readWpPlanFile(requirementId, workPackageId)
      if (planFile.status !== 'ok') return errorResponse(404, 'not-found')
      const current = file.load()
      if (!current.ok) return errorResponse(409, 'unreadable-file')
      const record = current.value.records.find((candidate) => candidate.requirementId === requirementId)
      const expectedHash = record?.workPackages.find((candidate) => candidate.id === workPackageId)?.planSeed?.contentHash
      const contentTampered = expectedHash !== undefined && expectedHash !== planFile.sha256
      return json({ ok: true, content: planFile.text, contentTampered })
    }

    const current = file.load()
    if (!current.ok) return errorResponse(409, 'unreadable-file')
    const record = current.value.records.find((candidate) => candidate.requirementId === requirementId)
    if (record === undefined) return errorResponse(404, 'not-found')

    let expectedHash: string | undefined
    let read: ReturnType<ArtifactStore['read']> | undefined
    if (kind === 'plan') {
      const workPackageId = url.searchParams.get('workPackageId')
      const version = Number(url.searchParams.get('version'))
      if (workPackageId === null || !isWorkPackageId(workPackageId) || !isPlanVersion(version)) return errorResponse(400, 'bad-request')
      const workPackage = record.workPackages.find((candidate) => candidate.id === workPackageId)
      if (workPackage === undefined) return errorResponse(404, 'not-found')
      const entry = workPackage.plans.find((plan) => plan.version === version)
      if (entry === undefined) return errorResponse(404, 'not-found')
      // 0029 一并改道: dual-path read with HASH PREFERENCE — a draft
      // rewritten after a channel transition leaves a stale copy in the
      // other channel; the ledger-hash-matching copy is the truth, never
      // first-found (the one semantic difference from the review face).
      const locations = planBodyLocations(requirementId, workPackageId, version)
      const wsRead = locations.workspace !== undefined ? artifacts.read(locations.workspace) : undefined
      const lgRead = artifacts.read(locations.legacy)
      expectedHash = entry.contentHash
      const hashMatch = (candidate: ReturnType<ArtifactStore['read']> | undefined): boolean =>
        candidate !== undefined && candidate.status === 'ok' && candidate.sha256 === expectedHash
      read = hashMatch(wsRead) ? wsRead
        : hashMatch(lgRead) ? lgRead
          : wsRead ?? lgRead // neither matches: the current-channel copy surfaces, flagged tampered
    } else {
      const reviewId = url.searchParams.get('reviewId')
      if (reviewId === null || !isReviewId(reviewId)) return errorResponse(400, 'bad-request')
      const entry = record.reviewReports.find((report) => report.id === reviewId)
      if (entry === undefined) return errorResponse(404, 'not-found')
      // 0028 D2-A: dual-path read — workspace channel first, legacy fallback
      // (pre-0028 bodies read in place; the read path never writes — the
      // lazy migration rides the write/convergence branch only).
      const locations = reviewBodyLocations(requirementId, reviewId)
      read = artifacts.read(locations.workspace ?? locations.legacy)
      if (read.status === 'missing' && locations.workspace !== undefined) read = artifacts.read(locations.legacy)
      expectedHash = entry.contentHash
    }
    if (read === undefined) return errorResponse(400, 'bad-request') // unreachable: the kind gate above
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
      // 0028 D2-A: the scan knows the workspace channel (neither-location =
      // missing); absent resolver degrades to the plugin-store-only check.
      return json({ ok: true, ...scanWorkbenchArtifacts(services.workbenchRoot, current.value.records, services.resolveWorkspacePath) })
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

  // -------------------------------------------------------------------------
  // Session digest (0016 P1b): GET the tail-window event slice for the
  // execution view's collapsed live column. Pure read, 200 degrade envelope.
  // lastEventCount-keyed cache: a repeat request for the same session at the
  // same seq answers from the in-memory cache without re-reading the log.
  // -------------------------------------------------------------------------

  const digestCache = new Map<string, { count: number; response: SessionDigestResponseOk }>()

  connection.fetch.register({
    path: WORKBENCH_SESSION_DIGEST_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      const url = new URL(request.url)
      const sessionId = url.searchParams.get('sessionId')
      if (sessionId === null || sessionId.length === 0) return errorResponse(400, 'bad-request')
      // Cache hit: same session + same lastEventCount — the log hasn't moved
      const engine = (services.declareReader as unknown as { '#engine'?: { readSession(id: string): Promise<{ events: readonly unknown[] }> } })['#engine']
      if (engine === undefined) {
        const body: SessionDigestResponse = { ok: true, missing: 'no-service' }
        return json(body)
      }
      let events: readonly unknown[]
      try {
        const snapshot = await engine.readSession(sessionId)
        events = snapshot.events
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code
        const body: SessionDigestResponse = { ok: true, missing: code === 'SESSION_QUERY_SESSION_NOT_FOUND' ? 'not-found' : 'unreadable' }
        return json(body)
      }
      // Derive the tail window: count from the END, cap by events AND bytes.
      const safeEvents = events as readonly { type?: unknown; seq?: unknown; time?: unknown; data?: unknown }[]
      let lastEventCount = 0
      for (const ev of safeEvents) {
        if (typeof ev.seq === 'number' && ev.seq > lastEventCount) lastEventCount = ev.seq
      }
      const cached = digestCache.get(sessionId)
      if (cached !== undefined && cached.count === lastEventCount) {
        return json(cached.response)
      }
      // Slice from the tail: walk backwards accumulating until a cap hits.
      const tail: { type: string; seq?: number; time?: number; data?: unknown }[] = []
      let byteBudget = SESSION_DIGEST_MAX_BYTES
      let truncatedCount = 0
      for (let i = safeEvents.length - 1; i >= 0; i--) {
        const ev = safeEvents[i]!
        const evType = typeof ev.type === 'string' ? ev.type : ''
        const evSeq = typeof ev.seq === 'number' ? ev.seq : undefined
        const evTime = typeof ev.time === 'number' ? ev.time : undefined
        const wire: { type: string; seq?: number; time?: number; data?: unknown } = {
          type: evType,
          ...(evSeq !== undefined ? { seq: evSeq } : {}),
          ...(evTime !== undefined ? { time: evTime } : {}),
          ...(ev.data !== undefined ? { data: ev.data } : {}),
        }
        const wireBytes = JSON.stringify(wire).length
        if (tail.length >= SESSION_DIGEST_MAX_EVENTS || byteBudget - wireBytes < 0) {
          truncatedCount = i + 1
          break
        }
        byteBudget -= wireBytes
        tail.unshift(wire)
      }
      const response: SessionDigestResponseOk = {
        ok: true,
        events: tail,
        lastEventCount,
        truncatedCount,
      }
      digestCache.set(sessionId, { count: lastEventCount, response })
      return json(response)
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

    // 0016 P1a: the devDeclare key rides ONLY the slot's own package — the
    // fence's block scope must agree (a mismatch is a client wiring bug:
    // 400, never a silent cross-WP stamp).
    if (body.devDeclare !== undefined) {
      const fenceBody = findDeclareFence(body.text)
      const scope = fenceBody !== null ? DEV_DECLARE_SCOPE_RE.exec(fenceBody)?.[1] : undefined
      if (scope !== body.devDeclare.workPackageId) return errorResponse(400, 'bad-request')
    }

    if (body.dryRun === true) {
      // Preview only — zero writes (byte-identical file asserted in tests).
      const preview: DeclarePreviewResponseOk = {
        ok: true,
        revision: current.value.revision,
        entries: parse.entries,
        skipped: parse.skipped,
        stageReady: parse.stageReady,
        // 0016: advisory drift disclosure — the slot anchored a different
        // hash than the presented text (「会话文本已变化」; the user confirms
        // and the commit proceeds, a fresh re-fetch being the honest fix).
        ...(body.devDeclare !== undefined && declareImportStale(base, body.devDeclare.workPackageId, contentHashOf(body.text))
          ? { declareStale: true }
          : {}),
        // 0016 P2a: advisory delivery metadata (summary / files / verification)
        ...(parse.declareSummary !== undefined ? { declareSummary: parse.declareSummary } : {}),
        ...(parse.declareFiles !== undefined ? { declareFiles: parse.declareFiles } : {}),
        ...(parse.declareVerification !== undefined ? { declareVerification: parse.declareVerification } : {}),
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
    // 0016 P1a: the devDeclare slot's imported flip + the WP's declarations
    // receipt fold into the SAME record (one atomic save). A slot-error here
    // is a client wiring bug (no seeded slot for the named package) — 400.
    // Note the stamp runs even when applied === 0 with a PENDING slot: the
    // user collected this batch and its entries were already landed or
    // guard-rejected — adjudicating the batch is the real change (the retry
    // after a post-save file failure converges through stamp.unchanged).
    let stamp: { record: WorkbenchRecord; anchorSeq: number; unchanged: boolean } | undefined
    if (body.devDeclare !== undefined) {
      const stamped = stampDevDeclareImported(record, {
        workPackageId: body.devDeclare.workPackageId,
        sessionId: body.sessionId,
        contentHash: contentHashOf(body.text),
      })
      if ('error' in stamped) return errorResponse(400, 'bad-request')
      stamp = stamped
      record = stamped.record
    }
    if (applied === 0 && (stamp === undefined || stamp.unchanged)) {
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
      // 0016: post-commit receipt copy (best-effort by contract — the ledger
      // is authoritative; a workspace-unarmed requirement simply skips it).
      if (body.devDeclare !== undefined && stamp !== undefined && !stamp.unchanged) {
        writeDeclareReceipt(body.requirementId, body.devDeclare.workPackageId, stamp.anchorSeq, body.text)
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

  /** 0016: plain post-commit copy of the imported declare text (no convergence — seq-named files are immutable receipts). */
  function writeDeclareReceipt(requirementId: string, workPackageId: string, seq: number, text: string): void {
    const resolve = services.resolveWorkspacePath
    if (resolve === undefined) return
    const workspace = resolve(requirementId)
    if (workspace === '') return
    try {
      artifacts.write(devDeclareImportedPath(workspace, requirementId, workPackageId, seq), text)
    } catch (error) {
      log?.(error)
    }
  }
}

/** 0016: the slot's seed hash disagrees with the presented text (preview advisory). */
function declareImportStale(base: WorkbenchRecord, workPackageId: string, hash: string): boolean {
  const slot = base.devDeclares?.[workPackageId]
  return slot !== undefined && slot.seed.contentHash !== hash
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
