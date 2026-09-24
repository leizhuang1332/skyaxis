/**
 * Repos-pool host-side zod schemas: the storage read boundary and the
 * endpoint request-body boundary. The inferred types are asserted mutually
 * assignable with the hand-written protocol types — the two halves cannot
 * drift without a type error.
 */
import { z } from 'zod'
import type {
  RepoRecord,
  RepoStatus,
  SaveRequestBody,
  SaveValidation,
  UrlRejection,
} from '../repos-pool-shared/protocol.js'

export const RepoRecordSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(64),
  url: z.string().min(1).max(2048),
  description: z.string().max(2000).default(''),
  status: z.enum(['verified', 'unverified', 'forced-network', 'forced-auth']),
  validatedAt: z.iso.datetime({ offset: true }).nullable(),
  lastError: z.string().max(500).nullable(),
})

export const ReposFileSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  repos: z.array(RepoRecordSchema),
})

export type ReposFile = z.infer<typeof ReposFileSchema>

const SaveRepoInputSchema = z.object({
  /** Present = edit, absent = create. */
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(64),
  url: z.string().trim().min(1).max(2048),
  description: z.string().max(2000).default(''),
})

const SaveValidationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('verified') }),
  z.object({ kind: z.literal('unverified') }),
  z.object({ kind: z.literal('forced'), from: z.enum(['network', 'auth']) }),
  z.object({ kind: z.literal('unchanged') }),
])

export const SaveRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  repo: SaveRepoInputSchema,
  validation: SaveValidationSchema,
})

export const RemoveRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  id: z.uuid(),
})

export const ValidateRequestSchema = z.object({
  url: z.string().min(1).max(2048),
})

// ---------------------------------------------------------------------------
// Compile-time alignment with the shared protocol (drift = type error)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-unused-vars */
type _ProtocolRepoRecordAssignableToSchema = RepoRecord extends z.infer<typeof RepoRecordSchema> ? true : never
type _SchemaRepoRecordAssignableToProtocol = z.infer<typeof RepoRecordSchema> extends RepoRecord ? true : never
type _SaveValidationAligned = SaveValidation extends z.infer<typeof SaveValidationSchema> ? true : never
type _SaveRequestAligned = SaveRequestBody extends z.infer<typeof SaveRequestSchema> ? true : never

/** Re-exported so host modules consume the protocol unions under one import. */
export type HostUrlRejection = UrlRejection
export type HostRepoStatus = RepoStatus
