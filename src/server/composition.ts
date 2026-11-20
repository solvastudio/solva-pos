import '@tanstack/react-start/server-only'
import { appendAuditCommandHandler } from '~/modules/audit/public'
import {
  __clearHasTransactionsPortForTests,
  catalogFeedSources,
  createDefaultAvailabilityForOutlet,
  registerHasTransactionsPort,
} from '~/modules/catalog/public'
import {
  __clearOutletCreatedHooksForTests,
  extendCredentialIfNeeded,
  identityFeedSources,
  registerOutletCreatedHook,
  touchDeviceStatus,
} from '~/modules/identity/public'
import { hasSalesForProductOrSku } from '~/modules/sales/public'
import {
  __clearCommandHandlersForTests,
  __clearDeviceStatusPortForTests,
  __resetForTests,
  registerCommandHandler,
  registerDeviceStatusPort,
  registerFeedSource,
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
  registerDeviceStatusPort({
    touchDeviceStatus,
    extendCredentialIfNeeded,
  })
  registerHasTransactionsPort({
    hasTransactions: hasSalesForProductOrSku,
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
  composed = false
}
