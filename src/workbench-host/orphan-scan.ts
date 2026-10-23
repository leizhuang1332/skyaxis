/**
 * Workbench artifact reconciliation scan (decisions/0005 细化④): a fixed-depth
 * walk of the frozen v1 layout template (workbench/<requirementId>/{plans,
 * reviews}, one file level each — the scanPrdDocs precedent, recursive only
 * in the sense of two known subdirectories) joined against the ledger's
 * conventional references.
 *
 * Three faces:
 *  - orphans: on disk, unreferenced by the ledger. This is where the D6
 *    revival window converges — an in-flight artifact write that recreates
 *    an already-cascaded directory lands here, visible and collectable.
 *  - missing: in the ledger, absent on disk — the global dangling-reference
 *    ledger (the per-requirement fileExists rows are the single-record view).
 *  - trash: .trash/ directory listing, the manual-restore support face.
 *
 * Boundary note (the 0002 read-path boundary): this scan NEVER reports
 * workbench records whose requirementId is absent from requirements.yaml —
 * that judgment would require reading a foreign ledger; the join stays
 * client-side forever. A live-directory deleted-record.yaml is cascade
 * bookkeeping, not user data — skipped, never reported as an unknown orphan
 * (it exists exactly in the crash window between tombstone write and the
 * rename step).
 *
 * Scanning is best-effort throughout: a missing root is an empty listing,
 * a failing segment omits its rows, nothing here ever throws.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkbenchRecord, WorkbenchScanRow, WorkbenchTrashRow } from '../workbench-shared/protocol.js'
import { workspacePlanPath, workspaceReviewPath } from './artifact-path.js'

const TRASH_DIR_NAME = '.trash'
const TOMBSTONE_FILE_NAME = 'deleted-record.yaml'
/** 0032: the record shard living beside its plans/reviews — layout, not residue. */
const RECORD_FILE_NAME = 'record.yaml'
const PLANS_DIR_NAME = 'plans'
const REVIEWS_DIR_NAME = 'reviews'
const PLAN_FILE_RE = /^(WP[1-9]\d*)-v([1-9]\d*)\.md$/
const REVIEW_FILE_RE = /^([A-Za-z0-9-]{1,64})\.md$/
const REQUIREMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface WorkbenchScanResult {
  readonly orphans: readonly WorkbenchScanRow[]
  readonly missing: readonly WorkbenchScanRow[]
  readonly trash: readonly WorkbenchTrashRow[]
}

/** \u0000-joined — no legitimate id character collides with the separator. */
function planKey(requirementId: string, workPackageId: string, version: number): string {
  return `${requirementId}\u0000${workPackageId}\u0000${version}`
}

function reviewKey(requirementId: string, reviewId: string): string {
  return `${requirementId}\u0000${reviewId}`
}

/**
 * 0028 D2-A / 0029 一并改道: `resolveWorkspaceReview` is the OPTIONAL
 * bound-workspace resolver (the endpoint's services.resolveWorkspacePath
 * face — '' = unbound), consulted by BOTH the review and plan missing
 * checks. A body is MISSING only when it is in NEITHER channel (plugin
 * store nor workspace `.skyaxis/reviews|plans/`); the orphan face stays
 * plugin-store-only (the workspace channel is the user's domain — none of
 * the family's files are scanned), and a legacy-path file whose id sits in
 * the ledger remains legit even when the workspace copy exists too (the
 * lazy migration never deletes the legacy copy).
 */
