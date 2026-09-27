/**
 * Import pipeline pure functions (decision 0004 / D5+D6): file content is
 * normalized into entries, then merged onto the current snapshot under the
 * four merge rules (create missing / fill absent slots / overwrite changed
 * slots / never touch anything with a blank value).
 *
 * Layer split (each layer distrusts the one above):
 *  - normalizeImportEntries: SHAPE only — kebab/camel spellings, v1-style
 *    single-url rows (re-slotted via checkUrlSyntax+slotOfKind, NOT via
 *    migrateRecord whose required-status signature would silently drop
 *    hand-written minimal rows), name/description limits, empty-urls.
 *  - mergeImportEntries: LEGALITY + MERGE — re-runs checkUrlSyntax on every
 *    provided address unconditionally (never trust normalized output; this
 *    is also what stops a D3-migrated illegal URL from reaching the store),
 *    slots by value, skips on slot conflicts / duplicates / ambiguous names,
 *    and applies the merge on an ACCUMULATING view (an earlier entry of the
 *    same batch is visible to later entries: same-name rows apply in order,
 *    address clashes against batch-minted records are duplicates).
 *
 * Change detection = slot change ∪ description change; a value-identical
 * row counts unchanged (re-importing the same file must not write).
 * New/overwritten slots always carry the explicit three-key unverified
 * quadruple — byte-identical to what the save route's slotState produces,
 * so the write-then-reload invariant holds for imports too.
 */
import { randomUUID } from 'node:crypto'
import type { ImportSkipped, RepoRecord } from '../repos-pool-shared/protocol.js'
import { checkUrlSyntax } from '../repos-pool-shared/url-syntax.js'
import { slotOfKind } from '../repos-pool-shared/address.js'
import type { UrlRejection } from '../repos-pool-shared/protocol.js'

/**
 * Business cap on import content, in UTF-16 code units (content.length).
 * This bounds what YAML.parse has to chew on and rejects absurd files
 * early — it is NOT the process memory fence; the carrier bridge's own
 * buffered-body cap (300MB) is.
 */
export const IMPORT_MAX_CONTENT_CHARS = 2_000_000

const MAX_NAME = 64
const MAX_DESCRIPTION = 2000

/** Normalized import entry — internal shape both layers and tests speak. */
export interface ImportEntry {
  readonly name: string
  readonly urlSsh?: string
  readonly urlHttp?: string
  readonly description?: string
}

export type NormalizeResult =
  | { ok: true; entries: readonly ImportEntry[]; skipped: readonly ImportSkipped[] }
  /** Whole-file rejection (not a document at all) — the endpoint answers 400. */
  | { ok: false; rejected: true }

// ---------------------------------------------------------------------------
// Layer 1: shape normalization
// ---------------------------------------------------------------------------

function reportName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  return trimmed.length > MAX_NAME ? trimmed.slice(0, MAX_NAME) : trimmed
}

