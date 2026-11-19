import '@tanstack/react-start/server-only'
import { appendAuditCommandHandler } from '~/modules/audit/public'
import { extendCredentialIfNeeded, touchDeviceStatus } from '~/modules/identity/public'
import {
  __clearCommandHandlersForTests,
  __clearDeviceStatusPortForTests,
  registerCommandHandler,
  registerDeviceStatusPort,
} from '~/modules/sync/public'

let composed = false

/**
 * Server composition root registering cross-module adapters (FeedSource, CommandHandler,
 * DeviceStatusPort) into Sync without direct module-to-module imports (BR-ARC-004).
 */
export function composeServer(): void {
  if (composed) return
  registerCommandHandler(appendAuditCommandHandler)
  registerDeviceStatusPort({
    touchDeviceStatus,
    extendCredentialIfNeeded,
  })
  composed = true
}

export function resetCompositionForTests(): void {
  __clearCommandHandlersForTests()
  __clearDeviceStatusPortForTests()
  composed = false
}
