import '@tanstack/react-start/server-only'
import { appendAuditCommandHandler } from '~/modules/audit/public'
import {
  extendCredentialIfNeeded,
  identityFeedSources,
  touchDeviceStatus,
} from '~/modules/identity/public'
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
 * DeviceStatusPort) into Sync without direct module-to-module imports (BR-ARC-004).
 */
export function composeServer(): void {
  if (composed) return
  for (const source of identityFeedSources()) {
    registerFeedSource(source)
  }
  registerCommandHandler(appendAuditCommandHandler)
  registerDeviceStatusPort({
    touchDeviceStatus,
    extendCredentialIfNeeded,
  })
  composed = true
}

export function resetCompositionForTests(): void {
  __resetForTests()
  __clearCommandHandlersForTests()
  __clearDeviceStatusPortForTests()
  composed = false
}