/** Blank/missing → undefined (import rule 4: blank never overwrites anything). */
function addressValue(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/**
 * One row → entry or a skip record. Accepts kebab (`url-ssh`) and camel
 * (`urlSsh`) spellings on either document shape; a v1-style string `url` key
 * wins and the slot keys are ignored (v1 semantics take precedence; files
 * mixing both forms for one row are the author's problem to keep coherent).
 */
function normalizeRow(row: unknown): { entry?: ImportEntry; skipped?: ImportSkipped } {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    return { skipped: { name: '', reason: 'invalid-name' } }
  }
  const r = row as Record<string, unknown>

  let name = ''
  if (typeof r.name === 'string') {
    const trimmed = r.name.trim()
    if (trimmed.length === 0 || trimmed.length > MAX_NAME) {
      return { skipped: { name: reportName(r.name), reason: 'invalid-name' } }
    }
    name = trimmed
  } else {
    return { skipped: { name: '', reason: 'invalid-name' } }
  }

  let description: string | undefined
  if (typeof r.description === 'string') {
    const trimmed = r.description.trim()
    if (trimmed.length > MAX_DESCRIPTION) {
      return { skipped: { name, reason: 'invalid-description' } }
    }
    description = trimmed.length === 0 ? undefined : trimmed
  }

  const skipped = (reason: ImportSkipped['reason'], detail?: string): { skipped: ImportSkipped } => ({ skipped: { name, reason, ...(detail !== undefined ? { detail } : {}) } })

  let urlSsh: string | undefined
  let urlHttp: string | undefined

  if (typeof r.url === 'string') {
    // v1-style row: slot by value. An illegal url cannot be slotted, so it is
    // rejected here with the syntax reason (merge would reject it anyway).
    const value = addressValue(r.url)
    if (value === undefined) return { skipped: { name, reason: 'empty-urls' } }
    const syntax = checkUrlSyntax(value)
    if (!syntax.acceptable) return skipped('invalid-url', syntax.reason)
    const slot = slotOfKind(syntax.kind)
    if (slot === 'ssh') urlSsh = value
    else urlHttp = value
  } else {
    // Slot keys: kebab and camel spellings both accepted; same-slot spellings
    // must agree (disagreeing values are a slot conflict).
    for (const [slot, kebab, camel] of [['ssh', 'url-ssh', 'urlSsh'], ['http', 'url-http', 'urlHttp']] as const) {
      const viaKebab = addressValue(r[kebab])
      const viaCamel = addressValue(r[camel])
      if (viaKebab !== undefined && viaCamel !== undefined && viaKebab !== viaCamel) {
        return skipped('slot-conflict', `url-${slot} 与 ${camel} 值不一致`)
      }
      const value = viaKebab ?? viaCamel
      if (slot === 'ssh') urlSsh = value
      else urlHttp = value
    }
  }

  if (urlSsh === undefined && urlHttp === undefined) {
    return { skipped: { name, reason: 'empty-urls' } }
  }
  return { entry: { name, ...(urlSsh !== undefined ? { urlSsh } : {}), ...(urlHttp !== undefined ? { urlHttp } : {}), ...(description !== undefined ? { description } : {}) } }
}

/**
 * Dispatches an already-YAML-parsed document by shape: top-level array =
 * JSON entry list; object with an array `repos` = full repos.yaml-style file
 * (header ignored; rows may mix v1 and v2 shapes). Anything else — scalars,
 * `repos: "x"`, multi-document sources — rejects the whole file.
 */
export function normalizeImportEntries(parsed: unknown): NormalizeResult {
  let rows: readonly unknown[]
  if (Array.isArray(parsed)) {
    rows = parsed
  } else if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { repos?: unknown }).repos)) {
    rows = (parsed as { repos: unknown[] }).repos
  } else {
    return { ok: false, rejected: true }
  }

  const entries: ImportEntry[] = []
  const skipped: ImportSkipped[] = []
  for (const row of rows) {
    const result = normalizeRow(row)
    if (result.entry !== undefined) entries.push(result.entry)
    if (result.skipped !== undefined) skipped.push(result.skipped)
  }
  return { ok: true, entries, skipped }
}

// ---------------------------------------------------------------------------
// Layer 2: legality + merge
// ---------------------------------------------------------------------------

/** Mutable working copy of RepoRecord (the protocol type is fully readonly). */
type MutableRepo = { -readonly [K in keyof RepoRecord]: RepoRecord[K] }

/** The explicit three-key unverified quadruple — byte-identical to save-route output. */
function unverifiedQuadruple(): { status: 'unverified'; validatedAt: null; lastError: null } {
  return { status: 'unverified', validatedAt: null, lastError: null }
}

export interface MergeOptions {
  /** Injectable id factory — tests pin deterministic ids (dry-run previews are not commit ids). */
  mintId?: () => string
}

export interface MergeOutcome {
  readonly nextRepos: readonly RepoRecord[]
  readonly created: number
  readonly updated: number
  readonly unchanged: number
  readonly skipped: readonly ImportSkipped[]
}

/**
 * Merge pipeline per entry (order is load-bearing): syntax → slot-by-value →
 * slot conflict → duplicate → merge. Duplicates compare against every
 * DIFFERENT-name record of the accumulating view (batch-minted records
 * included); same-name records are exempt so a value-identical row is a
 * no-op, not a self-duplicate.
 */
