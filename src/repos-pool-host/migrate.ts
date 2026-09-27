/**
 * repos.yaml v1 → v2 migration (decision 0004 / D3): the read-side
 * compatibility layer between the single-url era (decision 0003) and the
 * dual-address per-address-state shape.
 *
 * Principles, all load-bearing:
 *  - Format conversion is NOT content review. A legacy url the whitelist
 *    would reject (hand-edited file://, whitespace, scheme-less path — the
 *    v1 storage boundary never ran checkUrlSyntax) is preserved verbatim in
 *    the http slot together with its state. Migration never drops a record
 *    and never bricks the file over one odd row; legality resurfaces on
 *    that record's next save/validate.
 *  - Total function: nothing here throws. zod 4 propagates a throw from
 *    inside a transform straight out of safeParse, which would pierce
 *    ReposFileStore.load()'s never-throws contract — so parseReposFile is
 *    written throw-free and repos-file.ts still belt-and-braces it.
 *  - Dispatch on the version VALUE first, never a z.union guess: merged
 *    union issues would surface "Expected 2, received 1" noise instead of
 *    the actually-broken field.
 *  - The file-level revision is preserved verbatim — bumping it here would
 *    409-storm every concurrently open panel across the upgrade.
 */
import { z } from 'zod'
import type { RepoRecord } from '../repos-pool-shared/protocol.js'
import { checkUrlSyntax } from '../repos-pool-shared/url-syntax.js'
import { ReposFileSchema, type ReposFile } from './types.js'

// ---------------------------------------------------------------------------
// v1 shapes (decision 0003 era, verbatim)
// ---------------------------------------------------------------------------

const V1RepoRecordSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(64),
  url: z.string().min(1).max(2048),
  description: z.string().max(2000).default(''),
  status: z.enum(['verified', 'unverified', 'forced-network', 'forced-auth']),
  validatedAt: z.iso.datetime({ offset: true }).nullable(),
  lastError: z.string().max(500).nullable(),
})

const V1FileSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  repos: z.array(V1RepoRecordSchema),
})

type V1RepoRecord = z.infer<typeof V1RepoRecordSchema>

// ---------------------------------------------------------------------------
// Record migration
// ---------------------------------------------------------------------------

/** Slot by value: kind decides the slot (ssh/scp → ssh, https/http → http). */
export function migrateRecord(v1: V1RepoRecord): RepoRecord {
  const syntax = checkUrlSyntax(v1.url)
  const toSsh = syntax.acceptable && (syntax.kind === 'ssh' || syntax.kind === 'scp')
  if (toSsh) {
    return {
      id: v1.id,
      name: v1.name,
      description: v1.description,
      urlSsh: v1.url,
      statusSsh: v1.status,
      validatedAtSsh: v1.validatedAt,
      lastErrorSsh: v1.lastError,
    }
  }
  // http family, or a syntax-illegal legacy url preserved as-is (see header).
  return {
    id: v1.id,
    name: v1.name,
    description: v1.description,
    urlHttp: v1.url,
    statusHttp: v1.status,
    validatedAtHttp: v1.validatedAt,
    lastErrorHttp: v1.lastError,
  }
}

// ---------------------------------------------------------------------------
// File-level parse + dispatch
// ---------------------------------------------------------------------------

export type ParseReposFileResult =
  | { ok: true; value: ReposFile }
  | { ok: false; degraded: true; reason: 'schema'; detail: string }

function schemaFailure(error: z.ZodError, prefix?: string): ParseReposFileResult {
  const first = error.issues[0]
  const detail = first ? `${first.path.join('.')}: ${first.message}` : 'schema mismatch'
  return { ok: false, degraded: true, reason: 'schema', detail: prefix ? `${prefix}: ${detail}` : detail }
}

/**
 * Validates an already-YAML-parsed document as either repos.yaml version,
 * migrating v1 in memory. Throws never (see header); the caller still wraps
 * the call to honor load()'s never-throws contract defensively.
 */
export function parseReposFile(raw: unknown): ParseReposFileResult {
  if (typeof raw !== 'object' || raw === null || !('version' in raw)) {
    return { ok: false, degraded: true, reason: 'schema', detail: 'version: 缺少 version 字段' }
  }
  const version = (raw as { version: unknown }).version

  if (version === 2) {
    const checked = ReposFileSchema.safeParse(raw)
    return checked.success ? { ok: true, value: checked.data } : schemaFailure(checked.error)
  }

  if (version === 1) {
    const legacy = V1FileSchema.safeParse(raw)
    if (!legacy.success) return schemaFailure(legacy.error)
    const migrated = {
      version: 2 as const,
      revision: legacy.data.revision,
      repos: legacy.data.repos.map(migrateRecord),
    }
    // Re-validate the migration product: a migration bug must surface as a
    // flagged degrade, never as a silently mis-shaped file on disk. The
    // prefix keeps "migration bug" distinguishable from "broken legacy row"
    // in the degraded banner.
    const rechecked = ReposFileSchema.safeParse(migrated)
    return rechecked.success ? { ok: true, value: rechecked.data } : schemaFailure(rechecked.error, 'v1→v2 复验')
  }

  return { ok: false, degraded: true, reason: 'schema', detail: `version: 未知版本 ${JSON.stringify(version)}` }
}
