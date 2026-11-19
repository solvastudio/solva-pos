// Enum kanonik disalin persis dari docs/SCHEMA.md Lampiran A & B.

export const TENANT_STATUS = ['ACTIVE', 'SUSPENDED', 'CLOSED'] as const
export type TenantStatus = (typeof TENANT_STATUS)[number]

export const REGISTER_TYPE = ['CASHIER', 'WAITER'] as const
export type RegisterType = (typeof REGISTER_TYPE)[number]

export const TAX_PROFILE = ['NONE', 'PPN', 'PB1'] as const
export type TaxProfile = (typeof TAX_PROFILE)[number]

export const TAX_CODE = ['PPN', 'PB1'] as const
export type TaxCode = (typeof TAX_CODE)[number]

export const PRICE_TAX_MODE = ['INCLUSIVE', 'EXCLUSIVE'] as const
export type PriceTaxMode = (typeof PRICE_TAX_MODE)[number]

export const PAYMENT_METHOD_KIND = ['CASH', 'NON_CASH'] as const
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KIND)[number]

export const PRODUCT_TYPE = ['RETAIL', 'MENU_FNB'] as const
export type ProductType = (typeof PRODUCT_TYPE)[number]

export const ITEM_AVAILABILITY_STATUS = ['AVAILABLE', 'UNAVAILABLE'] as const
export type ItemAvailabilityStatus = (typeof ITEM_AVAILABILITY_STATUS)[number]

export const MODIFIER_SELECTION_TYPE = ['SINGLE', 'MULTI'] as const
export type ModifierSelectionType = (typeof MODIFIER_SELECTION_TYPE)[number]

export const MODIFIER_ADJUST_TYPE = ['ADD', 'REDUCE', 'REMOVE'] as const
export type ModifierAdjustType = (typeof MODIFIER_ADJUST_TYPE)[number]

export const SALE_STATUS = ['PAID', 'VOID'] as const
export type SaleStatus = (typeof SALE_STATUS)[number]

export const SALE_LINE_KIND = ['ITEM', 'SHARE', 'STOCK_BASIS'] as const
export type SaleLineKind = (typeof SALE_LINE_KIND)[number]

export const PRICE_SOURCE = ['OUTLET', 'TENANT_DEFAULT', 'OPEN_PRICE'] as const
export type PriceSource = (typeof PRICE_SOURCE)[number]

export const DISCOUNT_TYPE = ['PERCENT', 'NOMINAL'] as const
export type DiscountType = (typeof DISCOUNT_TYPE)[number]

export const CREDIT_NOTE_STATUS = ['POSTED'] as const
export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUS)[number]

export const RETURN_DISPOSITION = ['KEMBALI_STOK', 'BUANG'] as const
export type ReturnDisposition = (typeof RETURN_DISPOSITION)[number]

export const SHIFT_STATUS = ['OPEN', 'CLOSED', 'FORCE_CLOSED'] as const
export type ShiftStatus = (typeof SHIFT_STATUS)[number]

export const SHIFT_RECAP_STATUS = ['COMPLETE', 'INCOMPLETE'] as const
export type ShiftRecapStatus = (typeof SHIFT_RECAP_STATUS)[number]

export const CASH_MOVEMENT_DIRECTION = ['IN', 'OUT'] as const
export type CashMovementDirection = (typeof CASH_MOVEMENT_DIRECTION)[number]

export const DOC_TYPE = ['INVOICE', 'CREDIT_NOTE'] as const
export type DocType = (typeof DOC_TYPE)[number]

export const INVOICE_GAP_STATUS = ['OPEN', 'EXPLAINED', 'FILLED'] as const
export type InvoiceGapStatus = (typeof INVOICE_GAP_STATUS)[number]

export const INVOICE_GAP_ORIGIN = ['DETECTED', 'RECOVERY_DECLARED'] as const
export type InvoiceGapOrigin = (typeof INVOICE_GAP_ORIGIN)[number]

export const GOODS_RECEIPT_DOC_TYPE = ['RECEIPT', 'REVERSAL'] as const
export type GoodsReceiptDocType = (typeof GOODS_RECEIPT_DOC_TYPE)[number]

export const GOODS_RECEIPT_STATUS = ['DRAFT', 'POSTED'] as const
export type GoodsReceiptStatus = (typeof GOODS_RECEIPT_STATUS)[number]

export const STOCKTAKE_STATUS = ['DRAFT', 'POSTED', 'CANCELED'] as const
export type StocktakeStatus = (typeof STOCKTAKE_STATUS)[number]

export const TRANSFER_STATUS = ['DRAFT', 'SENT', 'RECEIVED', 'CANCELED'] as const
export type TransferStatus = (typeof TRANSFER_STATUS)[number]

export const BILL_STATUS = ['OPEN', 'SPLIT', 'PAID', 'CANCELED', 'MERGED', 'CLOSED_BY_SPLIT'] as const
export type BillStatus = (typeof BILL_STATUS)[number]

export const BILL_SPLIT_MODE = ['ITEM', 'QTY', 'EQUAL'] as const
export type BillSplitMode = (typeof BILL_SPLIT_MODE)[number]

export const BILL_HANDOVER_STATUS = ['NONE', 'PENDING'] as const
export type BillHandoverStatus = (typeof BILL_HANDOVER_STATUS)[number]

export const BILL_EVENT_TYPE = [
  'BILL_OPENED',
  'ITEM_ADDED',
  'ITEM_VOIDED',
  'ITEM_QTY_CHANGED',
  'MODIFIER_SET',
  'CUSTOMER_SET',
  'TABLE_SET',
  'BILL_CANCELED',
  'PREBILL_PRINTED',
  'BILL_HANDED_OVER',
  'BILL_ACCEPTED',
  'BILL_HANDOVER_CANCELED',
  'DISCOUNT_SET',
  'BILL_SPLIT',
  'BILL_MERGED',
] as const
export type BillEventType = (typeof BILL_EVENT_TYPE)[number]

