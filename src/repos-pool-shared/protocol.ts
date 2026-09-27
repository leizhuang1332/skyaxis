/**
 * Repos-pool wire protocol shared by both plugin halves.
 *
 * Zero dependencies by design: the browser bundle inlines this file, so no
 * zod, no node builtins. The host half re-declares the same shapes as zod
 * schemas (repos-pool-host/types.ts) with a compile-time mutual-assignability
 * assertion — drift between the two is a type error, not a runtime surprise.
 *
 * Browser-side response validation uses the hand-written type guards at the
 * bottom (the official client precedent: manual guards over zod, keeping the
 * client bundle lean).
 */

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/**
 * Persistented validation status. There is deliberately no 'invalid' value:
 * an illegitimate URL has no path into the store (hard-rejected before save),
 * so it can never be a persisted state.
 */
export type RepoStatus = 'verified' | 'unverified' | 'forced-network' | 'forced-auth'

/** The two address slots a repo may carry (decision 0004 / D1). */
export type AddressSlot = 'ssh' | 'http'

/**
 * A repository record with per-address state (decision 0004 / D1/D2):
 *  - `urlSsh`/`urlHttp` are independently optional, but at least one is
 *    present (enforced by the host schema's refine).
 *  - Each address carries its own state quadruple (status/validatedAt/
 *    lastError); the quadruple exists ⟺ the matching url slot exists.
 *  - Wire semantics: an absent url field means "this address is not
 *    configured" — on edit, dropping the field removes the address together
 *    with its state (field presence IS the intent, no 'removed' enum).
 */
export interface RepoRecord {
  /** uuid, minted host-side on create. */
  readonly id: string
  readonly name: string
  /** SSH-family address (ssh:// scheme or scp shorthand). */
  readonly urlSsh?: string
  /** HTTP(S)-family address. */
  readonly urlHttp?: string
  readonly description: string
  readonly statusSsh?: RepoStatus
  readonly statusHttp?: RepoStatus
  /** ISO 8601 timestamp of the slot's last reachability verdict; null when never verified. */
  readonly validatedAtSsh?: string | null
  readonly validatedAtHttp?: string | null
  /** Short stderr excerpt of the slot's last failure (display-only); null when none. */
  readonly lastErrorSsh?: string | null
  readonly lastErrorHttp?: string | null
}

// ---------------------------------------------------------------------------
// URL legality (decision 0003 / D2)
// ---------------------------------------------------------------------------

export type UrlRejection =
  | 'empty'
  | 'too-long'
  /** Any scheme outside the {https, http, ssh} whitelist: file://, ext::, fd::, git+ssh… */
  | 'scheme-forbidden'
  /** No scheme and not a host:path shape: local/relative/Windows-drive paths. */
  | 'no-scheme-local-path'
  /** Contains ':' but the host segment is not an FQDN/IPv4 — local-path ambiguity. */
  | 'scp-ambiguous'
  /** user:pass@ embedded in the URL. */
  | 'embedded-credentials'
  | 'malformed-url'

export type UrlKind = 'https' | 'http' | 'ssh' | 'scp'

export type UrlSyntax =
  | { readonly acceptable: true; readonly kind: UrlKind }
  | { readonly acceptable: false; readonly reason: UrlRejection }

// ---------------------------------------------------------------------------
// Reachability (P0 PoC-1 classifier)
// ---------------------------------------------------------------------------

/** 'unverified' means the probe was skipped (git missing / service absent — decision D3). */
export type ReachabilityClass = 'reachable' | 'auth' | 'network' | 'unknown' | 'unverified'

export interface ValidateOutcome {
  readonly syntax: UrlSyntax
  /** Absent when the syntax verdict alone ends the check. */
  readonly reachability?: {
    readonly classification: ReachabilityClass
    readonly reason?: 'git-missing' | 'no-service'
    /** stderr first line (warning lines stripped), capped — display-only diagnostics. */
    readonly detail?: string
  }
}

// ---------------------------------------------------------------------------
// Save flow
// ---------------------------------------------------------------------------

/** The client-reached validation conclusion for one address slot. */
export type SaveVerdict =
  | { readonly kind: 'verified' }
  | { readonly kind: 'unverified' }
  /** Decision D4 as amended 2026-09-24: every non-reachable class is user-decidable, unknown included. */
  | { readonly kind: 'forced'; readonly from: 'network' | 'auth' | 'unknown' }
  /** Edit with an unchanged address: the host keeps the slot's existing state quadruple. */
  | { readonly kind: 'unchanged' }

/**
 * Per-address save conclusions (decision 0004 / D2): the key set equals the
 * set of address slots present in the request repo.* — a slot present on one
 * side but missing on the other is a malformed request (400 host-side).
 */
export interface SaveValidation {
  readonly ssh?: SaveVerdict
  readonly http?: SaveVerdict
}

