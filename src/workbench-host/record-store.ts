/**
 * Workbench record store (0032, decisions/0032): ONE FILE PER REQUIREMENT at
 * `<workbenchRoot>/<requirementId>/record.yaml` — the record CO-LOCATED with
 * its plans/reviews artifacts, so the record's lifecycle is identical to its
 * artifacts' (the D6 cascade's whole-directory rename carries both). The
 * pre-0032 single-file ledger ($DSH_HOME/skyaxis/workbench.yaml) is retired;
 * this store migrates it ONCE at construction (D2) and keeps
 * workbench-file.ts around solely as the legacy READ face for that migration.
 *
 * Why shards (research/0032 §1): the domain model is already per-requirement
 * (every mutate carries requirementId + expectedRevision; id minting is
 * record-scoped; NO cross-record atomic write exists) — the global revision
 * was an artifact of the single file, and its blast radius (one bad row
 * degrades EVERY requirement, the R#### incident) plus full-file
 * parse/rewrite on every operation grew with the machine. Each shard now
 * carries its OWN revision (optimistic lock); a missing shard is the record's
 * absence at VIRTUAL revision 0 — exactly the client slot's unloaded-sentinel
 * (controller slotRevision), so implicit-create actions keep landing.
 *
 * Envelope per shard: {version: 1, revision, record} with record.yaml.bak
 * beside it. Load validates `envelope.record.requirementId === directory
 * name` — a shard copied into another requirement's directory degrades to
 * schema-rejected instead of loading as the wrong record (the artifact-path
 * layer-2 defense discipline).
 *
 * Migration (D2, host-domain single writer — NO dual-channel reads, no hash
 * preference): if the legacy workbench.yaml exists and reads OK, force-seed
 * every record's shard (revision 1) then RENAME the legacy file to
 * `.migrated` (the commit point; .bak/.tmp ride along best-effort). Any
 * crash before the rename re-runs idempotently. A degraded legacy file
 * BLOCKS the whole store (preserve the scene for manual recovery — the
 * workbench-file contract carried forward); a legacy file still present
 * after a readable migration attempt (rename keeps failing) blocks too, so
 * no read/write can ever shadow-mint a fresh shard over data still owned by
 * the legacy file. Every entry point re-runs the migration check first —
 * the constructor call is eager convergence, not the only chance.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import YAML from 'yaml'
import type { WorkbenchRecord } from '../workbench-shared/protocol.js'
import { RecordEnvelopeSchema, type RecordEnvelope } from './types.js'
import { WorkbenchFileStore } from './workbench-file.js'

/** Directory names are requirement ids — lowercase uuid only (the artifact-path gate). */
const REQUIREMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const RECORD_FILE_NAME = 'record.yaml'
const MIGRATED_SUFFIX = '.migrated'
const MAX_RENAME_ATTEMPTS = 10

export interface RecordStoreIo {
  rename(from: string, to: string): void
  wait(ms: number): void
}

const defaultIo: RecordStoreIo = {
  rename: renameSync,
  wait(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  },
}

/**
 * Single-shard load: ok / missing (record absent, virtual revision 0) /
 * degraded. The cross-optional `missing`/`degraded` keys are the narrowing
 * contract: consumers guard `!ok && degraded` and then read `missing` /
 * `value` without casting (both keys exist on every member).
 */
export type RecordLoadResult =
  | { ok: true; missing?: undefined; degraded?: undefined; value: { revision: number; record: WorkbenchRecord } }
  | { ok: false; missing: true; degraded?: undefined }
  | { ok: false; missing?: undefined; degraded: true; reason: 'parse' | 'schema' | 'io'; detail: string; hasBackup: boolean }

export type RecordSaveResult =
  | { ok: true; revision: number }
  | { ok: false; rejected: 'unreadable-file' }
  | { ok: false; rejected: 'stale-revision'; currentRevision: number }

/** One healthy shard's listing row (the wire list face's shape, 0032). */
export interface RecordListRow {
  readonly requirementId: string
  readonly revision: number
  readonly record: WorkbenchRecord
}

/** A shard that exists but will not load — excluded from rows, skipped by the artifact scan. */
export interface RecordDegradedRow {
  readonly requirementId: string
  readonly reason: 'parse' | 'schema' | 'io'
  readonly hasBackup: boolean
}

export type RecordListResult =
  | { ok: true; rows: readonly RecordListRow[]; degradedRows: readonly RecordDegradedRow[] }
  | { ok: false; degraded: true; reason: 'parse' | 'schema' | 'io'; detail: string; hasBackup: boolean }

function assertRequirementId(requirementId: string): void {
  if (!REQUIREMENT_ID_RE.test(requirementId)) {
    throw new Error(`record-store: requirementId rejected (not a lowercase uuid): ${JSON.stringify(requirementId)}`)
  }
}

