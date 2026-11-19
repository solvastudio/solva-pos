import { createFileRoute } from '@tanstack/react-router'
import { FullStartRequest, SCHEMA_VERSION } from '~/lib/contracts'
import { startFullResync } from '~/modules/sync/public'
import { composeServer } from '~/server/composition'
import { deviceRoute, noStoreJson, parseDeviceJson } from '~/server/device-api'
import { AppError } from '~/server/error-classify'

export const handlePullFullStart = deviceRoute(
  async ({ request, device, meta }) => {
    if (!device) {
      throw new AppError('UNAUTHORIZED', 'Missing device context')
    }
    composeServer()
    const body = await parseDeviceJson(request, FullStartRequest)
    const res = await startFullResync(device, body, {
      schemaVersion: meta.schemaVersion ?? SCHEMA_VERSION,
      appVersion: meta.appVersion,
      syncProtocol: meta.syncProtocolVersion,
      requestRef: meta.reqId,
    })
    return noStoreJson(res)
  },
  { auth: true, rateLimiter: 'devicePull' },
)

export const Route = createFileRoute('/api/pos/v1/pull/full/start')({
  server: {
    handlers: {
      POST: ({ request }) => handlePullFullStart(request),
    },
  },
})
