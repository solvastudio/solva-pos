export const MASTER_STORE_NAMES = [
  'legal_entity',
  'outlet',
  'tax_rate_history',
  'register_invoice_prefix',
  'outlet_receipt_setting',
  'cash_master',
  'payment_method',
  'feature_flag',
  'app_user',
  'role',
  'role_permission',
  'user_outlet',
  'staff_pin',
  'category',
  'uom',
  'product',
  'sku',
  'sku_uom',
  'price_entry',
  'item_outlet_availability',
  'modifier_group',
  'modifier_group_product',
  'modifier',
  'fnb_table',
] as const

export type MasterStoreName = (typeof MASTER_STORE_NAMES)[number]

/**
 * Exact Dexie v1 store definitions from docs/SCHEMA.md §6.3 plus `pull_stage`
 * (docs/ARCHITECTURE.md §4.3.2). Total: 48 stores.
 * Never mutate STORES_V1 after Fase 27; any future index change MUST add `version(2)`.
 */
export const STORES_V1 = {
  meta: 'key',

  // ===== master (read-only for UI/POS; written exclusively by master.repo / pull applier) =====
  legal_entity: 'id',
  outlet: 'id',
  tax_rate_history: 'id, [tax_code+outlet_key], effective_from',
  register_invoice_prefix: 'id, register_id, effective_month',
  outlet_receipt_setting: 'id, outlet_id',
  cash_master: 'id, outlet_id, register_type',
  payment_method: 'id, code',
  feature_flag: 'id, &flag_key',
  app_user: 'id, display_name',
  role: 'id',
  role_permission: 'id, role_id',
  user_outlet: 'id, user_id',
  staff_pin: 'id, user_id',
  category: 'id, parent_id',
  uom: 'id',
  product: 'id, category_id, code, *search_tokens',
  sku: 'id, product_id, sku_code',
  sku_uom: 'id, &barcode, [sku_id+uom_id], sku_id',
  price_entry: 'id, [sku_id+uom_id+outlet_key]',
  item_outlet_availability: 'id, [product_id+sku_key]',
  modifier_group: 'id',
  modifier_group_product: 'id, product_id, modifier_group_id',
  modifier: 'id, modifier_group_id',
  fnb_table: 'id, code',

  // ===== local transactions =====
  sale: 'id, &invoice_no, [register_id+invoice_period+invoice_seq], business_date, shift_id, bill_id, [sync_status+business_date]',
  sale_line: 'id, sale_id, [sale_id+line_no]',
  sale_line_modifier: 'id, sale_line_id',
  sale_payment: 'id, sale_id, shift_id',
  credit_note: 'id, &cn_no, original_sale_id, business_date, shift_id, [sync_status+business_date]',
  credit_note_line: 'id, credit_note_id, sale_line_id',
  credit_note_refund: 'id, credit_note_id, shift_id',
  shift: 'id, status, register_id, [sync_status+business_date]',
  cash_movement: 'id, shift_id',
  bill: 'id, table_id, status, parent_bill_id, [sync_status+business_date]',
  bill_item: 'id, bill_id',
  bill_item_modifier: 'id, bill_item_id',
  bill_event: 'id, [bill_id+bill_seq], device_seq',
  staff_pin_state: '[user_id+device_id]',

  // ===== sync / printing / diagnostics infrastructure =====
  outbox_command: 'id, [status+device_seq], dependency_key, entity_id',
  local_counter: 'key',
  print_job: 'id, [status+created_at], entity_id',
  device_log: '++id, &ref_local, [send_status+id]',
  stock_snapshot: 'sku_id',
  bill_snapshot: 'bill_id, table_id, status, handover_target_register_id',
  cart_draft: 'id, [register_id+staff_id+status], bill_key, status',
  asset_cache: 'key',
  pull_stage: '++seq, cycle_id',
} as const satisfies Record<string, string>

export type StoreNameV1 = keyof typeof STORES_V1
