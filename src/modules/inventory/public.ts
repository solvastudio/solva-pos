/**
 * Antarmuka publik modul inventori (ARCHITECTURE §8.4). Modul lain hanya mengimpor dari sini.
 * Fase 52: penerap ledger dan mesin costing. Dokumen admin dan integrasi penjualan menyusul (Fase 53–54).
 */
export { applyMovements, type AppliedMovement, type ApplyContext, type ApplyResult, type MovementIntent } from './server/ledger.service'
export {
  applyReturnStock,
  applySaleStock,
  applyVoidStock,
  readOutletStockForSnapshot,
  type ReturnStockInput,
  type ReturnStockLine,
  type SaleStockInput,
  type SaleStockLine,
  type SaleStockResult,
  type VoidStockInput,
  type VoidStockLine,
} from './server/sale-stock.service'
export { applyAdjustment, applyIn, applyInAtReference, applyOut, averageCostForDisplay, emptyBalance, referenceUnit, type CostResult, type StockBalance } from './domain/costing'
export { MOVEMENT_TYPES, COST_BASIS, STOCK_SOURCE_TYPES, type MovementType, type StockSourceType, type CostBasisCode } from './domain/movement-types'