export const BILL_ITEM_STATUS = ['ACTIVE', 'VOIDED', 'MOVED'] as const
export type BillItemStatus = (typeof BILL_ITEM_STATUS)[number]

export const MEMBERSHIP_STATUS = ['PENDING', 'ACTIVE'] as const
export type MembershipStatus = (typeof MEMBERSHIP_STATUS)[number]

export const MEMBER_CODE_KIND = ['INVITE', 'RESET'] as const
export type MemberCodeKind = (typeof MEMBER_CODE_KIND)[number]

export const MEMBER_CODE_REVOKE_REASON = ['CANCELED', 'REPLACED'] as const
export type MemberCodeRevokeReason = (typeof MEMBER_CODE_REVOKE_REASON)[number]

export const CART_DRAFT_STATUS = ['ACTIVE', 'DISCARDED'] as const
export type CartDraftStatus = (typeof CART_DRAFT_STATUS)[number]

export const COMMAND_TYPE = [
  'FinalizeSale',
  'VoidSale',
  'FinalizeCreditNote',
  'OpenShift',
  'RecordCashMovement',
  'CloseShift',
  'AppendBillEvents',
  'HandOverBill',
  'AcceptBill',
  'CancelBillHandover',
  'AppendAudit',
  'ReportPinState',
] as const
export type CommandType = (typeof COMMAND_TYPE)[number]

export const OUTBOX_STATUS = ['PENDING', 'SENDING', 'ACKED', 'NEEDS_ATTENTION'] as const
export type OutboxStatus = (typeof OUTBOX_STATUS)[number]

export const IDEMPOTENCY_STATUS = ['ACKED', 'ATTENTION', 'ACCEPTED_MANUAL', 'DISMISSED'] as const
export type IdempotencyStatus = (typeof IDEMPOTENCY_STATUS)[number]

export const ATTENTION_STATUS = ['OPEN', 'ACCEPTED', 'DISMISSED', 'ESCALATED'] as const
export type AttentionStatus = (typeof ATTENTION_STATUS)[number]

export const ATTENTION_REASON_CLASS = ['STRUCTURAL', 'AUTHORIZATION'] as const
export type AttentionReasonClass = (typeof ATTENTION_REASON_CLASS)[number]

export const ERROR_CLASS_CLIENT = ['TRANSIENT', 'STRUCTURAL', 'AUTHORIZATION', 'SCHEMA'] as const
export type ErrorClassClient = (typeof ERROR_CLASS_CLIENT)[number]

export const DATA_FLAG_STATUS = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const
export type DataFlagStatus = (typeof DATA_FLAG_STATUS)[number]

export const STORAGE_PERSIST_STATUS = ['GRANTED', 'DENIED', 'UNKNOWN'] as const
export type StoragePersistStatus = (typeof STORAGE_PERSIST_STATUS)[number]

export const PRINT_JOB_STATUS = ['QUEUED', 'PRINTING', 'DONE', 'FAILED'] as const
export type PrintJobStatus = (typeof PRINT_JOB_STATUS)[number]

export const STOCK_MOVEMENT_KIND = [
  'SALE',
  'SALE_VOID',
  'RETURN_IN',
  'GR_IN',
  'GR_REVERSAL',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ADJUSTMENT',
  'RECIPE_CONSUMPTION',
] as const
export type StockMovementKind = (typeof STOCK_MOVEMENT_KIND)[number]

export const STOCK_COST_BASIS = [
  'AVERAGE',
  'REFERENCE',
  'MIXED',
  'SNAPSHOT',
  'TRANSFER',
  'DECLARED',
] as const
export type StockCostBasis = (typeof STOCK_COST_BASIS)[number]

export const FLAG_CODE = [
  'HARGA_STALE',
  'ITEM_NONAKTIF',
  'ITEM_TIDAK_TERSEDIA',
  'TARIF_BERBEDA',
  'SELISIH_HITUNG',
  'NOMOR_KONFLIK',
  'STOK_MINUS',
  'TANPA_RESEP',
  'BILL_GANDA_MEJA',
  'SELISIH_TRANSFER',
] as const
export type FlagCode = (typeof FLAG_CODE)[number]

function makeEnumGuard<const T extends readonly string[]>(values: T) {
  const set = new Set<string>(values)
  return (value: unknown): value is T[number] => typeof value === 'string' && set.has(value)
}

export const isTenantStatus = makeEnumGuard(TENANT_STATUS)
export const isRegisterType = makeEnumGuard(REGISTER_TYPE)
export const isTaxProfile = makeEnumGuard(TAX_PROFILE)
export const isPriceTaxMode = makeEnumGuard(PRICE_TAX_MODE)
export const isCommandType = makeEnumGuard(COMMAND_TYPE)
export const isOutboxStatus = makeEnumGuard(OUTBOX_STATUS)
export const isIdempotencyStatus = makeEnumGuard(IDEMPOTENCY_STATUS)
export const isAttentionStatus = makeEnumGuard(ATTENTION_STATUS)
export const isAttentionReasonClass = makeEnumGuard(ATTENTION_REASON_CLASS)
export const isErrorClassClient = makeEnumGuard(ERROR_CLASS_CLIENT)
export const isMembershipStatus = makeEnumGuard(MEMBERSHIP_STATUS)
export const isFlagCode = makeEnumGuard(FLAG_CODE)
export const isStockMovementKind = makeEnumGuard(STOCK_MOVEMENT_KIND)
export const isStockCostBasis = makeEnumGuard(STOCK_COST_BASIS)
