import { z } from 'zod'

const LOCAL_REF_PATTERN = /^D-\d{8}-\d{6}-[a-hj-km-np-z2-9]{5}$/

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
  /** Last stock snapshot metadata: etag for the next request and the estimate reference. */
  stock_snapshot_meta: z
    .object({
      etag: z.string().regex(/^[0-9a-f]{16}$/),
      as_of_server_time: z.string().min(1),
      acked_device_seq: z.number().int().nonnegative(),
    })
    .nullable(),
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
      latest: z.string().min(1).optional(),
      accept_previous_until: z.string().nullable().optional(),
      max_schema_version: z.number().int().positive().optional(),
    })
    .nullable(),
  update: z
    .object({
      next_prompt_at: z.string().nullable().optional(),
      dismissed_at: z.string().nullable().optional(),
      status: z.enum(['NONE', 'AVAILABLE', 'PENDING_APPLY', 'APPLYING']).optional(),
    })
    .nullable()
    .optional(),
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
      // Legacy shape compatibility (existing meta tests) + local printer config
      mode: z.enum(['browser', 'escpos']).optional(),
      printer_id: z.string().optional(),
      width_mm: z.union([z.literal(58), z.literal(80)]).optional(),
      adapter: z.enum(['webusb', 'webbluetooth', 'browser-print', 'virtual']).optional(),
      deviceId: z.string().optional(),
      deviceName: z.string().optional(),
      profileId: z.string().optional(),
      paperWidthMm: z.union([z.literal(58), z.literal(80)]).optional(),
      columns: z.union([z.literal(32), z.literal(48)]).optional(),
      codePage: z.string().optional(),
      canCut: z.boolean().optional(),
      canOpenDrawer: z.boolean().optional(),
      drawerPulse: z.tuple([z.number().int(), z.number().int(), z.number().int()]).optional(),
      serviceUuid: z.string().optional(),
      characteristicUuid: z.string().optional(),
    })
    .nullable(),
  scanner: z
    .object({
      wedgeEnabled: z.boolean(),
      maxGapMs: z.number().int().min(10).max(200),
      terminator: z.enum(['Enter', 'Tab', 'Any']),
      cameraEnabled: z.boolean(),
    })
    .optional(),
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
    server_behind: z.boolean().optional(),
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
  status: 'PENDING' | 'SENDING' | 'ACKED' | 'NEEDS_ATTENTION' | 'DISMISSED'
  dependency_key: string | null
  depends_on: string[]
  attempts: number
  next_retry_at: string | null
  last_error_class: 'TRANSIENT' | 'STRUCTURAL' | 'AUTHORIZATION' | 'SCHEMA' | null
  last_error_code: string | null
  last_error_ref: string | null
  result: Record<string, unknown> | null
  manager_decision?: 'ACCEPTED_MANUAL' | 'DISMISSED' | null
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
  address?: string | null
  phone?: string | null
  timezone: string
  day_cutoff_time: string
  price_tax_mode: 'INCLUSIVE' | 'EXCLUSIVE' | string
  tax_profile?: 'NONE' | 'PPN' | 'PB1' | string
  cash_rounding_unit?: number
  service_charge_enabled?: boolean
  service_charge_rate?: string | number
  service_charge_taxable?: boolean
  deleted_at: string | null
}

export interface TaxRateHistoryRecord extends IdRecord {
  tax_code: 'PPN' | 'PB1' | string
  outlet_id: string | null
  outlet_key: string
  effective_from: string
  rate: string | number
  deleted_at?: string | null
}

export interface StockSnapshotRecord {
  sku_id: string
  qty_on_hand: string
  updated_at?: string
}

export interface ShiftRecord extends IdRecord {
  tenant_id: string
  outlet_id: string
  register_id: string
  device_id: string
  status: 'OPEN' | 'CLOSED' | 'FORCE_CLOSED'
  opening_cash: number
  opened_by: string
  open_command_id?: string | null
  created_at_device: string
  occurred_at: string
  business_date: string
  closed_at: string | null
  closed_at_device?: string | null
  count_submitted_at?: string | null
  counted_cash: number | null
  expected_cash_device?: number | null
  variance_device?: number | null
  close_note?: string | null
  sync_status: 'PENDING' | 'SYNCED' | 'FAILED'
}

export interface CartDraftRecord extends IdRecord {
  kind?: 'CART'
  register_id: string
  staff_id: string
  status: string
  bill_key: string
  payload?: unknown
  updated_at?: string
}

export interface LegalEntityRecord extends IdRecord {
  name: string
  npwp: string | null
  is_pkp: boolean
  pkp_since?: string | null
  address?: string | null
  deleted_at?: string | null
}

export interface RegisterInvoicePrefixRecord extends IdRecord {
  register_id: string
  effective_month: string
  invoice_prefix: string
  deleted_at?: string | null
}

