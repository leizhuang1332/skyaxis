/**
 * Requirements host-side zod schemas: the storage read boundary and the
 * endpoint request-body boundary. The inferred types are asserted mutually
 * assignable with the hand-written protocol types — the two halves cannot
 * drift without a type error.
 */
import { z } from 'zod'
import type {
  RequirementRecord,
  ReposMutateRequestBody,
  SaveRequestBody,
  WorkspaceSetRequestBody,
} from '../requirements-shared/protocol.js'

export const RequirementRecordSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(64),
  description: z.string().max(2000).default(''),
  // default keeps legacy yaml files (pre-P3a) readable instead of degraded.
  workspacePath: z.string().default(''),
  // default keeps legacy yaml files (pre-P3b) readable instead of degraded.
  linkedRepos: z.array(z.object({
    repoId: z.uuid(),
    branch: z.string().trim().min(1).max(100),
  })).default([]),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const RequirementsFileSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  requirements: z.array(RequirementRecordSchema),
})

/** Parse output, with the protocol's readonly array face (records are shared immutable). */
export type RequirementsFile = Omit<z.infer<typeof RequirementsFileSchema>, 'requirements'> & {
  requirements: readonly RequirementRecord[]
}

const SaveRequirementInputSchema = z.object({
  /** Present = edit, absent = create. */
  id: z.uuid().optional(),
  title: z.string().trim().min(1).max(64),
  description: z.string().max(2000).default(''),
})

export const SaveRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  requirement: SaveRequirementInputSchema,
})

export const RemoveRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  id: z.uuid(),
})

const WorkspaceSetSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  id: z.uuid(),
  action: z.literal('set'),
  path: z.string().trim().min(1).max(4096),
})

const WorkspaceClearSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  id: z.uuid(),
  action: z.literal('clear'),
  path: z.string().optional(),
})

const WorkspaceRebindSchema = z.object({
  id: z.uuid(),
  action: z.literal('rebind'),
})

export const WorkspaceRequestSchema = z.discriminatedUnion('action', [WorkspaceSetSchema, WorkspaceClearSchema, WorkspaceRebindSchema])

// P3b: linked repositories. Branch gets a wire-level sanity guard only —
// `git check-ref-format --branch` in the host preflight is the authority.
const ReposLinkSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  id: z.uuid(),
  action: z.literal('link'),
  repoId: z.uuid(),
  repoUrl: z.string().trim().min(1).max(2048),
  repoName: z.string().trim().min(1).max(64),
  branch: z.string().trim().min(1).max(100).regex(/^[^\x00-\x1f^-]/, 'no control chars, no leading dash'),
})

const ReposUnlinkSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  id: z.uuid(),
  action: z.literal('unlink'),
  repoId: z.uuid(),
  repoName: z.string().trim().min(1).max(64).optional(),
})

const ReposRecloneSchema = z.object({
  id: z.uuid(),
  action: z.literal('reclone'),
  repoId: z.uuid(),
  repoUrl: z.string().trim().min(1).max(2048),
  repoName: z.string().trim().min(1).max(64),
})

const ReposCancelSchema = z.object({
  id: z.uuid(),
  action: z.literal('cancel'),
  repoId: z.uuid(),
})

export const ReposRequestSchema = z.discriminatedUnion('action', [ReposLinkSchema, ReposUnlinkSchema, ReposRecloneSchema, ReposCancelSchema])

// ---------------------------------------------------------------------------
// Compile-time alignment with the shared protocol (drift = type error)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-unused-vars */
type _ProtocolRequirementRecordAssignableToSchema = RequirementRecord extends z.infer<typeof RequirementRecordSchema> ? true : never
type _SchemaRequirementRecordAssignableToProtocol = z.infer<typeof RequirementRecordSchema> extends RequirementRecord ? true : never
type _SaveRequestAligned = SaveRequestBody extends z.infer<typeof SaveRequestSchema> ? true : never
type _WorkspaceRequestAligned = WorkspaceSetRequestBody extends z.infer<typeof WorkspaceRequestSchema> ? true : never
type _ReposRequestAligned = ReposMutateRequestBody extends z.infer<typeof ReposRequestSchema> ? true : never
