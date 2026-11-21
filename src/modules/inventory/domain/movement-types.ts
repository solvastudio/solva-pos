/**
 * Konstanta enum inventori (SCHEMA §4.3.2–4.3.7, Lampiran A). Dipakai skema (CHECK) dan domain.
 * Nilai harus sama persis dengan CHECK di migrasi; tes skema memeriksa kesesuaian.
 */

export const MOVEMENT_TYPES = [
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
export type MovementType = (typeof MOVEMENT_TYPES)[number]

export const COST_BASIS = ['AVERAGE', 'REFERENCE', 'MIXED', 'SNAPSHOT', 'TRANSFER', 'DECLARED'] as const
export type CostBasisCode = (typeof COST_BASIS)[number]

export const STOCK_SOURCE_TYPES = [
  'SALE_LINE',
  'CREDIT_NOTE_LINE',
  'GR_LINE',
  'TRANSFER_LINE',
  'STOCKTAKE_LINE',
] as const
export type StockSourceType = (typeof STOCK_SOURCE_TYPES)[number]

export const GOODS_RECEIPT_DOC_TYPES = ['RECEIPT', 'REVERSAL'] as const
export const GOODS_RECEIPT_STATUSES = ['DRAFT', 'POSTED'] as const
export const TRANSFER_STATUSES = ['DRAFT', 'SENT', 'RECEIVED', 'CANCELED'] as const
export const STOCKTAKE_STATUSES = ['DRAFT', 'POSTED', 'CANCELED'] as const
export const STOCKTAKE_SCOPES = ['ALL', 'SELECTED'] as const

/** Daftar nilai untuk klausa CHECK `IN (...)`. */
export function sqlInList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ')
}
