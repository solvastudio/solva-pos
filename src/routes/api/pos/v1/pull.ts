import { createFileRoute } from '@tanstack/react-router'
import { PullRequest, SCHEMA_VERSION } from '~/lib/contracts'
import { handlePull } from '~/modules/sync/public'
import { composeServer } from '~/server/composition'
import { deviceRoute, noStoreJson, parseDeviceJson } from '~/server/device-api'
import { AppError } from '~/server/error-classify'

export const handlePullRequest = deviceRoute(
  async ({ request, device, meta }) => {
    if (!device) {
      throw new AppError('UNAUTHORIZED', 'Missing device context')
    }
    composeServer()
    const body = await parseDeviceJson(request, PullRequest)
    const res = await handlePull(device, body, {
      schemaVersion: meta.schemaVersion ?? SCHEMA_VERSION,
      appVersion: meta.appVersion,
      syncProtocol: meta.syncProtocolVersion,
      requestRef: meta.reqId,
    })
    return noStoreJson(res)
  },
  { auth: true, rateLimiter: 'devicePull' },
)

export const Route = createFileRoute('/api/pos/v1/pull')({
  server: {
    handlers: {
      POST: ({ request }) => handlePullRequest(request),
    },
  },
})
