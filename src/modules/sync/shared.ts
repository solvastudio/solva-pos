/** Ordered entity names streamed during a full-resync cycle (parent tables before children). */
export const FULL_RESYNC_ENTITY_ORDER = [
  'tenant',
  'legal_entity',
  'outlet',
  'outlet_receipt_setting',
  'cash_master',
  'register_invoice_prefix',
  'tax_rate_history',
  'payment_method',
  'feature_flag',
  'role',
  'role_permission',
  'app_user',
  'user_outlet',
  'staff_pin',
  'category',
  'uom',
  'product',
  'sku',
  'sku_uom',
  'item_outlet_availability',
  'price_entry',
] as const

export type FullResyncEntity = (typeof FULL_RESYNC_ENTITY_ORDER)[number]
