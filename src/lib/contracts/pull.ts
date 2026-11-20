import { z } from 'zod'
import { STORAGE_PERSIST_STATUS } from './enums'
import { ReleaseBlockSchema } from './release'

const LAST_ERROR_CODE_RE = /^[A-Z][A-Z0-9_]{1,39}$/
const LAST_ERROR_REF_RE = /^[A-Za-z0-9._-]{1,64}$/
const SEMVER_APP_RE = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export const FeedCursorSchema = z
  .object({
    version: z.number().int().nonnegative(),
    id: z.uuid(),
  })
  .strict()
export type FeedCursorWire = z.infer<typeof FeedCursorSchema>

export const FeedRowSchema = z.object({
  entity: z.string().min(1),
  op: z.enum(['upsert', 'delete']),
  id: z.uuid(),
  version: z.number().int().nonnegative(),
  row: z.record(z.string(), z.unknown()).optional(),
})
export type FeedRowWire = z.infer<typeof FeedRowSchema>

export const DeviceReportSchema = z
  .object({
    push_ok: z.boolean(),
    pending_count: z.number().int().min(0),
    oldest_pending_at: z.iso.datetime().nullable(),
    attention_count: z.number().int().min(0),
    storage_persist: z.enum(STORAGE_PERSIST_STATUS),
    storage_used_pct: z.number().int().min(0).max(100).nullable(),
    last_error_code: z
      .union([z.string().regex(LAST_ERROR_CODE_RE), z.null()])
      .optional()
      .transform((v) => v ?? null)
      .catch(null),
    last_error_ref: z
      .union([z.string().regex(LAST_ERROR_REF_RE), z.null()])
      .optional()
      .transform((v) => v ?? null)
      .catch(null),
    clock_offset_ms: z.number().int().nullable(),
    app_version: z
      .union([z.string().max(30).regex(SEMVER_APP_RE), z.null()])
      .optional()
      .transform((v) => v ?? null)
      .catch(null),
    schema_version: z.number().int().positive().nullable().catch(null),
    sync_protocol_version: z.number().int().positive().nullable().catch(null),
  })
  .strict()
export type DeviceReport = z.infer<typeof DeviceReportSchema>

export const PullCycleInputSchema = z
  .object({
    id: z.string().min(1).max(64),
    upper: z.number().int().nonnegative(),
  })
  .strict()
export type PullCycleInput = z.infer<typeof PullCycleInputSchema>

export const PullRequest = z
  .object({
    cursor: FeedCursorSchema.nullable(),
    cycle: PullCycleInputSchema.nullable(),
    page_size: z.number().int().min(1).max(500).default(500),
    attention_ids: z.array(z.uuid()).max(100).default([]),
    report: DeviceReportSchema.optional(),
  })
  .strict()
export type PullRequest = z.infer<typeof PullRequest>

export const PullCommandUpdateSchema = z.object({
  id: z.uuid(),
  status: z.string().min(1),
})
export type PullCommandUpdate = z.infer<typeof PullCommandUpdateSchema>

export const PullManifestSchema = z.object({
  counts: z.record(z.string(), z.number().int().nonnegative()),
})
export type PullManifest = z.infer<typeof PullManifestSchema>

export const PullResyncRequiredResponse = z.object({
  full_resync_required: z.literal(true),
  reason: z.enum(['CURSOR_BELOW_FLOOR', 'SCHEMA_INCOMPATIBLE']),
})

export const PullPageSuccessResponse = z.object({
  server_time: z.iso.datetime(),
  upper: z.number().int().nonnegative(),
  tombstone_floor: z.number().int().nonnegative(),
  rows: z.array(FeedRowSchema),
  next_cursor: FeedCursorSchema.nullable(),
  has_more: z.boolean(),
  max_schema_version: z.number().int().positive(),
  release: ReleaseBlockSchema.nullable(),
  command_updates: z.array(PullCommandUpdateSchema).optional(),
  manifest: PullManifestSchema.optional(),
})

export const PullResponse = z.union([PullResyncRequiredResponse, PullPageSuccessResponse])
export type PullResponse = z.infer<typeof PullResponse>

export const FullStartRequest = z
  .object({
    report: DeviceReportSchema.optional(),
  })
  .strict()
export type FullStartRequest = z.infer<typeof FullStartRequest>

export const FullStartResponse = z.object({
  snapshot_version: z.number().int().nonnegative(),
  tombstone_floor: z.number().int().nonnegative(),
  manifest: PullManifestSchema,
  snapshot_token: z.string().min(1),
  entities: z.array(z.string().min(1)),
})
export type FullStartResponse = z.infer<typeof FullStartResponse>

export const FullPageRequest = z
  .object({
    snapshot_token: z.string().min(1).max(1024),
    entity: z.string().min(1).max(80),
    after_id: z.uuid().nullable(),
    page_size: z.number().int().min(1).max(500).default(500),
  })
  .strict()
export type FullPageRequest = z.infer<typeof FullPageRequest>

export const FullPageResponse = z.object({
  rows: z.array(FeedRowSchema),
  next_after_id: z.uuid().nullable(),
  has_more: z.boolean(),
})
export type FullPageResponse = z.infer<typeof FullPageResponse>
