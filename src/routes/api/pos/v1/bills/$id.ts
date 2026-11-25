import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { getBillDetail } from '~/modules/fnb/public'
import { composeServer } from '~/server/composition'
import { withTenantReadOnly } from '~/server/db'
import { deviceRoute, noStoreJson } from '~/server/device-api'
import { AppError } from '~/server/error-classify'

const uuidSchema = z.uuid()

export const handleGetBillDetail = deviceRoute(
  async ({ request, device }) => {
    if (!device) {
      throw new AppError('UNAUTHORIZED', 'Missing device context')
    }
    composeServer()
    const url = new URL(request.url)
    const billId = url.pathname.split('/').pop() ?? ''
    if (!uuidSchema.safeParse(billId).success) {
      return noStoreJson({ error: { code: 'NOT_FOUND', message: 'Bill not found' } }, 404)
    }

    const detail = await withTenantReadOnly(device.tenantId, (tx) =>
      getBillDetail(tx, {
        tenantId: device.tenantId,
        outletId: device.outletId,
        billId,
      }),
    )

    if (!detail) {
      return noStoreJson({ error: { code: 'NOT_FOUND', message: 'Bill not found' } }, 404)
    }

    return noStoreJson(detail)
  },
  { auth: true, rateLimiter: 'devicePull' },
)

export const Route = createFileRoute('/api/pos/v1/bills/$id')({
  server: {
    handlers: {
      GET: ({ request }) => handleGetBillDetail(request),
    },
  },
})