export interface OutletReceiptSettingRecord extends IdRecord {
  outlet_id: string
  receipt_locale: 'id-ID' | 'en-US' | string
  header_text?: string | null
  footer_text?: string | null
  logo_object_key?: string | null
  logo_sha256?: string | null
  deleted_at?: string | null
}

export interface PaymentMethodRecord extends IdRecord {
  code: string
  name: string
  kind: 'CASH' | 'NON_CASH' | string
  requires_reference: boolean
  sort_order: number
  is_active: boolean
  deleted_at?: string | null
}

export interface SaleRecord extends IdRecord {
  tenant_id: string
  outlet_id: string
  register_id: string
  device_id: string
  shift_id: string
  status: 'PAID' | 'VOID'
  created_by: string
  created_at_device: string
  clock_offset_ms: number
  occurred_at: string
  business_date: string
  invoice_no: string
  invoice_prefix: string
  invoice_period: string
  invoice_seq: number
  legal_entity_id: string
  legal_entity_npwp: string | null
  legal_entity_is_pkp: boolean
  price_tax_mode: 'INCLUSIVE' | 'EXCLUSIVE'
  tax_profile: 'NONE' | 'PPN' | 'PB1'
  tax_rate: string
  tax_rate_id: string | null
  service_charge_rate: string
  service_charge_taxable: boolean
  cash_rounding_unit: number
  receipt_locale: 'id-ID' | 'en-US'
  currency: 'IDR'
  gross_total: number
  line_discount_total: number
  bill_discount_type: 'PERCENT' | 'NOMINAL' | null
  bill_discount_pct: string | null
  bill_discount_input: number | null
  bill_discount_total: number
  discount_approved_by: string | null
  net_subtotal: number
  service_charge: number
  tax_base: number
  tax_amount: number
  dpp: number
  grand_total: number
  rounding: number
  total_due: number
  customer_name: string | null
  customer_phone: string | null
  catalog_cursor: number | null
  bill_id: string | null
  bill_ref: string | null
  sync_status: 'PENDING' | 'SYNCED' | 'FAILED'
  synced_at: string | null
  server_result: Record<string, unknown> | null
  print_state: 'QUEUED' | 'PRINTING' | 'DONE' | 'FAILED'
  voided_at?: string | null
  voided_by?: string | null
  void_approved_by?: string | null
  void_reason_code?: string | null
  void_reason_text?: string | null
}

export interface SaleLineRecord extends IdRecord {
  sale_id: string
  line_no: number
  line_kind: 'ITEM' | 'SHARE' | 'STOCK_BASIS'
  product_id: string | null
  sku_id: string | null
  uom_id: string | null
  sku_code: string
  item_name: string
  uom_code: string
  qty: string
  conversion_factor: string
  qty_base: string
  unit_price: number
  price_source: 'OUTLET' | 'TENANT_DEFAULT' | 'OPEN_PRICE'
  is_open_price: boolean
  taxable: boolean
  discount_type: 'PERCENT' | 'NOMINAL' | null
  discount_pct: string | null
  discount_input: number | null
  discount_approved_by: string | null
  line_gross: number
  line_discount: number
  line_net: number
  bill_discount_alloc: number
  service_alloc: number
  tax_alloc: number
  note: string | null
  source_bill_item_id: string | null
  modifiers: Array<Record<string, unknown>>
}

export interface SalePaymentRecord extends IdRecord {
  sale_id: string
  shift_id: string
  seq: number
  method_id: string
  method_code: string
  method_name: string
  method_kind: 'CASH' | 'NON_CASH'
  amount_applied: number
  cash_tendered: number | null
  change_given: number | null
  reference: string | null
  is_rounding_settler: boolean
}

export interface CashMovementRecord extends IdRecord {
  tenant_id: string
  outlet_id: string
  register_id: string
  device_id: string
  shift_id: string
  created_by: string
  created_at_device: string
  clock_offset_ms: number
  occurred_at: string
  business_date: string
  direction: 'IN' | 'OUT'
  amount: number
  reason_code: string
  reason_text: string
  sync_status: 'PENDING' | 'SYNCED' | 'FAILED'
}

export interface CreditNoteRecord extends IdRecord {
  tenant_id: string
  outlet_id: string
  register_id: string
  device_id: string
  shift_id: string
  created_by: string
  approved_by: string
  created_at_device: string
  clock_offset_ms: number
  occurred_at: string
  business_date: string
  cn_no: string
  cn_prefix: string
  cn_period: string
  cn_seq: number
  original_sale_id: string
  original_invoice_no: string
  reason_code: string
  reason_text: string | null
  price_tax_mode: 'INCLUSIVE' | 'EXCLUSIVE'
  cash_rounding_unit: number
  receipt_locale: 'id-ID' | 'en-US'
  net_total: number
  service_total: number
  tax_total: number
  refund_gross: number
  rounding: number
  sync_status: 'PENDING' | 'SYNCED' | 'FAILED'
  print_state: 'QUEUED' | 'PRINTING' | 'DONE' | 'FAILED'
}

