import { createFileRoute } from '@tanstack/react-router'
import { isUuid } from '~/lib/kernel'
import { loadOutletLogoAsset } from '~/modules/sales/public'
import { composeServer } from '~/server/composition'
import { deviceRoute, noStoreJson } from '~/server/device-api'
import { AppError } from '~/server/error-classify'

export const handleGetOutletLogo = deviceRoute(
  async ({ request, device }) => {
    if (!device) {
      throw new AppError('UNAUTHORIZED', 'Missing device context')
    }
    const pathname = new URL(request.url).pathname.replace(/\/+$/, '')
    const outletId = pathname.split('/').pop() ?? ''
    if (!isUuid(outletId) || outletId !== device.outletId) {
      return noStoreJson({ error: { code: 'NOT_FOUND' } }, 404)
    }

    composeServer()
    const asset = await loadOutletLogoAsset({
      tenantId: device.tenantId,
      outletId,
    })
    if (!asset) {
      return noStoreJson({ error: { code: 'NOT_FOUND' } }, 404)
    }

    const headers = new Headers()
    headers.set('content-type', asset.contentType)
    headers.set('cache-control', 'no-store')
    if (asset.sha256) {
      headers.set('etag', `"${asset.sha256}"`)
    }
    return new Response(new Uint8Array(asset.bytes), { status: 200, headers })
  },
  { auth: true, rateLimiter: 'devicePull' },
)

export const Route = createFileRoute('/api/pos/v1/assets/logo/$outletId')({
  server: {
    handlers: {
      GET: ({ request }) => handleGetOutletLogo(request),
    },
  },
})
