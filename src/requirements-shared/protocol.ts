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

/** One linked pool repository — an intent declaration, never clone state. */
export interface LinkedRepo {
  /** Pool-side RepoRecord id; the client joins the live pool list by it. */
  readonly repoId: string
  /** Branch created (checkout -b) after cloning. */
  readonly branch: string
}

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
  /**
   * Linked pool repositories (intent only — clone runtime state lives in the
   * host's in-memory task registry, never in this ledger). Maintained by the
   * repos endpoints; edits through the save form carry the previous value over.
   */
  readonly linkedRepos: readonly LinkedRepo[]
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
// Linked repositories / clone flow (P3b)
// ---------------------------------------------------------------------------

/**
 * Link carries a repo SNAPSHOT (url/name) from the client: the requirements
 * host never reads repos.yaml — the two stores hold no state over each other
 * (the 0002 boundary). Ids stay the join key.
 */
export interface ReposLinkRequest {
  readonly expectedRevision: number
  readonly id: string
  readonly action: 'link'
  readonly repoId: string
  readonly repoUrl: string
  readonly repoName: string
  readonly branch: string
}

export interface ReposUnlinkRequest {
  readonly expectedRevision: number
  readonly id: string
  readonly action: 'unlink'
  readonly repoId: string
  /**
   * Pool repo name snapshot for locating the cloned directory (dirName is
   * derived at request time). Absent when the pool row was already removed —
   * the directory is then left in place (deletable by hand).
   */
  readonly repoName?: string
}

/**
 * Adopt (reverse-link): write the ledger row for a directory that ALREADY sits
 * under the workspace's repos/ — no clone is spawned. Like link, the request
 * carries a repo name SNAPSHOT (the destination dirName derives from it); the
 * branch is NOT client-supplied — the host reads it from the repo's .git/HEAD
 * at adopt time (the scan's value is display-only, never an input).
 */
export interface ReposAdoptRequest {
  readonly expectedRevision: number
  readonly id: string
  readonly action: 'adopt'
  readonly repoId: string
  readonly repoName: string
}

/** Re-clone keeps the ledgered branch and writes no ledger row — no revision. */
export interface ReposRecloneRequest {
  readonly id: string
  readonly action: 'reclone'
  readonly repoId: string
  readonly repoUrl: string
  readonly repoName: string
}

/** Addressed by (requirement, repo) — the UI row IS the link; no taskId on the wire. */
export interface ReposCancelRequest {
  readonly id: string
  readonly action: 'cancel'
  readonly repoId: string
}

export type ReposMutateRequestBody =
  | ReposLinkRequest
  | ReposUnlinkRequest
  | ReposAdoptRequest
  | ReposRecloneRequest
  | ReposCancelRequest

export type CloneFailureClass =
  | 'auth'
  | 'network'
  | 'git-missing'
  | 'bad-branch'
  | 'dest-exists'
  | 'aborted'
  | 'unknown'

/** Browser-safe clone task row (the host SessionJob shape, minus the push channel). */
export interface CloneTaskSnapshot {
  readonly taskId: string
  readonly repoId: string
  readonly repoName: string
  readonly branch: string
  readonly status: 'cloning' | 'branching' | 'done' | 'failed'
  /** 0-100, present while cloning when a progress line was parsed. */
  readonly progressPct?: number
  readonly failureClass?: CloneFailureClass
  /** First substantive stderr line on failure, capped. */
  readonly detail?: string
  readonly startedAt: number
  readonly finishedAt?: number
}

export interface ReposTasksResponseOk {
  readonly ok: true
  readonly tasks: readonly CloneTaskSnapshot[]
}

// ---------------------------------------------------------------------------
// repos/ directory scan (reverse-link discovery) — the host reports RAW
// directory facts only; which dir belongs to which POOL repo is a client-side
// join (the requirements host never reads repos.yaml, the 0002 boundary).
// ---------------------------------------------------------------------------

/** One subdirectory of the workspace's repos/, as the host sees it. */
export interface RepoDirScanRow {
  /** Directory name — the join key against client-derived repoDirName(). */
  readonly name: string
  /** A .git entry exists (directory, or a worktree/submodule gitdir file). */
  readonly isGitRepo: boolean
  /** Current branch from .git/HEAD ("ref: refs/heads/X"); absent when the
   * repo is on a detached HEAD or HEAD is unreadable — such rows cannot be
   * adopted (the ledger row needs a branch). */
  readonly branch?: string
  /** origin url from .git/config when present — a disambiguator the client
   * uses when derived dirNames collide across pool repos. */
  readonly remoteUrl?: string
}

