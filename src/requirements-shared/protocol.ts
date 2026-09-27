/**
 * Requirements wire protocol shared by both plugin halves.
 *
 * Zero dependencies by design: the browser bundle inlines this file, so no
 * zod, no node builtins. The host half re-declares the same shapes as zod
 * schemas (requirements-host/types.ts) with a compile-time mutual-
 * assignability assertion — drift between the two is a type error, not a
 * runtime surprise.
 *
 * Browser-side response validation uses the hand-written type guards at the
 * bottom (the official client precedent: manual guards over zod, keeping the
 * client bundle lean).
 */

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface RequirementRecord {
  /** uuid, minted host-side on create. */
  readonly id: string
  readonly title: string
  readonly description: string
  /**
   * Bound workspace directory as a canonical (realpath) host path; '' = unbound.
   * Stores the path, never a workspaceId: re-adding the same directory after a
   * workspace delete mints a fresh uuid, while the path stays a stable join key.
   * Maintained by the workspace endpoints only — edits through the save form
   * carry the previous value over unchanged.
   */
  readonly workspacePath: string
  /** ISO 8601 timestamp of record creation; carried over unchanged on edits. */
  readonly createdAt: string
  /** ISO 8601 timestamp of the last edit (equals createdAt on creation). */
  readonly updatedAt: string
}

// ---------------------------------------------------------------------------
// Save / remove flow
// ---------------------------------------------------------------------------

export interface SaveRequestBody {
  readonly expectedRevision: number
  readonly requirement: {
    /** Present = edit, absent = create. */
    readonly id?: string
    readonly title: string
    readonly description: string
  }
}

export interface RemoveRequestBody {
  readonly expectedRevision: number
  readonly id: string
}

// ---------------------------------------------------------------------------
// Workspace binding flow (P3a)
// ---------------------------------------------------------------------------

export interface WorkspaceSetRequest {
  readonly expectedRevision: number
  readonly id: string
  readonly action: 'set'
  readonly path: string
}

export interface WorkspaceClearRequest {
  readonly expectedRevision: number
  readonly id: string
  readonly action: 'clear'
}

/**
 * Recreate the host workspace registration for the already-bound path
 * (the registry row may have been deleted host-side — deletion never
 * touches the directory or this ledger). No ledger write, no revision
 * bump: nothing about the record changes.
 */
export interface WorkspaceRebindRequest {
  readonly id: string
  readonly action: 'rebind'
}

export type WorkspaceSetRequestBody = WorkspaceSetRequest | WorkspaceClearRequest | WorkspaceRebindRequest

// ---------------------------------------------------------------------------
// Route paths (host registers, browser calls — one source of truth)
// ---------------------------------------------------------------------------

export const REQUIREMENTS_LIST_PATH = '/api/skyaxis/requirements'
export const REQUIREMENTS_SAVE_PATH = '/api/skyaxis/requirements/save'
export const REQUIREMENTS_REMOVE_PATH = '/api/skyaxis/requirements/remove'
export const REQUIREMENTS_WORKSPACE_PATH = '/api/skyaxis/requirements/workspace'

// ---------------------------------------------------------------------------
// Wire envelopes
// ---------------------------------------------------------------------------

export interface ListResponseOk {
  readonly ok: true
  readonly revision: number
  readonly requirements: readonly RequirementRecord[]
}

export interface ListResponseDegraded {
  readonly ok: false
  readonly degraded: true
  readonly reason: 'parse' | 'schema' | 'io'
  readonly hasBackup: boolean
}

export type ListResponse = ListResponseOk | ListResponseDegraded

export interface SaveResponseOk {
  readonly ok: true
  readonly revision: number
  readonly requirement: RequirementRecord
}

export interface RemoveResponseOk {
  readonly ok: true
  readonly revision: number
}

/** Set/clear success envelope — same shape as SaveResponseOk. */
export type WorkspaceSetResponseOk = SaveResponseOk

/** GET workspace status payload (also answers for unbound records). */
export interface WorkspaceStatusResponseOk {
  readonly ok: true
  readonly bound: boolean
  /** Bound canonical path; '' when unbound. */
  readonly path: string
  /** Whether the bound directory still exists on the host filesystem. */
  readonly directoryExists: boolean
  /** Whether the bound path is registered in the host workspace registry. */
  readonly registered: boolean
  /** Host-computed default suggestion for the setup dialog ($DSH_HOME based). */
  readonly suggestedPath: string
}

/** Error body for 4xx/5xx responses (save/remove/workspace). */
export interface ErrorResponse {
  readonly ok: false
  readonly code:
    | 'bad-request'
    | 'invalid-path'
    | 'not-found'
    | 'conflict'
    | 'unreadable-file'
    | 'internal'
  readonly currentRevision?: number
  readonly requirements?: readonly RequirementRecord[]
}

// ---------------------------------------------------------------------------
// Hand-written type guards (browser side)
// ---------------------------------------------------------------------------

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

export function isRequirementRecord(v: unknown): v is RequirementRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.id) && r.id.length > 0
    && isString(r.title) && r.title.length > 0
    && isString(r.description)
    && isString(r.workspacePath)
    && isString(r.createdAt) && r.createdAt.length > 0
    && isString(r.updatedAt) && r.updatedAt.length > 0
  )
}

export function isListResponse(v: unknown): v is ListResponse {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (r.ok === true) {
    return typeof r.revision === 'number' && Array.isArray(r.requirements) && r.requirements.every(isRequirementRecord)
  }
  return (
    r.ok === false && r.degraded === true
    && (r.reason === 'parse' || r.reason === 'schema' || r.reason === 'io')
    && typeof r.hasBackup === 'boolean'
  )
}

export function isSaveResponseOk(v: unknown): v is SaveResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return r.ok === true && typeof r.revision === 'number' && isRequirementRecord(r.requirement)
}

export function isRemoveResponseOk(v: unknown): v is RemoveResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return r.ok === true && typeof r.revision === 'number'
}

export function isWorkspaceStatusResponse(v: unknown): v is WorkspaceStatusResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    r.ok === true
    && typeof r.bound === 'boolean'
    && isString(r.path)
    && typeof r.directoryExists === 'boolean'
    && typeof r.registered === 'boolean'
    && isString(r.suggestedPath)
  )
}

export function isErrorResponse(v: unknown): v is ErrorResponse {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    r.ok === false
    && isString(r.code)
    && (r.currentRevision === undefined || typeof r.currentRevision === 'number')
    && (r.requirements === undefined || (Array.isArray(r.requirements) && r.requirements.every(isRequirementRecord)))
  )
}