export class WorkbenchRecordStore {
  readonly workbenchRoot: string
  readonly legacyFilePath: string
  readonly #io: RecordStoreIo
  readonly #legacy: WorkbenchFileStore
  /** Per-requirement serialized saves — shards are independent files, so the queues are too. */
  readonly #queues = new Map<string, Promise<unknown>>()

  constructor(workbenchRoot: string, legacyFilePath: string, io: RecordStoreIo = defaultIo) {
    this.workbenchRoot = workbenchRoot
    this.legacyFilePath = legacyFilePath
    this.#io = io
    this.#legacy = new WorkbenchFileStore(legacyFilePath)
    // Eager convergence (D2) — never throws; entry points re-check and self-heal.
    this.#ensureMigrated()
  }

  /** The shard path — <root>/<requirementId>/record.yaml (uuid-gated before the join). */
  recordPath(requirementId: string): string {
    assertRequirementId(requirementId)
    return join(this.workbenchRoot, requirementId, RECORD_FILE_NAME)
  }

  /**
   * Synchronous single-record read. Never throws. The whole-store blocked
   * state (legacy migration stuck) surfaces here as degraded — the endpoint
   * maps it to the same 409 unreadable-file the single-file era answered.
   */
  loadRecord(requirementId: string): RecordLoadResult {
    assertRequirementId(requirementId)
    this.#ensureMigrated()
    const blocked = this.#blocked()
    if (blocked !== undefined) return blocked
    return this.#loadShard(requirementId)
  }

  /**
   * Serialized per-record save: load → revision check → atomic write,
   * revision +1 on success. A MISSING shard's virtual revision is 0 — the
   * implicit-create arm (client slot revision 0) lands as revision 1. Never
   * writes over an unreadable shard (preserve the scene); refuses when the
   * store is migration-blocked (a fresh shard must never shadow the legacy
   * file's data).
   */
  saveRecord(requirementId: string, expectedRevision: number, record: WorkbenchRecord): Promise<RecordSaveResult> {
    assertRequirementId(requirementId)
    if (record.requirementId !== requirementId) {
      throw new Error(`record-store: record.requirementId mismatch (shard ${requirementId} vs record ${record.requirementId}) — refusing to write A's record into B's shard`)
    }
    const run = (): RecordSaveResult => {
      this.#ensureMigrated()
      const blocked = this.#blocked()
      if (blocked !== undefined) return { ok: false, rejected: 'unreadable-file' }
      const current = this.#loadShard(requirementId)
      if (!current.ok) {
        if (current.missing) {
          if (expectedRevision !== 0) return { ok: false, rejected: 'stale-revision', currentRevision: 0 }
        } else {
          return { ok: false, rejected: 'unreadable-file' }
        }
      } else if (current.value.revision !== expectedRevision) {
        return { ok: false, rejected: 'stale-revision', currentRevision: current.value.revision }
      }
      const next: RecordEnvelope = { version: 1, revision: expectedRevision + 1, record }
      this.#atomicSave(this.recordPath(requirementId), next)
      return { ok: true, revision: next.revision }
    }
    const previous = this.#queues.get(requirementId) ?? Promise.resolve()
    const result = previous.then(run, run)
    // Keep the queue usable even when a save throws (unexpected fs failure bubbles to the caller).
    this.#queues.set(requirementId, result.catch(() => undefined))
    return result
  }

  /**
   * Directory scan + per-shard load. An artifacts-only directory (no
   * record.yaml — e.g. a cascade whose step ⑤ rename failed) is NOT a row:
   * record presence is record.yaml presence, never directory presence. The
   * degradedRows ride along for the scan's skip-set; the wire list face
   * carries only the healthy rows.
   */
  listAll(): RecordListResult {
    this.#ensureMigrated()
    const blocked = this.#blocked()
    if (blocked !== undefined) return blocked
    const rows: RecordListRow[] = []
    const degradedRows: RecordDegradedRow[] = []
    const rootStat = statSync(this.workbenchRoot, { throwIfNoEntry: false })
    if (rootStat?.isDirectory() === true) {
      for (const entry of readdirSync(this.workbenchRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || !REQUIREMENT_ID_RE.test(entry.name)) continue
        const load = this.#loadShard(entry.name)
        if (load.ok) {
          rows.push({ requirementId: entry.name, revision: load.value.revision, record: load.value.record })
        } else if (!load.missing) {
          degradedRows.push({ requirementId: entry.name, reason: load.reason, hasBackup: load.hasBackup })
        }
      }
    }
    return { ok: true, rows, degradedRows }
  }

