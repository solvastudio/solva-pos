import { z } from 'zod'
import {
  BILL_HANDOVER_STATUS,
  BILL_ITEM_STATUS,
  BILL_SPLIT_MODE,
  BILL_STATUS,
  DISCOUNT_TYPE,
  PRICE_SOURCE,
  STORAGE_PERSIST_STATUS,
} from './enums'
import { ReleaseBlockSchema } from './release'
import { zMoney, zMoneyNonNeg, zUuid } from './primitives'

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
    /** Etag of the last stock snapshot the client received; `null`/absent = none yet. */
    stock_etag: z.string().regex(/^[0-9a-f]{16}$/).nullable().optional(),
    /** Etag of the last open-bills snapshot the client received; `null`/absent = none yet. */
    bills_etag: z.string().regex(/^[0-9a-f]{16}$/).nullable().optional(),
  })
  .strict()
export type PullRequest = z.infer<typeof PullRequest>

export const PullCommandUpdateSchema = z.object({
  id: z.uuid(),
  status: z.string().min(1),
  reason_class: z.enum(['TRANSIENT', 'STRUCTURAL', 'AUTHORIZATION', 'SCHEMA']).optional(),
  reason_code: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
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

/** Outlet stock snapshot (class P; BR-STK-005). Sent only on the last page and when the etag changes. */
export const StockSnapshotBlockSchema = z.object({
  etag: z.string().regex(/^[0-9a-f]{16}$/),
  as_of_server_time: z.iso.datetime(),
  acked_device_seq: z.number().int().nonnegative(),
  rows: z.array(z.object({ sku_id: z.uuid(), qty: z.string().regex(/^-?\d+(\.\d{1,4})?$/) }).strict()),
})
export type StockSnapshotBlock = z.infer<typeof StockSnapshotBlockSchema>

export const BillSnapshotModifierSchema = z
  .object({
    modifier_id: zUuid,
    name: z.string().min(1).max(60),
    price_delta: zMoney,
    qty: z.number().int().min(1),
  })
  .strict()
export type BillSnapshotModifier = z.infer<typeof BillSnapshotModifierSchema>

export const BillSnapshotItemSchema = z
  .object({
    id: zUuid,
    line_no: z.number().int().positive(),
    product_id: zUuid.nullable().optional(),
    sku_id: zUuid,
    uom_id: zUuid,
    sku_code: z.string().min(1).max(64),
    item_name: z.string().min(1).max(200),
    uom_code: z.string().min(1).max(32),
    qty: z.string().min(1),
    conversion_factor: z.string().min(1),
    unit_price: zMoneyNonNeg,
    price_source: z.enum(PRICE_SOURCE),
    is_open_price: z.boolean(),
    taxable: z.boolean(),
    discount_type: z.enum(DISCOUNT_TYPE).nullable(),
    discount_pct: z.string().nullable(),
    discount_input: zMoneyNonNeg.nullable(),
    discount_approved_by: zUuid.nullable(),
    note: z.string().nullable(),
    status: z.enum(BILL_ITEM_STATUS),
    void_reason_text: z.string().nullable().optional(),
    created_event_id: zUuid.optional(),
    modifiers: z.array(BillSnapshotModifierSchema),
  })
  .strict()
export type BillSnapshotItem = z.infer<typeof BillSnapshotItemSchema>

export const BillSnapshotRowSchema = z
  .object({
    bill_id: zUuid,
    table_id: zUuid,
    bill_ref: z.string().min(1).max(30),
    status: z.enum(BILL_STATUS),
    lease_device_id: zUuid,
    lease_register_id: zUuid,
    is_awaiting_payment: z.boolean(),
    handover_status: z.enum(BILL_HANDOVER_STATUS),
    handover_target_register_id: zUuid.nullable(),
    last_event_seq: z.number().int().nonnegative(),
    last_event_at: z.iso.datetime().nullable(),
    bill_discount_type: z.enum(DISCOUNT_TYPE).nullable(),
    bill_discount_pct: z.string().nullable(),
    bill_discount_input: zMoneyNonNeg.nullable(),
    bill_discount_approved_by: zUuid.nullable(),
    customer_name: z.string().nullable(),
    split_mode: z.enum(BILL_SPLIT_MODE).nullable().optional(),
    parent_bill_id: zUuid.nullable().optional(),
    share_index: z.number().int().positive().nullable().optional(),
    share_count: z.number().int().positive().nullable().optional(),
    items: z.array(BillSnapshotItemSchema),
  })
  .strict()
export type BillSnapshotRow = z.infer<typeof BillSnapshotRowSchema>

export const BillsSnapshotBlockSchema = z.object({
  etag: z.string().regex(/^[0-9a-f]{16}$/),
  as_of_server_time: z.iso.datetime(),
  rows: z.array(BillSnapshotRowSchema),
  truncated: z.boolean().optional(),
})
export type BillsSnapshotBlock = z.infer<typeof BillsSnapshotBlockSchema>

export const BillDetailResponseSchema = z
  .object({
    id: zUuid,
    tenant_id: zUuid,
    outlet_id: zUuid,
    register_id: zUuid,
    device_id: zUuid,
    table_id: zUuid,
    bill_ref: z.string().min(1).max(30),
    status: z.enum(BILL_STATUS),
    lease_device_id: zUuid,
    lease_register_id: zUuid,
    handover_status: z.enum(BILL_HANDOVER_STATUS),
    handover_target_register_id: zUuid.nullable(),
    handover_event_id: zUuid.nullable(),
    handover_requested_at: z.iso.datetime().nullable(),
    prebill_seq: z.number().int().positive().nullable(),
    prebill_printed_at: z.iso.datetime().nullable(),
    last_content_seq: z.number().int().nonnegative(),
    is_awaiting_payment: z.boolean(),
    bill_discount_type: z.enum(DISCOUNT_TYPE).nullable(),
    bill_discount_pct: z.string().nullable(),
    bill_discount_input: zMoneyNonNeg.nullable(),
    bill_discount_approved_by: zUuid.nullable(),
    customer_name: z.string().nullable(),
    customer_phone: z.string().nullable(),
    split_mode: z.enum(BILL_SPLIT_MODE).nullable(),
    parent_bill_id: zUuid.nullable(),
    share_index: z.number().int().positive().nullable(),
    share_count: z.number().int().positive().nullable(),
    last_event_seq: z.number().int().nonnegative(),
    last_event_at: z.iso.datetime().nullable(),
    created_by: zUuid,
    created_at_device: z.iso.datetime(),
    occurred_at: z.iso.datetime(),
    business_date: z.string(),
    items: z.array(BillSnapshotItemSchema),
  })
  .strict()
export type BillDetailResponse = z.infer<typeof BillDetailResponseSchema>

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
  stock: z.union([z.literal('unchanged'), StockSnapshotBlockSchema]).optional(),
  bills: z.union([z.literal('unchanged'), BillsSnapshotBlockSchema]).optional(),
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