export function mergeImportEntries(
  currentRepos: readonly RepoRecord[],
  entries: readonly ImportEntry[],
  options: MergeOptions = {},
): MergeOutcome {
  const mintId = options.mintId ?? randomUUID
  const nextRepos: MutableRepo[] = currentRepos.map((repo) => ({ ...repo }))
  const skipped: ImportSkipped[] = []
  let created = 0
  let updated = 0
  let unchanged = 0

  for (const entry of entries) {
    // 1. Syntax (unconditional — normalized output is not trusted) + 2. slot by value.
    const placed: { ssh?: string; http?: string } = {}
    let rejection: UrlRejection | undefined
    let provided = 0
    for (const [slot, value] of [['ssh', entry.urlSsh], ['http', entry.urlHttp]] as const) {
      if (value === undefined) continue
      provided += 1
      const syntax = checkUrlSyntax(value)
      if (!syntax.acceptable) {
        rejection = syntax.reason
        break
      }
      placed[slotOfKind(syntax.kind)] = value
    }
    if (rejection !== undefined) {
      skipped.push({ name: entry.name, reason: 'invalid-url', detail: rejection })
      continue
    }
    // 3. Slot conflict: two same-family values collapsed onto one slot.
    if (Object.keys(placed).length < provided) {
      skipped.push({ name: entry.name, reason: 'slot-conflict', detail: '两个地址同族，归位后争抢同一槽位' })
      continue
    }

    // 4. Duplicate: any provided address equals any address of a different-name record.
    const addresses = Object.values(placed) as string[]
    const duplicate = nextRepos.some(
      (repo) => repo.name !== entry.name
        && ((repo.urlSsh !== undefined && addresses.includes(repo.urlSsh))
          || (repo.urlHttp !== undefined && addresses.includes(repo.urlHttp))),
    )
    if (duplicate) {
      skipped.push({ name: entry.name, reason: 'duplicate-url' })
      continue
    }

    // 5. Merge on the accumulating view.
    const matches = nextRepos.filter((repo) => repo.name === entry.name)
    if (matches.length > 1) {
      skipped.push({ name: entry.name, reason: 'ambiguous-name' })
      continue
    }

    if (matches.length === 0) {
      const quadruple = unverifiedQuadruple()
      nextRepos.push({
        id: mintId(),
        name: entry.name,
        description: entry.description ?? '',
        ...(placed.ssh !== undefined ? { urlSsh: placed.ssh, statusSsh: quadruple.status, validatedAtSsh: quadruple.validatedAt, lastErrorSsh: quadruple.lastError } : {}),
        ...(placed.http !== undefined ? { urlHttp: placed.http, statusHttp: quadruple.status, validatedAtHttp: quadruple.validatedAt, lastErrorHttp: quadruple.lastError } : {}),
      })
      created += 1
      continue
    }

    const previous = matches[0]
    const next: MutableRepo = { ...previous }
    let changed = false
    for (const [slot, suffix] of [['ssh', 'Ssh'], ['http', 'Http']] as const) {
      const value = placed[slot]
      if (value === undefined) continue
      const prevUrl = slot === 'ssh' ? previous.urlSsh : previous.urlHttp
      if (prevUrl === value) continue // rule 4 no-op: identical value never rewrites
      const quadruple = unverifiedQuadruple()
      if (slot === 'ssh') {
        next.urlSsh = value
        next.statusSsh = quadruple.status
        next.validatedAtSsh = quadruple.validatedAt
        next.lastErrorSsh = quadruple.lastError
      } else {
        next.urlHttp = value
        next.statusHttp = quadruple.status
        next.validatedAtHttp = quadruple.validatedAt
        next.lastErrorHttp = quadruple.lastError
      }
      changed = true
    }
    if (entry.description !== undefined && entry.description !== previous.description) {
      next.description = entry.description
      changed = true
    }
    if (changed) {
      nextRepos[nextRepos.indexOf(previous)] = next
      updated += 1
    } else {
      unchanged += 1
    }
  }

  return { nextRepos, created, updated, unchanged, skipped }
}
