import '@tanstack/react-start/server-only'

export { hasSalesForProductOrSku } from './server/has-transactions'
export { finalizeSaleCommandHandler } from './server/finalize-sale.command'
export { voidSaleCommandHandler } from './server/void-sale.command'
export { finalizeCreditNoteCommandHandler } from './server/finalize-credit-note.command'
export { getShiftCashSalesAndRefundTotals } from './server/sale.repo'
export {
  getRecoveryCountersAndBindDevice,
  previewRegisterRecovery,
  recoverRegister,
  type RecoverRegisterInput,
  type RecoverRegisterPreview,
  type RecoverRegisterResult,
  type RecoverySeriesPreview,
} from './server/register-recovery.service'
export { annotateGap, listGaps, type InvoiceGapRow } from './server/gap.service'
export { lookupInvoiceForReturn } from './server/invoice-lookup.service'
