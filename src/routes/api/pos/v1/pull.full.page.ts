import { createFileRoute } from '@tanstack/react-router'
import { FullPageRequest } from '~/lib/contracts'
import { fullResyncPage } from '~/modules/sync/public'
import { composeServer } from '~/server/composition'
import { deviceRoute, noStoreJson, parseDeviceJson } from '~/server/device-api'
import { AppError } from '~/server/error-classify'

export const handlePullFullPage = deviceRoute(
  async ({ request, device }) => {
    if (!device) {
      throw new AppError('UNAUTHORIZED', 'Missing device context')
    }
    composeServer()
    const body = await parseDeviceJson(request, FullPageRequest)
    const res = await fullResyncPage(device, body)
    return noStoreJson(res)
  },
  { auth: true, rateLimiter: 'devicePullFullPage' },
)

export const Route = createFileRoute('/api/pos/v1/pull/full/page')({
  server: {
    handlers: {
      POST: ({ request }) => handlePullFullPage(request),
    },
  },
})
