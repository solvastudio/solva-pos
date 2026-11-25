import { createFileRoute } from '@tanstack/react-router'
import { AcceptBillPayloadV1 } from '~/lib/contracts'
import { acceptBill } from '~/modules/fnb/public'
import { composeServer } from '~/server/composition'
import { deviceRoute, noStoreJson, parseDeviceJson } from '~/server/device-api'
import { AppError } from '~/server/error-classify'

export const handleBillAccept = deviceRoute(
  async ({ request, device, meta }) => {
    if (!device) {
      throw new AppError('UNAUTHORIZED', 'Missing device context')
    }
    composeServer()
    const body = await parseDeviceJson(request, AcceptBillPayloadV1)
    const res = await acceptBill(
      {
        tenantId: device.tenantId,
        deviceId: device.deviceId,
        registerId: device.registerId,
        outletId: device.outletId,
        registerType: device.registerType,
      },
      body,
      {
        requestRef: meta.reqId,
        appVersion: meta.appVersion,
      },
    )
    return noStoreJson(res)
  },
  { auth: true, rateLimiter: 'deviceHandover' },
)

export const Route = createFileRoute('/api/pos/v1/bills/accept')({
  server: {
    handlers: {
      POST: ({ request }) => handleBillAccept(request),
    },
  },
})
