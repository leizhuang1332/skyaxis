/**
 * Requirements persistent store: $DSH_HOME/skyaxis/requirements.yaml
 * (the repos-pool route-B precedent, ported wholesale).
 *
 *  - `load` never throws. Missing file = pristine state (revision 0); a
 *    corrupt or schema-violating file degrades to `{ ok: false, degraded }`
 *    with `.bak` availability reported so the UI can point the user at it.
 *  - `save` serializes through an internal queue (load-check-write is not
 *    atomic otherwise), refuses to write over an unreadable file (preserve
 *    the scene for manual recovery), and rejects stale revisions.
 *  - Atomic replace: write `${file}.tmp` → copy current to `${file}.bak` →
 *    rename with EPERM/EACCES backoff (antivirus/lock transients on Windows).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import YAML from 'yaml'
import type { RequirementRecord } from '../requirements-shared/protocol.js'
import { RequirementsFileSchema, type RequirementsFile } from './types.js'

export interface RequirementsFileIo {
  rename(from: string, to: string): void
  wait(ms: number): void
}

const defaultIo: RequirementsFileIo = {
  rename: renameSync,
  wait(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  },
}

export type RequirementsFileResult =
  | { ok: true; value: RequirementsFile }
  | { ok: false; degraded: true; reason: 'parse' | 'schema' | 'io'; detail: string; hasBackup: boolean }

export type RequirementsSaveResult =
  | { ok: true; revision: number }
  | { ok: false; rejected: 'unreadable-file' }
  | { ok: false; rejected: 'stale-revision'; currentRevision: number }

const MAX_RENAME_ATTEMPTS = 10

export class RequirementsFileStore {
  readonly filePath: string
  readonly #io: RequirementsFileIo
  #queue: Promise<unknown> = Promise.resolve()

  constructor(filePath: string, io: RequirementsFileIo = defaultIo) {
    this.filePath = filePath
    this.#io = io
  }

  /** Synchronous read; a single fs segment, deliberately outside the queue. Never throws. */
  load(): RequirementsFileResult {
    const hasBackup = existsSync(`${this.filePath}.bak`)
    if (!existsSync(this.filePath)) {
      return { ok: true, value: { version: 1, revision: 0, requirements: [] } }
    }
    let text: string
    try {
      text = readFileSync(this.filePath, 'utf8')
    } catch (error) {
      return { ok: false, degraded: true, reason: 'io', detail: String((error as Error)?.message ?? error), hasBackup }
    }
    let parsed: unknown
    try {
      parsed = YAML.parse(text)
    } catch (error) {
      return { ok: false, degraded: true, reason: 'parse', detail: String((error as Error)?.message ?? error), hasBackup }
    }
    const checked = RequirementsFileSchema.safeParse(parsed)
    if (!checked.success) {
      const first = checked.error.issues[0]
      const detail = first ? `${first.path.join('.')}: ${first.message}` : 'schema mismatch'
      return { ok: false, degraded: true, reason: 'schema', detail, hasBackup }
    }
    return { ok: true, value: checked.data }
  }

  /**
   * Serialized save: load → revision check → atomic write, revision +1 on
   * success. Concurrent saves with the same expectedRevision resolve to
   * exactly one ok and one stale rejection.
   */
  save(expectedRevision: number, requirements: readonly RequirementRecord[]): Promise<RequirementsSaveResult> {
    const run = (): RequirementsSaveResult => {
      const current = this.load()
      if (!current.ok) return { ok: false, rejected: 'unreadable-file' }
      if (current.value.revision !== expectedRevision) {
        return { ok: false, rejected: 'stale-revision', currentRevision: current.value.revision }
      }
      const next: RequirementsFile = { version: 1, revision: expectedRevision + 1, requirements: [...requirements] }
      this.#atomicSave(next)
      return { ok: true, revision: next.revision }
    }
    const result = this.#queue.then(run, run)
    // Keep the queue usable even when a save throws (unexpected fs failure bubbles to the caller).
    this.#queue = result.catch(() => undefined)
    return result
  }

  #atomicSave(doc: RequirementsFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, YAML.stringify(doc), 'utf8')
    if (existsSync(this.filePath)) {
      try {
        copyFileSync(this.filePath, `${this.filePath}.bak`)
      } catch {
        // Best-effort backup; a failed copy must not block the atomic replace.
      }
    }
    for (let attempt = 0; ; attempt++) {
      try {
        this.#io.rename(tmp, this.filePath)
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
