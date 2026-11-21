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

export { saveGrDraft, postGr, reverseGr, listGr, type GrDraftInput, type GrLineInput, type GrPostResult } from './server/gr.service'
export {
  saveTransferDraft,
  cancelTransferDraft,
  sendTransfer,
  receiveTransfer,
  type TransferDraftInput,
  type TransferLineInput,
  type ReceiveLineInput,
} from './server/transfer.service'
export {
  createStocktake,
  saveStocktakeCounts,
  previewStocktake,
  postStocktake,
  cancelStocktake,
  type StocktakeCreateInput,
} from './server/stocktake.service'
export { enableOutletTracking } from './server/activation.service'
export { nextDocNo, type DocKind } from './server/doc-no'
export { reportR02, type R02Filter, type R02Result, type R02Row, type R02OutletTotal, type AvailabilityFilter } from './server/report-r02.service'
export { listSuppliers, saveSupplier, deleteSupplier, type SupplierRow, type SupplierInput } from './server/supplier.service'
export { listSkuOptions, type SkuOption } from './server/sku-options.service'
export {
  listTransfers,
  getTransfer,
  listStocktakes,
  getStocktake,
  type TransferListRow,
  type TransferDetail,
  type TransferLineView,
  type StocktakeListRow,
  type StocktakeDetail,
  type StocktakeLineView,
} from './server/stock-lists.service'