export interface ReposScanResponseOk {
  readonly ok: true
  readonly dirs: readonly RepoDirScanRow[]
}

// ---------------------------------------------------------------------------
// PRD documents (P3c) — the prds/ directory IS the source of truth (scanned,
// never ledgered); every successful endpoint answers with the fresh listing.
// ---------------------------------------------------------------------------

export interface PrdDocSummary {
  readonly name: string
  readonly size: number
  /** File mtime, epoch ms. */
  readonly modifiedAt: number
}

export type PrdMutateRequestBody =
  | { readonly id: string; readonly action: 'create'; readonly name: string; readonly content: string }
  | { readonly id: string; readonly action: 'delete'; readonly name: string }

export interface PrdDocsResponseOk {
  readonly ok: true
  readonly docs: readonly PrdDocSummary[]
}

// ---------------------------------------------------------------------------
// Route paths (host registers, browser calls — one source of truth)
// ---------------------------------------------------------------------------

export const REQUIREMENTS_LIST_PATH = '/api/skyaxis/requirements'
export const REQUIREMENTS_SAVE_PATH = '/api/skyaxis/requirements/save'
export const REQUIREMENTS_REMOVE_PATH = '/api/skyaxis/requirements/remove'
export const REQUIREMENTS_WORKSPACE_PATH = '/api/skyaxis/requirements/workspace'
export const REQUIREMENTS_REPOS_PATH = '/api/skyaxis/requirements/repos'
export const REQUIREMENTS_PRDS_PATH = '/api/skyaxis/requirements/prds'
export const REQUIREMENTS_PRD_UPLOAD_PATH = '/api/skyaxis/requirements/prd-upload'

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
    | 'no-workspace'
    | 'dest-exists'
    | 'dest-missing'
    | 'no-branch'
    | 'busy'
    | 'too-many'
    | 'invalid-branch'
    | 'git-missing'
    | 'duplicate-name'
    | 'too-large'
    | 'bad-content-type'
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
    && Array.isArray(r.linkedRepos) && r.linkedRepos.every(isLinkedRepo)
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

function isLinkedRepo(v: unknown): v is LinkedRepo {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return isString(r.repoId) && r.repoId.length > 0 && isString(r.branch) && r.branch.length > 0
}

const CLONE_STATUSES = ['cloning', 'branching', 'done', 'failed']
const CLONE_FAILURE_CLASSES = ['auth', 'network', 'git-missing', 'bad-branch', 'dest-exists', 'aborted', 'unknown']

export function isCloneTaskSnapshot(v: unknown): v is CloneTaskSnapshot {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.taskId) && r.taskId.length > 0
    && isString(r.repoId) && r.repoId.length > 0
    && isString(r.repoName)
    && isString(r.branch)
    && isString(r.status) && CLONE_STATUSES.includes(r.status)
    && (r.progressPct === undefined || typeof r.progressPct === 'number')
    && (r.failureClass === undefined || (isString(r.failureClass) && CLONE_FAILURE_CLASSES.includes(r.failureClass)))
    && (r.detail === undefined || isString(r.detail))
    && typeof r.startedAt === 'number'
    && (r.finishedAt === undefined || typeof r.finishedAt === 'number')
  )
}

export function isReposTasksResponse(v: unknown): v is ReposTasksResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return r.ok === true && Array.isArray(r.tasks) && r.tasks.every(isCloneTaskSnapshot)
}

function isRepoDirScanRow(v: unknown): v is RepoDirScanRow {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    isString(r.name) && r.name.length > 0
    && typeof r.isGitRepo === 'boolean'
    && (r.branch === undefined || isString(r.branch))
    && (r.remoteUrl === undefined || isString(r.remoteUrl))
  )
}

export function isReposScanResponse(v: unknown): v is ReposScanResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return r.ok === true && Array.isArray(r.dirs) && r.dirs.every(isRepoDirScanRow)
}

export function isPrdDocSummary(v: unknown): v is PrdDocSummary {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return isString(r.name) && r.name.length > 0 && typeof r.size === 'number' && typeof r.modifiedAt === 'number'
}

export function isPrdDocsResponse(v: unknown): v is PrdDocsResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return r.ok === true && Array.isArray(r.docs) && r.docs.every(isPrdDocSummary)
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