export function scanWorkbenchArtifacts(
  root: string,
  records: readonly WorkbenchRecord[],
  resolveWorkspaceReview?: (requirementId: string) => string,
  /**
   * 0032: requirement ids whose record shard exists but will not load — the
   * endpoint passes the list face's degradedRows. Their directories are
   * skipped ENTIRELY: with the ledger face unreadable, the refs are
   * unknowable and every file would report as an orphan (noise, not signal
   * — the requirement's reconciliation returns once the shard is repaired).
   */
  skipRequirementIds?: ReadonlySet<string>,
): WorkbenchScanResult {
  const planRefs = new Set<string>()
  const reviewRefs = new Set<string>()
  for (const record of records) {
    for (const workPackage of record.workPackages) {
      for (const plan of workPackage.plans) {
        planRefs.add(planKey(record.requirementId, workPackage.id, plan.version))
      }
    }
    for (const report of record.reviewReports) {
      reviewRefs.add(reviewKey(record.requirementId, report.id))
    }
  }

  const orphans: WorkbenchScanRow[] = []
  const onDiskPlanKeys = new Set<string>()
  const onDiskReviewKeys = new Set<string>()

  const rootStat = statSync(root, { throwIfNoEntry: false })
  if (rootStat?.isDirectory() === true) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === TRASH_DIR_NAME || entry.name.startsWith('.')) continue
      const requirementId = entry.name
      if (skipRequirementIds?.has(requirementId) === true) continue
      const dirPath = join(root, requirementId)
      scanConventionDir(join(dirPath, PLANS_DIR_NAME), (name) => {
        const match = PLAN_FILE_RE.exec(name)
        if (match === null) {
          orphans.push({ requirementId, kind: 'unknown', name })
          return
        }
        const key = planKey(requirementId, match[1], Number(match[2]))
        onDiskPlanKeys.add(key)
        if (!planRefs.has(key)) orphans.push({ requirementId, kind: 'plan', workPackageId: match[1], version: Number(match[2]) })
      })
      scanConventionDir(join(dirPath, REVIEWS_DIR_NAME), (name) => {
        const match = REVIEW_FILE_RE.exec(name)
        if (match === null) {
          orphans.push({ requirementId, kind: 'unknown', name })
          return
        }
        const key = reviewKey(requirementId, match[1])
        onDiskReviewKeys.add(key)
        if (!reviewRefs.has(key)) orphans.push({ requirementId, kind: 'review', reviewId: match[1] })
      })
      // Files directly under <requirementId>/ are off-layout by definition.
      // The tombstone is cascade bookkeeping and the record shard (plus its
      // steady-state .bak, 0032) is layout — skipped; anything else is
      // reported so the listing never silently swallows disk content.
      scanConventionDir(dirPath, (name) => {
        if (name === TOMBSTONE_FILE_NAME || name === RECORD_FILE_NAME || name === `${RECORD_FILE_NAME}.bak`) return
        orphans.push({ requirementId, kind: 'unknown', name })
      })
    }
  }

  const missing: WorkbenchScanRow[] = []
  for (const record of records) {
    const workspaceRoot = resolveWorkspaceReview !== undefined ? resolveWorkspaceReview(record.requirementId) : ''
    for (const workPackage of record.workPackages) {
      for (const plan of workPackage.plans) {
        if (onDiskPlanKeys.has(planKey(record.requirementId, workPackage.id, plan.version))) continue
        // 0029 一并改道: neither-channel check — a workspace-channel body is
        // not missing just because the plugin store lacks it.
        if (workspaceRoot !== '' && existsSync(workspacePlanPath(workspaceRoot, record.requirementId, workPackage.id, plan.version))) continue
        missing.push({ requirementId: record.requirementId, kind: 'plan', workPackageId: workPackage.id, version: plan.version })
      }
    }
    for (const report of record.reviewReports) {
      if (onDiskReviewKeys.has(reviewKey(record.requirementId, report.id))) continue
      // 0028 D2-A: neither-channel check — a workspace-channel body (bound
      // requirement) is not missing just because the plugin store lacks it.
      if (workspaceRoot !== '' && existsSync(workspaceReviewPath(workspaceRoot, record.requirementId, report.id))) continue
      missing.push({ requirementId: record.requirementId, kind: 'review', reviewId: report.id })
    }
  }

  const trash = scanTrash(join(root, TRASH_DIR_NAME))

  const byRequirementThenName = (a: WorkbenchScanRow, b: WorkbenchScanRow) =>
    (a.requirementId < b.requirementId ? -1 : a.requirementId > b.requirementId ? 1 : (a.name ?? '') < (b.name ?? '') ? -1 : 1)
  orphans.sort(byRequirementThenName)
  missing.sort(byRequirementThenName)
  return { orphans, missing, trash }
}

/** One best-effort directory listing: a failing segment omits its rows. */
function scanConventionDir(dirPath: string, consume: (name: string) => void): void {
  try {
    const stat = statSync(dirPath, { throwIfNoEntry: false })
    if (stat?.isDirectory() !== true) return
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      consume(entry.name)
    }
  } catch {
    // "a fact that cannot be read is a missing fact" — the scan never fails.
  }
}

function scanTrash(trashPath: string): readonly WorkbenchTrashRow[] {
  const rows: WorkbenchTrashRow[] = []
  try {
    const stat = statSync(trashPath, { throwIfNoEntry: false })
    if (stat?.isDirectory() !== true) return rows
    for (const entry of readdirSync(trashPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const name = entry.name
      // Layout: <uuid>-<sanitized ISO timestamp>. Non-conforming names are
      // skipped — the trash face lists recognizable archives only (a junk
      // directory someone put in .trash is out of scope for v1).
      if (name.length > 36 && REQUIREMENT_ID_RE.test(name.slice(0, 36)) && name[36] === '-') {
        rows.push({ requirementId: name.slice(0, 36), deletedAt: name.slice(37) })
      }
    }
    rows.sort((a, b) => (a.requirementId < b.requirementId ? -1 : a.requirementId > b.requirementId ? 1 : 0))
  } catch {
    // Best-effort listing.
  }
  return rows
}