export interface CreditNoteLineRecord extends IdRecord {
  credit_note_id: string
  line_no: number
  sale_line_id: string
  qty_returned: string
  qty_returned_base: string
  refund_net: number
  refund_service: number
  refund_tax: number
  is_final_return: boolean
  disposition: 'KEMBALI_STOK' | 'BUANG' | null
}

export interface CreditNoteRefundRecord extends IdRecord {
  credit_note_id: string
  shift_id: string
  seq: number
  method_id: string
  method_code: string
  method_name: string
  method_kind: 'CASH' | 'NON_CASH'
  amount_applied: number
  reference: string | null
}

export interface PrintJobRecord {
  id: string
  kind:
    | 'RECEIPT'
    | 'REPRINT'
    | 'CREDIT_NOTE'
    | 'PREBILL'
    | 'SHIFT_RECAP'
    | 'CASH_DRAWER'
    | 'TEST'
  status: 'QUEUED' | 'PRINTING' | 'DONE' | 'FAILED'
  entity_id: string
  entity_type?: 'SALE' | 'CREDIT_NOTE' | 'SHIFT' | 'DEVICE' | null
  printer_id?: string | null
  payload?: Record<string, unknown> | null
  receipt_locale: 'id-ID' | 'en-US'
  attempts: number
  last_error: string | null
  created_at: string
  first_byte_at?: string | null
  done_at?: string | null
  updated_at: string
}

export interface AssetCacheRecord {
  key: string
  sha256: string
  width: number
  height: number
  bits: Uint8Array
  updated_at: string
}

export interface CashMasterRecord extends IdRecord {
  outlet_id: string
  code: string
  name: string
  register_type: string
  paper_width_mm?: 58 | 80
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
  discount_limit_pct?: string | number
  deleted_at: string | null
}

export interface RolePermissionRecord extends IdRecord {
  role_id: string
  permission_code: string
  deleted_at?: string | null
}

export interface PinKdfParamsRecord {
  memorySize: number
  iterations: number
  parallelism: number
  hashLength: number
}

export interface StaffPinRecord extends IdRecord {
  user_id: string
  device_salt: string
  pin_hash: string
  kdf_algo: 'ARGON2ID' | 'PBKDF2_SHA256'
  kdf_params: PinKdfParamsRecord
  kdf_salt: string
  pin_epoch: number
  deleted_at: string | null
}

export interface StaffPinStateRecord {
  user_id: string
  device_id: string
  failed_count: number
  lock_tier: 0 | 1 | 2 | 3
  locked_until: string | null
  last_failed_at: string | null
  pin_epoch_seen: number
}

export interface UserOutletRecord extends IdRecord {
  user_id: string
  outlet_id: string | null
  role_id: string
  deleted_at: string | null
}

export interface CategoryRecord extends IdRecord {
  parent_id: string | null
  name: string
  sort_order: number
  deleted_at?: string | null
}

export interface UomRecord extends IdRecord {
  code: string
  name: string
  allow_fraction: boolean
  deleted_at?: string | null
}

export interface ProductRecord extends IdRecord {
  category_id: string
  code: string
  name: string
  product_type: string
  has_variants: boolean
  base_uom_id: string
  track_stock: boolean
  taxable: boolean
  is_active: boolean
  is_open_price: boolean
  sort_order: number
  search_tokens: string[]
  deleted_at?: string | null
}

export interface SkuRecord extends IdRecord {
  product_id: string
  sku_code: string
  variant_label: string | null
  is_default: boolean
  is_active: boolean
  sort_order: number
  deleted_at?: string | null
}

export interface SkuUomRecord extends IdRecord {
  sku_id: string
  uom_id: string
  conversion_factor: string
  is_base: boolean
  barcode?: string
  deleted_at?: string | null
}

export interface PriceEntryRecord extends IdRecord {
  sku_id: string
  uom_id: string
  outlet_id: string | null
  outlet_key: string
  price: number
  currency: string
  deleted_at?: string | null
}

export interface ItemOutletAvailabilityRecord extends IdRecord {
  outlet_id: string
  product_id: string
  sku_id: string | null
  sku_key: string
  status: 'AVAILABLE' | 'UNAVAILABLE'
  changed_at?: string
  deleted_at?: string | null
}

export interface FeatureFlagRecord extends IdRecord {
  flag_key: string
  enabled: boolean
  params?: Record<string, unknown> | null
  deleted_at?: string | null
}
