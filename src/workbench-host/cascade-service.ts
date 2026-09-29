/**
 * D6 graded cascade (decisions/0005): requirement removal archiving, split
 * into the two phases the pinned order ①→②→③④⑤ demands —
 *
 *   beginRemoval    step ①  tombstone into the LIVE artifact dir
 *                   (workbench/<rid>/deleted-record.yaml: the removed
 *                   requirement + its workbench record + its requirement-
 *                   scope knowledge rows + deletion time). Called by the
 *                   requirements remove endpoint BEFORE its own save: a
 *                   failed save then leaves a live requirement plus a
 *                   harmless tombstone that the remove retry overwrites;
 *                   the reverse order could orphan a tombstone-less .trash
 *                   directory ("rename ok, tombstone failed").
 *   [step ②         requirements.yaml filter+save — the remove endpoint's
 *                   own committed save, never here.]
 *   completeRemoval steps ③④⑤ workbench.yaml record removal → knowledge.yaml
 *                   scope-split removal (scope==='requirement' AND id match;
 *                   global/workspace rows are promoted public assets,
 *                   untouchable) → whole-directory rename into
 *                   .trash/<rid>-<sanitized ISO> (same-volume single atomic
 *                   syscall; the tombstone rides along).
 *
 * Every step is independently best-effort — no step rolls back, no step
 * short-circuits the next (step ③ failing leaves ④⑤ running), every failure
 * degrades to log + on-disk residue, and the whole service never throws
 * (the remove endpoint double-guards, but the contract starts here). All
 * steps are idempotent: re-running a partially failed cascade converges
 * (already-filtered ledger = no-op, tombstone overwrite, ENOENT rename with
 * the trash target present = done). The residue faces stay visible through
 * the orphan scan; removal of an already-removed requirement keeps its 404
 * semantics — "idempotent re-run" is the CASCADE's property, not a wire
 * change. A degraded ledger snapshots its segment as null and continues:
 * degradation never blocks a user's delete.
 *
 * Windows fact (D6): renaming a source directory held open by an editor
 * commonly raises EPERM/EBUSY — that step degrades to in-place residue
 * (lossless, equivalent to orphan tolerance), logged so "why is the
 * directory still there" has an answer.
 */
import { mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import YAML from 'yaml'
import type { RequirementRecord } from '../requirements-shared/protocol.js'
import type { WorkbenchCleanupLike } from '../requirements-host/endpoint.js'
import { trashDirName, requirementArtifactDir } from './artifact-path.js'
import { ArtifactStore } from './artifact-store.js'
import type { KnowledgeFileStore } from './knowledge-file.js'
import type { WorkbenchFileStore } from './workbench-file.js'

const TOMBSTONE_FILE_NAME = 'deleted-record.yaml'
const TRASH_DIR_NAME = '.trash'

/** Injectable fs seams for failure-injection tests (the FileStore Io precedent). */
export interface CascadeIo {
  rename(from: string, to: string): void
  writeTombstone(path: string, text: string): void
}

const defaultArtifactStore = new ArtifactStore()

const defaultIo: CascadeIo = {
  rename: renameSync,
  writeTombstone(path, text) {
    defaultArtifactStore.write(path, text)
  },
}

export interface WorkbenchCascadeServices {
  readonly workbenchFile: WorkbenchFileStore
  readonly knowledgeFile: KnowledgeFileStore
  /** $DSH_HOME/skyaxis/workbench — the artifacts root (ledger files are siblings, never inside). */
  readonly workbenchRoot: string
  /** Host log face for degraded steps. */
  readonly log?: (error: unknown) => void
  readonly io?: CascadeIo
}

export class WorkbenchCascadeService implements WorkbenchCleanupLike {
  readonly #services: WorkbenchCascadeServices
  readonly #io: CascadeIo

  constructor(services: WorkbenchCascadeServices) {
    this.#services = services
    this.#io = services.io ?? defaultIo
  }

  /** Step ① — tombstone first, into the live directory. Never throws. */
  beginRemoval(requirement: RequirementRecord): void {
    try {
      const dir = requirementArtifactDir(this.#services.workbenchRoot, requirement.id)
      const workbenchCurrent = this.#services.workbenchFile.load()
      const workbenchRecord = workbenchCurrent.ok
        ? workbenchCurrent.value.records.find((record) => record.requirementId === requirement.id) ?? null
        : null
      const knowledgeCurrent = this.#services.knowledgeFile.load()
      const knowledgeRows = knowledgeCurrent.ok
        ? knowledgeCurrent.value.records.filter((row) => row.scope === 'requirement' && row.requirementId === requirement.id)
        : []
      const tombstone = {
        version: 1,
        deletedAt: new Date().toISOString(),
        requirement,
        workbench: workbenchRecord,
        knowledge: knowledgeRows,
      }
      this.#io.writeTombstone(join(dir, TOMBSTONE_FILE_NAME), YAML.stringify(tombstone))
    } catch (error) {
      this.#services.log?.(error)
    }
  }

  /**
   * Steps ③④⑤ — the destructive tail, only after a committed requirements
   * save. Steps are independent; each failure logs and the next still runs.
   */
  async completeRemoval(requirement: RequirementRecord): Promise<void> {
    const rid = requirement.id

    // Step ③ — workbench.yaml record removal.
    try {
      const current = this.#services.workbenchFile.load()
      if (current.ok) {
        const nextRecords = current.value.records.filter((record) => record.requirementId !== rid)
        if (nextRecords.length !== current.value.records.length) {
          // The cascade owns its revision bookkeeping (fresh load, not the
          // client's expectedRevision); a concurrent writer makes this step
          // stale — residue, re-runnable, never a user-facing error.
          const saved = await this.#services.workbenchFile.save(current.value.revision, nextRecords)
          if (!saved.ok) {
            this.#services.log?.(new Error(`cascade step 3 (workbench ledger) skipped: ${saved.rejected}`))
          }
        }
        // Already filtered — idempotent no-op.
      } else {
        this.#services.log?.(new Error('cascade step 3 (workbench ledger) skipped: degraded ledger'))
      }
    } catch (error) {
      this.#services.log?.(error)
    }

    // Step ④ — knowledge.yaml scope-split removal: requirement-scope rows
    // for this requirement only; global/workspace rows are untouchable.
    try {
      const current = this.#services.knowledgeFile.load()
      if (current.ok) {
        const nextRecords = current.value.records.filter(
          (row) => !(row.scope === 'requirement' && row.requirementId === rid),
        )
        if (nextRecords.length !== current.value.records.length) {
          const saved = await this.#services.knowledgeFile.save(current.value.revision, nextRecords)
          if (!saved.ok) {
            this.#services.log?.(new Error(`cascade step 4 (knowledge ledger) skipped: ${saved.rejected}`))
          }
        }
      } else {
        this.#services.log?.(new Error('cascade step 4 (knowledge ledger) skipped: degraded ledger'))
      }
    } catch (error) {
      this.#services.log?.(error)
    }

    // Step ⑤ — whole-directory rename into .trash (tombstone rides along).
    // Windows-held directories raise EPERM/EBUSY → in-place residue, logged.
    try {
      const dir = requirementArtifactDir(this.#services.workbenchRoot, rid)
      if (statSync(dir, { throwIfNoEntry: false }) === undefined) return // nothing on disk — done
      const trashDir = join(this.#services.workbenchRoot, TRASH_DIR_NAME)
      mkdirSync(trashDir, { recursive: true })
      this.#io.rename(dir, join(trashDir, trashDirName(rid, new Date().toISOString())))
    } catch (error) {
      this.#services.log?.(error)
    }
  }
}
