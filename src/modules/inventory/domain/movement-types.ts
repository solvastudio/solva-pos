/**
 * Inventory enum constants (SCHEMA §4.3.2–4.3.7, Appendix A). Used by the schema (CHECK) and the domain.
 * The values must match the migration CHECK constraints exactly; schema tests verify this.
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

/** Value list for the CHECK `IN (...)` clause. */
export function sqlInList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ')
}
