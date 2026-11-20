import { z } from 'zod'
import { LOCAL_REF_PATTERN } from '~/lib/contracts'

export const META_SCHEMAS = {
  device: z.object({
    device_id: z.string().min(1),
    credential: z.string().min(1),
    credential_expires_at: z.string().min(1),
    tenant_id: z.string().min(1),
    slug: z.string().min(1),
    register_id: z.string().min(1),
    outlet_id: z.string().min(1),
    register_type: z.enum(['CASHIER', 'WAITER']),
  }),
  cursor: z
    .object({
      version: z.number().int().nonnegative(),
      id: z.string(),
    })
    .nullable(),
  catalog_cursor: z.number().int().nonnegative(),
  snapshot_version: z.string().nullable(),
  clock: z.object({
    offset_ms: z.number().int(),
    offset_at: z.string().min(1),
    max_seen_time: z.string().min(1),
    measured_at_device: z.number().optional(),
    rtt_ms: z.number().optional(),
    server_time_at_measure: z.number().optional(),
  }),
  last_success_sync_at: z.string().min(1).nullable(),
  locale: z.enum(['id-ID', 'en-US']),
  idle_lock: z.object({
    locked: z.boolean(),
    locked_staff_id: z.string().nullable(),
    locked_at: z.string().nullable(),
    timeout_min: z.number().int().positive().optional(),
  }),
  min_supported: z
    .object({
      app_version: z.string().min(1),
      schema_version: z.number().int().positive(),
      is_mandatory: z.boolean(),
    })
    .nullable(),
  stage: z
    .object({
      cycle_id: z.string().min(1),
      upper: z
        .object({
          version: z.number().int().nonnegative(),
          id: z.string(),
        })
        .nullable(),
      cursor: z
        .object({
          version: z.number().int().nonnegative(),
          id: z.string(),
        })
        .nullable()
        .optional(),
      stage_cursor: z.number().int().nonnegative(),
      pages: z.number().int().nonnegative(),
    })
    .nullable(),
  full_resync: z.boolean(),
  storage: z.object({
    persist: z.enum(['GRANTED', 'DENIED', 'UNKNOWN']),
    used_pct: z.number().min(0).max(100),
  }),
  printer: z
    .object({
      mode: z.enum(['browser', 'escpos']),
      printer_id: z.string().optional(),
      width_mm: z.union([z.literal(58), z.literal(80)]).optional(),
    })
    .nullable(),
  dexie_version: z.number().int().positive(),
  tenant: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    default_locale: z.enum(['id-ID', 'en-US']),
  }),
  sync_protocol_version: z.number().int().positive(),
  device_flags: z.object({
    revoked: z.boolean().optional(),
    credential_expired: z.boolean().optional(),
    tenant_suspended: z.boolean().optional(),
  }),
  sync_flags: z.object({
    revoked: z.boolean().optional(),
    credential_expired: z.boolean().optional(),
    tenant_suspended: z.boolean().optional(),
    update_required: z.boolean().optional(),
    server_max_schema: z.number().int().positive().optional(),
  }),
} as const

export type MetaKey = keyof typeof META_SCHEMAS

export type MetaValueMap = {
  [K in MetaKey]: z.infer<(typeof META_SCHEMAS)[K]>
}

export interface MetaRow<K extends MetaKey = MetaKey> {
  key: K
  value: MetaValueMap[K]
}

export interface LocalCounterRow {
  key: string
  register_id: string | null
  doc_type: string | null
  period: string | null
  last_seq: number
  updated_at: string
}

export interface DeviceLogRow {
  id?: number
  ref_local: string
  created_at: string
  clock_offset_ms: number | null
  level: 'info' | 'warn' | 'error'
  code: string
  route: string | null
  stack: string | null
  component_stack?: string | null
  ctx: Record<string, string | number | boolean>
  app_version: string
  schema_version: number
  send_status: 'PENDING' | 'SENDING' | 'SENT'
  attempts?: number
}

export const DeviceLogRowInputSchema = z.object({
  ref_local: z.string().regex(LOCAL_REF_PATTERN),
  created_at: z.string().min(1),
  clock_offset_ms: z.number().int().nullable(),
  level: z.enum(['info', 'warn', 'error']),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
  route: z.string().max(200).nullable(),
  stack: z.string().max(4000).nullable(),
  component_stack: z.string().max(4000).nullable().optional(),
  ctx: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  app_version: z.string().min(1).max(30),
  schema_version: z.number().int().positive(),
  send_status: z.enum(['PENDING', 'SENDING', 'SENT']),
  attempts: z.number().int().nonnegative().optional(),
})

export interface PullStageRow {
  seq?: number
  cycle_id: string
  entity: string
  op: 'upsert' | 'delete'
  id: string
  version: number
  payload: Record<string, unknown>
}

export interface OutboxCommandRow {
  id: string
  type: string
  payload: unknown
  schema_version: number
  device_seq: number
  register_id: string
  status: 'PENDING' | 'SENDING' | 'ACKED' | 'NEEDS_ATTENTION'
  dependency_key: string | null
  depends_on: string[]
  attempts: number
  next_retry_at: string | null
  last_error_class: 'TRANSIENT' | 'STRUCTURAL' | 'AUTHORIZATION' | 'SCHEMA' | null
  last_error_code: string | null
  last_error_ref: string | null
  result: Record<string, unknown> | null
  created_at_device: string
  app_version: string
  acked_at?: string | null
}

export interface IdRecord {
  id: string
  [key: string]: unknown
}

export interface OutletRecord extends IdRecord {
  legal_entity_id: string
  code: string
  name: string
  timezone: string
  day_cutoff_time: string
  price_tax_mode: string
  deleted_at: string | null
}

export interface CashMasterRecord extends IdRecord {
  outlet_id: string
  code: string
  name: string
  register_type: string
  invoice_prefix: string
  deleted_at: string | null
}

export interface AppUserRecord extends IdRecord {
  display_name: string
  is_active: boolean
  deleted_at: string | null
}

export interface RoleRecord extends IdRecord {
  code: string
  name: string
  deleted_at: string | null
}

export interface RolePermissionRecord extends IdRecord {
  role_id: string
  permission_code: string
}

export interface StaffPinRecord extends IdRecord {
  user_id: string
  role_id: string
  pin_hash: string
  pin_salt: string
  is_active: boolean
  deleted_at: string | null
}

export interface UserOutletRecord extends IdRecord {
  user_id: string
  outlet_id: string
  role_id: string
  deleted_at: string | null
}

export interface ProductRecord extends IdRecord {
  category_id: string | null
  code: string
  name: string
  product_type: string
  search_tokens: string[]
  deleted_at: string | null
}
