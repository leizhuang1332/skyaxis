/**
 * Artifact document store kernel: writes and reads the markdown files under
 * $DSH_HOME/skyaxis/workbench/<requirementId>/ (decisions/0005 D4-③ step 5
 * — everything after the ledger-first save).
 *
 *  - `contentHashOf` pins the tamper-detection coordinate system: sha256
 *    over the UTF-8 bytes as written to disk, no newline normalization —
 *    the ledger baseline and the on-disk evidence hash the same bytes.
 *  - `write` = mkdir -p parent + `${final}.${uuid}.tmp` + rename with
 *    EPERM/EACCES backoff (the requirements-file.ts #atomicSave precedent,
 *    Windows antivirus/lock transients).
 *  - `read` never throws for the honest-degradation cases: missing file
 *    (write interrupted or externally deleted) and over-cap files are
 *    statuses, not exceptions. The raw buffer is hashed BEFORE utf8
 *    decoding so tamper detection sees the exact bytes on disk.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { WORKBENCH_ARTIFACT_MAX_READ_BYTES } from '../workbench-shared/protocol.js'

export interface ArtifactIo {
  rename(from: string, to: string): void
  wait(ms: number): void
}

const defaultIo: ArtifactIo = {
  rename: renameSync,
  wait(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  },
}

const MAX_RENAME_ATTEMPTS = 10

/** sha256 hex over the UTF-8 encoding of `text` — the one hash basis everywhere. */
export function contentHashOf(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
}

export type ArtifactReadResult =
  | { status: 'ok'; text: string; sha256: string }
  | { status: 'missing' }
  | { status: 'too-large' }

export class ArtifactStore {
  readonly #io: ArtifactIo

  constructor(io: ArtifactIo = defaultIo) {
    this.#io = io
  }

  /**
   * Atomic replace of `targetPath` with `text`. Throws only on real fs
   * failure (the caller maps that to a dangling-reference 500 — the write
   * came after a committed ledger save, so the residue direction is
   * "referenced but absent", visible and retryable).
   */
  write(targetPath: string, text: string): void {
    mkdirSync(dirname(targetPath), { recursive: true })
    const tmp = `${targetPath}.${randomUUID()}.tmp`
    writeFileSync(tmp, text, 'utf8')
    for (let attempt = 0; ; attempt++) {
      try {
        this.#io.rename(tmp, targetPath)
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | null)?.code
        if (code !== 'EPERM' && code !== 'EACCES') throw error
        if (attempt >= MAX_RENAME_ATTEMPTS - 1) throw error
        this.#io.wait(20 * (attempt + 1))
      }
    }
  }

  read(targetPath: string): ArtifactReadResult {
    const stat = statSync(targetPath, { throwIfNoEntry: false })
    if (stat === undefined || !stat.isFile()) return { status: 'missing' }
    if (stat.size > WORKBENCH_ARTIFACT_MAX_READ_BYTES) return { status: 'too-large' }
    let buffer: Buffer
    try {
      buffer = readFileSync(targetPath)
    } catch {
      return { status: 'missing' }
    }
    return { status: 'ok', text: buffer.toString('utf8'), sha256: createHash('sha256').update(buffer).digest('hex') }
  }
}