  /**
   * Cascade step ③ (0032 redefinition): unlink the shard — record.yaml AND
   * its .bak (record removal removes the whole shard). ENOENT is the
   * idempotent no-op; anything else throws for the cascade's own
   * best-effort catch. Never touches the rest of the directory (plans/
   * reviews/tombstone ride the step ⑤ rename).
   */
  removeRecord(requirementId: string): void {
    const path = this.recordPath(requirementId)
    for (const target of [path, `${path}.bak`]) {
      try {
        unlinkSync(target)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | null)?.code
        if (code !== 'ENOENT') throw error
      }
    }
  }

  // --- internals -----------------------------------------------------------

  /** Raw shard load — no migration recursion, no blocking check. Never throws. */
  #loadShard(requirementId: string): RecordLoadResult {
    const path = this.recordPath(requirementId)
    const hasBackup = existsSync(`${path}.bak`)
    if (!existsSync(path)) return { ok: false, missing: true }
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch (error) {
      return { ok: false, degraded: true, reason: 'io', detail: String((error as Error)?.message ?? error), hasBackup }
    }
    let parsed: unknown
    try {
      parsed = YAML.parse(text)
    } catch (error) {
      return { ok: false, degraded: true, reason: 'parse', detail: String((error as Error)?.message ?? error), hasBackup }
    }
    const checked = RecordEnvelopeSchema.safeParse(parsed)
    if (!checked.success) {
      const first = checked.error.issues[0]
      const detail = first ? `${first.path.join('.')}: ${first.message}` : 'schema mismatch'
      return { ok: false, degraded: true, reason: 'schema', detail, hasBackup }
    }
    if (checked.data.record.requirementId !== requirementId) {
      return { ok: false, degraded: true, reason: 'schema', detail: `shard/dir mismatch: ${checked.data.record.requirementId} inside ${requirementId}`, hasBackup }
    }
    return { ok: true, value: { revision: checked.data.revision, record: checked.data.record } }
  }

  /**
   * Whole-store blocked state: the legacy ledger is still the owner of truth
   * (present AND unreadable — preserve the scene; or present after a readable
   * migration attempt whose rename never landed — never let a fresh shard
   * shadow data the legacy file still holds). undefined = shards are
   * authoritative.
   */
  #blocked(): { ok: false; degraded: true; reason: 'parse' | 'schema' | 'io'; detail: string; hasBackup: boolean } | undefined {
    if (!existsSync(this.legacyFilePath)) return undefined
    const legacy = this.#legacy.load()
    if (!legacy.ok) {
      return { ok: false, degraded: true, reason: legacy.reason, detail: legacy.detail, hasBackup: legacy.hasBackup }
    }
    return {
      ok: false,
      degraded: true,
      reason: 'io',
      detail: 'legacy workbench.yaml still present after migration attempt',
      hasBackup: existsSync(`${this.legacyFilePath}.bak`),
    }
  }

  /**
   * One-time migration (D2), idempotent and never throwing: readable legacy
   * → force-seed every shard at revision 1 → rename legacy to `.migrated`
   * (the commit point). Degraded legacy → left in place (blocked; manual
   * repair, auto-retried on the next entry point).
   */
  #ensureMigrated(): void {
    if (!existsSync(this.legacyFilePath)) return
    const legacy = this.#legacy.load()
    if (!legacy.ok) return // blocked — #blocked() reports it
    try {
      for (const record of legacy.value.records) {
        this.#atomicSave(this.recordPath(record.requirementId), { version: 1, revision: 1, record })
      }
      this.#renameWithRetry(this.legacyFilePath, `${this.legacyFilePath}${MIGRATED_SUFFIX}`)
      // Best-effort companions: a failed companion rename leaves residue, never blocks.
      for (const companion of [`${this.legacyFilePath}.bak`, `${this.legacyFilePath}.tmp`]) {
        if (existsSync(companion)) {
          try {
            this.#io.rename(companion, `${companion}${MIGRATED_SUFFIX}`)
          } catch {
            // Best-effort residue — the migrated state is already committed.
          }
        }
      }
    } catch {
      // Rename never landed → legacy still present → #blocked() holds the store.
    }
  }

  /** Atomic replace: write tmp → copy .bak → rename with EPERM/EACCES backoff (the workbench-file contract per shard). */
  #atomicSave(path: string, doc: RecordEnvelope): void {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, YAML.stringify(doc), 'utf8')
    if (existsSync(path)) {
      try {
        copyFileSync(path, `${path}.bak`)
      } catch {
        // Best-effort backup; a failed copy must not block the atomic replace.
      }
    }
    this.#renameWithRetry(tmp, path)
  }

  #renameWithRetry(from: string, to: string): void {
    for (let attempt = 0; ; attempt++) {
      try {
        this.#io.rename(from, to)
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | null)?.code
        if (code !== 'EPERM' && code !== 'EACCES') throw error
        if (attempt >= MAX_RENAME_ATTEMPTS - 1) throw error
        this.#io.wait(20 * (attempt + 1))
      }
    }
  }
}
