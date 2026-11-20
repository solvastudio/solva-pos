import { createFileRoute } from '@tanstack/react-router'
import { lookupInvoiceForReturn } from '~/modules/sales/public'
import { composeServer } from '~/server/composition'
import { deviceRoute, noStoreJson } from '~/server/device-api'
import { AppError } from '~/server/error-classify'

export const handleGetInvoice = deviceRoute(
  async ({ request, device }) => {
    if (!device) {
      throw new AppError('UNAUTHORIZED', 'Missing device context')
    }
    composeServer()
    const url = new URL(request.url)
    const no = url.searchParams.get('no') ?? ''
    if (!no.trim()) {
      throw new AppError('VALIDATION_FAILED', 'Missing invoice number query parameter "no"')
    }
    const res = await lookupInvoiceForReturn({
      tenantId: device.tenantId,
      outletId: device.outletId,
      invoiceNo: no,
    })
    if (!res) {
      return noStoreJson({ error: { code: 'NOT_FOUND' } }, 404)
    }
    return noStoreJson(res)
  },
  { auth: true, rateLimiter: 'deviceInvoice' },
)

export const Route = createFileRoute('/api/pos/v1/invoice')({
  server: {
    handlers: {
      GET: ({ request }) => handleGetInvoice(request),
    },
  },
})
