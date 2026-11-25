import '@tanstack/react-start/server-only'
import { appendAudit, appendAuditCommandHandler } from '~/modules/audit/public'
import {
  __clearHasTransactionsPortForTests,
  catalogFeedSources,
  catalogFnbFeedSources,
  createDefaultAvailabilityForOutlet,
  registerHasTransactionsPort,
  registerRecipeCostReaderPort,
} from '~/modules/catalog/public'
import {
  appendBillEventsCommandHandler,
  fnbFeedSources,
  getBillForPayment,
  markBillPaid,
} from '~/modules/fnb/public'
import {
  __clearEnrollmentCounterProviderForTests,
  __clearOutletCreatedHooksForTests,
  extendCredentialIfNeeded,
  identityFeedSources,
  registerEnrollmentCounterProvider,
  registerOutletCreatedHook,
  reportPinStateCommandHandler,
  touchDeviceStatus,
} from '~/modules/identity/public'
import {
  __clearBillPortForTests,
  __clearSaleStockPortForTests,
  finalizeCreditNoteCommandHandler,
  finalizeSaleCommandHandler,
  getRecoveryCountersAndBindDevice,
  getShiftCashSalesAndRefundTotals,
  hasSalesForProductOrSku,
  registerBillPort,
  registerSaleStockPort,
  voidSaleCommandHandler,
} from '~/modules/sales/public'
import {
  applyReturnStock,
  applySaleStock,
  applyVoidStock,
  readOutletStockForSnapshot,
  readTenantSkuAverageCosts,
} from '~/modules/inventory/public'
import {
  __clearShiftRecapSalesPortForTests,
  closeShiftCommandHandler,
  openShiftCommandHandler,
  recordCashMovementCommandHandler,
  registerShiftRecapSalesPort,
} from '~/modules/shift/public'
import {
  __clearOutletStockReaderForTests,
  registerOutletStockReader,
  __clearCommandHandlersForTests,
  __clearDeviceStatusPortForTests,
  __resetForTests,
  registerCommandHandler,
  registerDeviceStatusPort,
  registerFeedSource,
  registerSyncAuditWriter,
} from '~/modules/sync/public'

let composed = false

/**
 * Server composition root registering cross-module adapters (FeedSource, CommandHandler,
 * DeviceStatusPort, Catalog ports & hooks) without direct module-to-module imports (BR-ARC-004).
 */
export function composeServer(): void {
  if (composed) return
  for (const source of identityFeedSources()) {
    registerFeedSource(source)
  }
  for (const source of catalogFeedSources()) {
    registerFeedSource(source)
  }
  for (const source of catalogFnbFeedSources()) {
    registerFeedSource(source)
  }
  for (const source of fnbFeedSources()) {
    registerFeedSource(source)
  }
  registerCommandHandler(appendAuditCommandHandler)
  registerCommandHandler(reportPinStateCommandHandler)
  registerCommandHandler(finalizeSaleCommandHandler)
  registerCommandHandler(voidSaleCommandHandler)
  registerCommandHandler(finalizeCreditNoteCommandHandler)
  registerCommandHandler(openShiftCommandHandler)
  registerCommandHandler(recordCashMovementCommandHandler)
  registerCommandHandler(closeShiftCommandHandler)
  registerCommandHandler(appendBillEventsCommandHandler)
  registerBillPort({
    lockBillForPayment: (tx, tenantId, billId) => getBillForPayment(tx, tenantId, billId),
    markBillPaid: (tx, tenantId, billId, nowIso) => markBillPaid(tx, tenantId, billId, nowIso),
  })
  registerDeviceStatusPort({
    touchDeviceStatus,
    extendCredentialIfNeeded,
  })
  registerSyncAuditWriter((tx, input, deps) => appendAudit(tx, input, deps))
  registerHasTransactionsPort({
    hasTransactions: hasSalesForProductOrSku,
  })
  registerShiftRecapSalesPort({
    getShiftCashTotals: getShiftCashSalesAndRefundTotals,
  })
  registerEnrollmentCounterProvider({
    getCountersAndBindDevice: getRecoveryCountersAndBindDevice,
  })
  registerOutletCreatedHook((tx, w, outlet) =>
    createDefaultAvailabilityForOutlet(tx, w, outlet.id),
  )
  // Stock adapter: sales only knows the port; the implementation comes from inventory.
  registerSaleStockPort({
    applySale: (tx, input) => applySaleStock(tx, input),
    applyVoid: async (tx, input) => {
      await applyVoidStock(tx, input)
    },
    applyReturn: (tx, input) => applyReturnStock(tx, input),
  })
  // Stock snapshot reader for pull.
  registerOutletStockReader({
    read: (tx, tenantId, outletId) => readOutletStockForSnapshot(tx, tenantId, outletId),
  })
  registerRecipeCostReaderPort((tx, tenantId, skuIds) =>
    readTenantSkuAverageCosts(tx, tenantId, skuIds),
  )
  composed = true
}

export function resetCompositionForTests(): void {
  __resetForTests()
  __clearCommandHandlersForTests()
  __clearDeviceStatusPortForTests()
  __clearHasTransactionsPortForTests()
  __clearOutletCreatedHooksForTests()
  __clearShiftRecapSalesPortForTests()
  __clearEnrollmentCounterProviderForTests()
  __clearSaleStockPortForTests()
  __clearBillPortForTests()
  __clearOutletStockReaderForTests()
  registerRecipeCostReaderPort(null)
  composed = false
}
