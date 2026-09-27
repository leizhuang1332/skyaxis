/**
 * Host-side workspace binding domain logic (P3a): an injectable dependency of
 * the requirements endpoints.
 *
 * Binding flow: absolute-path guard (zero side effects) -> mkdir -p ->
 * realpath canonicalization -> idempotent registry.create. The registry is an
 * optional capability (cordis setter pattern, subprocess precedent): when the
 * host composition has no workspaceRegistry the ledger path is still stored —
 * registered:false — and a later re-save of the same path completes the
 * registration (create is idempotent per canonical path).
 *
 * Deleting never touches disk or registry state — the DSH workspace removal
 * philosophy.
 */
import { mkdirSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'
import { workspaceSlug } from './slug.js'

/** Structural minimum of the host workspace registry (fakes satisfy this too). */
export interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<{ readonly path: string }>
  list(): readonly { readonly path: string }[]
}

export type WorkspaceBindResult =
  | { ok: true; canonicalPath: string; registered: boolean }
  | { ok: false; reason: 'invalid-path' | 'internal'; detail?: string }

export class RequirementWorkspaceBinder {
  #registry: WorkspaceRegistryLike | undefined

  /** Cordis inject callback target — undefined when the service is absent. */
  setRegistry(registry: WorkspaceRegistryLike | undefined): void {
    this.#registry = registry
  }

  /**
   * Validate, create on disk and register a workspace directory.
   * Rejections are classified, never thrown. The registry entry is created
   * WITHOUT a title — the host default is the final path segment, so the
   * workspace lists under its directory name, matching host-native rows.
   */
  async bind(rawPath: string): Promise<WorkspaceBindResult> {
    const path = rawPath.trim()
    if (path.length === 0 || !isAbsolute(path)) {
      return { ok: false, reason: 'invalid-path' }
    }
    try {
      mkdirSync(path, { recursive: true })
    } catch {
      return { ok: false, reason: 'invalid-path' }
    }
    let canonicalPath: string
    try {
      canonicalPath = await realpathNormalize(path)
    } catch (error) {
      // TypeError = not fully qualified (already guarded above), ENOENT /
      // not-a-directory = unusable target; anything else is unexpected.
      if (error instanceof TypeError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: false, reason: 'invalid-path' }
      }
      return { ok: false, reason: 'internal', detail: String(error) }
    }
    const registered = await this.registerCanonical(canonicalPath)
    if (!registered.ok) return registered
    return { ok: true, canonicalPath, registered: registered.value }
  }

  /**
   * Recreate the host registration for an already-bound path — no mkdir (a
   * vanished directory must not silently become an empty registered one;
   * that case belongs to a fresh set) and no ledger write.
   */
  async rebind(canonicalPath: string): Promise<WorkspaceBindResult> {
    if (canonicalPath.trim().length === 0 || !isAbsolute(canonicalPath)) {
      return { ok: false, reason: 'invalid-path' }
    }
    try {
      await realpathNormalize(canonicalPath)
    } catch (error) {
      if (error instanceof TypeError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: false, reason: 'invalid-path' }
      }
      return { ok: false, reason: 'internal', detail: String(error) }
    }
    const registered = await this.registerCanonical(canonicalPath)
    if (!registered.ok) return registered
    return { ok: true, canonicalPath, registered: registered.value }
  }

  /** Idempotent registry.create; existing rows keep their (possibly user-renamed) title. */
  async registerCanonical(canonicalPath: string): Promise<{ ok: true; value: boolean } | { ok: false; reason: 'invalid-path' | 'internal'; detail?: string }> {
    const registry = this.#registry
    if (registry === undefined) {
      return { ok: true, value: false }
    }
    try {
      await registry.create(canonicalPath)
      return { ok: true, value: true }
    } catch (error) {
      if (error instanceof TypeError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: false, reason: 'invalid-path' }
      }
      return { ok: false, reason: 'internal', detail: String(error) }
    }
  }

  /**
   * Live status of a bound canonical path. String comparison against the
   * registry list — resolveByPath rejects when the directory is gone, which is
   * exactly the state being probed.
   */
  status(canonicalPath: string): { directoryExists: boolean; registered: boolean } {
    if (canonicalPath === '') return { directoryExists: false, registered: false }
    let directoryExists = false
    try {
      directoryExists = statSync(canonicalPath, { throwIfNoEntry: false })?.isDirectory() ?? false
    } catch {
      directoryExists = false
    }
    let registered = false
    const registry = this.#registry
    if (registry !== undefined) {
      try {
        registered = registry.list().some((workspace) => workspace.path === canonicalPath)
      } catch {
        registered = false
      }
    }
    return { directoryExists, registered }
  }
}

/** Default suggestion for the setup dialog — host-computed, the client never
 * needs to know $DSH_HOME. */
export function suggestWorkspacePath(title: string, id: string): string {
  return dshHomePath('skyaxis', 'workspaces', workspaceSlug(title, id))
}
