/**
 * Workbench artifact document locations (0006 P1b) — the host-side pure
 * functions behind decisions/0005 细化①②: every plan/review file path is
 * DERIVED here from (requirementId, workPackageId, version / reviewId), so the
 * wire and the ledger never carry a path. Layout template, frozen at v1:
 *
 *   <root>/<requirementId>/plans/<workPackageId>-v<version>.md
 *   <root>/<requirementId>/reviews/<reviewId>.md
 *   <root>/<requirementId>/                 (requirementArtifactDir)
 *   trash NAME: <requirementId>-<ISO timestamp, ':' → '-'>   (D6 cascade;
 *     colons are illegal in Windows directory names)
 *
 * A template change is a BREAKING migration — every stored ledger reference
 * and contentHash points through these conventions — and must revise ADR
 * 0005 first, never reshuffle silently.
 *
 * The browser NEVER imports this file: node:path lives here on purpose, and
 * the browser half consumes ids and existence rows (workbench-shared/
 * protocol.ts), never paths. Every variable segment is re-asserted
 * immediately before the join — defense layer 2, per 细化②「防 wire 被绕过/
 * 字段来源变化」: layer 1 is the narrow wire guard in the protocol (its
 * predicates are imported here, so the two layers cannot drift), and a
 * bypassed guard or a changed field source fails loudly at this seam
 * instead of writing outside the workbench root.
 */
import { join } from 'node:path'
import { isWorkPackageId, isPlanVersion, isReviewId } from '../workbench-shared/protocol.js'

/**
 * requirementId gate — host artifact directories are named by uuid only.
 * Lowercase hex: host-side randomUUID() never mints uppercase, and a
 * case-alias would fork the directory tree.
 */
const REQUIREMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Windows-forbidden filename characters plus ASCII control characters. */
const WINDOWS_ILLEGAL_RE = /[/\\:*?"<>|\u0000-\u001f]/

/** ISO 8601 date + 'T' prefix — the shape `new Date().toISOString()` always has. */
const ISO_TIMESTAMP_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T/

function reject(field: string, value: unknown, why: string): never {
  throw new Error(
    `artifact-path: ${field} rejected (${why}) — defense layer 2: wire guard bypassed or field source changed`
      + ` (decisions/0005 细化②): ${JSON.stringify(String(value))}`,
  )
}

function assertRequirementId(requirementId: string): void {
  if (!REQUIREMENT_ID_RE.test(requirementId)) {
    reject('requirementId', requirementId, 'not a lowercase uuid')
  }
}

function assertWorkPackageId(workPackageId: string): void {
  if (!isWorkPackageId(workPackageId)) {
    reject('workPackageId', workPackageId, 'not a WP<positive-integer> id (no leading zero)')
  }
}

function assertPlanVersion(version: number): void {
  if (!isPlanVersion(version)) {
    reject('version', version, 'not a positive integer (host-assigned)')
  }
}

function assertReviewId(reviewId: string): void {
  if (!isReviewId(reviewId)) {
    reject('reviewId', reviewId, 'not a 1-64 [A-Za-z0-9-] token')
  }
}

/** Plan markdown for one workPackage version — plans/<workPackageId>-v<version>.md. */
export function planDocPath(root: string, requirementId: string, workPackageId: string, version: number): string {
  assertRequirementId(requirementId)
  assertWorkPackageId(workPackageId)
  assertPlanVersion(version)
  return join(root, requirementId, 'plans', `${workPackageId}-v${version}.md`)
}

/** Review report markdown — reviews/<reviewId>.md. */
export function reviewDocPath(root: string, requirementId: string, reviewId: string): string {
  assertRequirementId(requirementId)
  assertReviewId(reviewId)
  return join(root, requirementId, 'reviews', `${reviewId}.md`)
}

/**
 * Analysis report file (文件交付轮, decisions/0007) — `<workspaceRoot>/
 * .skyaxis/analysis/<requirementId>.md`. NOTE the root here is the bound
 * WORKSPACE, not workbenchRoot: this is the one artifact the SESSION writes
 * (its reachable domain is the workspace cwd), delivered to the workbench
 * through the prescribed path rather than plugin-authored storage — the
 * ledger holds the seeded state, never a reference to this file. The
 * relative-segment convention is the shared one-truth helper
 * analysisReportRelPath (workbench-shared/protocol.ts); this join re-asserts
 * the uuid gate as defense layer 2 (layer 1 = the shared helper's own gate).
 */
export function analysisReportPath(workspaceRoot: string, requirementId: string): string {
  assertRequirementId(requirementId)
  return join(workspaceRoot, '.skyaxis', 'analysis', `${requirementId}.md`)
}

/** The per-requirement artifact root; plans/ and reviews/ live under it. */
export function requirementArtifactDir(root: string, requirementId: string): string {
  assertRequirementId(requirementId)
  return join(root, requirementId)
}

/**
 * The .trash directory NAME for a D6 cascade rename. ISO 8601 colons are
 * illegal in Windows directory names, so they fold to '-' (length- and
 * order-preserving, parseable back). The prefix gate keeps an arbitrary
 * string from riding in as a directory name; the post-fold scan keeps the
 * timestamp tail from carrying a separator or a Windows-illegal character.
 */
export function trashDirName(requirementId: string, isoTimestamp: string): string {
  assertRequirementId(requirementId)
  if (!ISO_TIMESTAMP_PREFIX_RE.test(isoTimestamp)) {
    reject('isoTimestamp', isoTimestamp, 'not an ISO 8601 date+T prefix')
  }
  const folded = isoTimestamp.replaceAll(':', '-')
  if (WINDOWS_ILLEGAL_RE.test(folded)) {
    reject('isoTimestamp', isoTimestamp, 'Windows-illegal character after colon folding')
  }
  return `${requirementId}-${folded}`
}