export interface SaveRequestBody {
  readonly expectedRevision: number
  readonly repo: {
    /** Present = edit, absent = create. */
    readonly id?: string
    readonly name: string
    readonly urlSsh?: string
    readonly urlHttp?: string
    readonly description: string
  }
  readonly validation: SaveValidation
}

export interface RemoveRequestBody {
  readonly expectedRevision: number
  readonly id: string
}

// ---------------------------------------------------------------------------
// Route paths (host registers, browser calls — one source of truth)
// ---------------------------------------------------------------------------

export const REPOS_LIST_PATH = '/api/skyaxis/repos'
export const REPOS_VALIDATE_PATH = '/api/skyaxis/repos/validate'
export const REPOS_SAVE_PATH = '/api/skyaxis/repos/save'
export const REPOS_REMOVE_PATH = '/api/skyaxis/repos/remove'

// ---------------------------------------------------------------------------
// Wire envelopes
// ---------------------------------------------------------------------------

export interface ListResponseOk {
  readonly ok: true
  readonly revision: number
  readonly repos: readonly RepoRecord[]
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
  readonly repo: RepoRecord
}

export interface RemoveResponseOk {
  readonly ok: true
  readonly revision: number
}

/** Error body for 4xx/5xx responses (validate/save/remove). */
export interface ErrorResponse {
  readonly ok: false
  readonly code:
    | 'bad-request'
    | 'invalid-url'
    | 'duplicate-url'
    | 'not-found'
    | 'conflict'
    | 'unreadable-file'
    | 'internal'
  readonly reason?: UrlRejection
  /** Which address slot a 422 invalid-url verdict refers to (decision 0004 / D4). */
  readonly field?: AddressSlot
  readonly currentRevision?: number
  readonly repos?: readonly RepoRecord[]
}

// ---------------------------------------------------------------------------
// Hand-written type guards (browser side)
// ---------------------------------------------------------------------------

const REPO_STATUSES: readonly string[] = ['verified', 'unverified', 'forced-network', 'forced-auth']

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

/**
 * One address slot's quadruple: absent url ⇒ absent state (all undefined);
 * present url ⇒ non-empty string plus a well-formed state quadruple.
 */
function addressSlotOk(url: unknown, status: unknown, validatedAt: unknown, lastError: unknown): boolean {
  if (url === undefined) {
    return status === undefined && validatedAt === undefined && lastError === undefined
  }
  if (!isString(url) || url.length === 0) return false
  return (
    isString(status) && REPO_STATUSES.includes(status)
    && (validatedAt === null || isString(validatedAt))
    && (lastError === null || isString(lastError))
  )
}

export function isRepoRecord(v: unknown): v is RepoRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  const sshOk = addressSlotOk(r.urlSsh, r.statusSsh, r.validatedAtSsh, r.lastErrorSsh)
  const httpOk = addressSlotOk(r.urlHttp, r.statusHttp, r.validatedAtHttp, r.lastErrorHttp)
  const hasAddress = (isString(r.urlSsh) && r.urlSsh.length > 0) || (isString(r.urlHttp) && r.urlHttp.length > 0)
  return (
    isString(r.id) && r.id.length > 0
    && isString(r.name) && r.name.length > 0
    && isString(r.description)
    && sshOk && httpOk && hasAddress
  )
}

export function isListResponse(v: unknown): v is ListResponse {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (r.ok === true) {
    return typeof r.revision === 'number' && Array.isArray(r.repos) && r.repos.every(isRepoRecord)
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
  return r.ok === true && typeof r.revision === 'number' && isRepoRecord(r.repo)
}

export function isRemoveResponseOk(v: unknown): v is RemoveResponseOk {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return r.ok === true && typeof r.revision === 'number'
}

export function isErrorResponse(v: unknown): v is ErrorResponse {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    r.ok === false
    && isString(r.code)
    && (r.currentRevision === undefined || typeof r.currentRevision === 'number')
    && (r.repos === undefined || (Array.isArray(r.repos) && r.repos.every(isRepoRecord)))
  )
}

/** Validate responses carry business results (including rejections) with HTTP 200; the body IS the outcome. */
export function isValidateResponse(v: unknown): v is { ok: true } & ValidateOutcome {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (r.ok !== true) return false
  const syntax = r.syntax
  if (typeof syntax !== 'object' || syntax === null) return false
  const s = syntax as Record<string, unknown>
  if (s.acceptable === true) {
    if (!(s.kind === 'https' || s.kind === 'http' || s.kind === 'ssh' || s.kind === 'scp')) return false
  } else if (s.acceptable !== false || !isString(s.reason)) {
    return false
  }
  if (r.reachability !== undefined) {
    if (typeof r.reachability !== 'object' || r.reachability === null) return false
    const g = r.reachability as Record<string, unknown>
    if (!isString(g.classification)) return false
  }
  return true
}
