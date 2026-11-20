import '@tanstack/react-start/server-only'
import { appendAudit, appendAuditCommandHandler } from '~/modules/audit/public'
import {
  __clearHasTransactionsPortForTests,
  catalogFeedSources,
  createDefaultAvailabilityForOutlet,
  registerHasTransactionsPort,
} from '~/modules/catalog/public'
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
  finalizeCreditNoteCommandHandler,
  finalizeSaleCommandHandler,
  getRecoveryCountersAndBindDevice,
  getShiftCashSalesAndRefundTotals,
  hasSalesForProductOrSku,
  voidSaleCommandHandler,
} from '~/modules/sales/public'
import {
  __clearShiftRecapSalesPortForTests,
  closeShiftCommandHandler,
  openShiftCommandHandler,
  recordCashMovementCommandHandler,
  registerShiftRecapSalesPort,
} from '~/modules/shift/public'
import {
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
  registerCommandHandler(appendAuditCommandHandler)
  registerCommandHandler(reportPinStateCommandHandler)
  registerCommandHandler(finalizeSaleCommandHandler)
  registerCommandHandler(voidSaleCommandHandler)
  registerCommandHandler(finalizeCreditNoteCommandHandler)
  registerCommandHandler(openShiftCommandHandler)
  registerCommandHandler(recordCashMovementCommandHandler)
  registerCommandHandler(closeShiftCommandHandler)
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
  composed = false
}
