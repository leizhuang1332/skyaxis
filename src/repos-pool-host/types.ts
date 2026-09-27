/**
 * Repos-pool host-side zod schemas: the storage read boundary and the
 * endpoint request-body boundary. The inferred types are asserted mutually
 * assignable with the hand-written protocol types — the two halves cannot
 * drift without a type error.
 *
 * Dual-address shape per decision 0004 / D1+D2:
 *  - Storage boundary: url slots are stored verbatim (min(1), no trim, no
 *    blank normalization) — migration must be able to preserve legacy
 *    syntax-illegal URLs as-is (D3: format conversion is not content
 *    review). A YAML `null` counts as an absent key (hand-edited
 *    `urlSsh:` means "no ssh address", not a corrupted file).
 *  - Request boundary: blank input is normalized to "not provided" — the
 *    same semantics as import rule 4 (empty values never overwrite).
 */
import { z } from 'zod'
import type {
  AddressSlot,
  ImportRequestBody,
  RepoRecord,
  RepoStatus,
  SaveRequestBody,
  SaveValidation,
  UrlRejection,
} from '../repos-pool-shared/protocol.js'

/** A YAML null in an optional slot field means "key absent", not a parse error. */
function nullAsMissing<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (v === null ? undefined : v), schema)
}

const RepoStatusSchema = z.enum(['verified', 'unverified', 'forced-network', 'forced-auth'])

/** Storage url slot: verbatim string, presence is the intent (D2). */
const StoredUrlSchema = nullAsMissing(z.string().min(1).max(2048).optional())

const SLOTS: readonly { slot: AddressSlot; suffix: 'Ssh' | 'Http' }[] = [
  { slot: 'ssh', suffix: 'Ssh' },
  { slot: 'http', suffix: 'Http' },
]

/**
 * Per-slot invariant "state quadruple exists ⟺ url slot exists", with issues
 * pointing at the specific field (superRefine, so degraded details stay
 * actionable). `null` counts as present for validatedAt/lastError.
 */
function slotQuadrupleRefine(ctx: z.RefinementCtx, data: Record<string, unknown>, suffix: 'Ssh' | 'Http'): void {
  const url = data[`url${suffix}`]
  const stateFields = [`status${suffix}`, `validatedAt${suffix}`, `lastError${suffix}`] as const
  if (url === undefined) {
    for (const field of stateFields) {
      if (data[field] !== undefined) {
        ctx.addIssue({ code: 'custom', path: [field], message: `url${suffix} 缺失，状态字段不可单独存在（四件套必须与槽位共存）` })
      }
    }
    return
  }
  for (const field of stateFields) {
    if (data[field] === undefined) {
      ctx.addIssue({ code: 'custom', path: [field], message: `url${suffix} 存在，状态四件套缺失` })
    }
  }
}

export const RepoRecordSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(64),
  urlSsh: StoredUrlSchema,
  urlHttp: StoredUrlSchema,
  description: z.string().max(2000).default(''),
  statusSsh: nullAsMissing(RepoStatusSchema.optional()),
  statusHttp: nullAsMissing(RepoStatusSchema.optional()),
  validatedAtSsh: z.iso.datetime({ offset: true }).nullish(),
  validatedAtHttp: z.iso.datetime({ offset: true }).nullish(),
  lastErrorSsh: z.string().max(500).nullish(),
  lastErrorHttp: z.string().max(500).nullish(),
}).superRefine((data, ctx) => {
  if (data.urlSsh === undefined && data.urlHttp === undefined) {
    ctx.addIssue({ code: 'custom', path: ['urlSsh'], message: '至少配置一个地址（ssh 或 http）' })
  }
  for (const { suffix } of SLOTS) slotQuadrupleRefine(ctx, data as unknown as Record<string, unknown>, suffix)
})

export const ReposFileSchema = z.object({
  version: z.literal(2),
  revision: z.number().int().nonnegative(),
  repos: z.array(RepoRecordSchema),
})

export type ReposFile = z.infer<typeof ReposFileSchema>

/** Request url slot: blank input (whitespace-only) counts as "not provided". */
const InputUrlSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim().length === 0 ? undefined : v),
  z.string().trim().min(1).max(2048).optional(),
)

const SaveRepoInputSchema = z.object({
  /** Present = edit, absent = create. */
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(64),
  urlSsh: InputUrlSchema,
  urlHttp: InputUrlSchema,
  description: z.string().max(2000).default(''),
})

const SaveVerdictSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('verified') }),
  z.object({ kind: z.literal('unverified') }),
  z.object({ kind: z.literal('forced'), from: z.enum(['network', 'auth', 'unknown']) }),
  z.object({ kind: z.literal('unchanged') }),
])

/** strict: an unknown slot key (e.g. ftp) is a 400, never silently stripped. */
const SaveValidationSchema = z.strictObject({
  ssh: SaveVerdictSchema.optional(),
  http: SaveVerdictSchema.optional(),
})

export const SaveRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  repo: SaveRepoInputSchema,
  validation: SaveValidationSchema,
}).superRefine((data, ctx) => {
  // Decision 0004 / D2: the validation key set equals the request's address
  // slot set (a slot present on one side only is a malformed request).
  const slots: AddressSlot[] = []
  if (data.repo.urlSsh !== undefined) slots.push('ssh')
  if (data.repo.urlHttp !== undefined) slots.push('http')
  const verdicts = Object.keys(data.validation) as AddressSlot[]
  const same = slots.length === verdicts.length && slots.every((slot) => verdicts.includes(slot))
  if (!same) {
    ctx.addIssue({ code: 'custom', path: ['validation'], message: 'validation 键集必须等于请求中的地址槽位集' })
  }
})

export const RemoveRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  id: z.uuid(),
})

export const ValidateRequestSchema = z.object({
  url: z.string().min(1).max(2048),
})

export const ImportRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  dryRun: z.boolean().optional(),
  content: z.string().min(1),
})

// ---------------------------------------------------------------------------
// Compile-time alignment with the shared protocol (drift = type error)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-unused-vars */
type _ProtocolRepoRecordAssignableToSchema = RepoRecord extends z.infer<typeof RepoRecordSchema> ? true : never
type _SchemaRepoRecordAssignableToProtocol = z.infer<typeof RepoRecordSchema> extends RepoRecord ? true : never
type _SaveValidationAligned = SaveValidation extends z.infer<typeof SaveValidationSchema> ? true : never
type _SaveRequestAligned = SaveRequestBody extends z.infer<typeof SaveRequestSchema> ? true : never
type _ImportRequestAligned = ImportRequestBody extends z.infer<typeof ImportRequestSchema> ? true : never

/** Re-exported so host modules consume the protocol unions under one import. */
export type HostUrlRejection = UrlRejection
export type HostRepoStatus = RepoStatus
