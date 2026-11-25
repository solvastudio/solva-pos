import { createFileRoute } from '@tanstack/react-router'
import { CancelBillHandoverPayloadV1 } from '~/lib/contracts'
import { cancelBillHandover } from '~/modules/fnb/public'
import { composeServer } from '~/server/composition'
import { deviceRoute, noStoreJson, parseDeviceJson } from '~/server/device-api'
import { AppError } from '~/server/error-classify'

export const handleBillHandoverCancel = deviceRoute(
  async ({ request, device, meta }) => {
    if (!device) {
      throw new AppError('UNAUTHORIZED', 'Missing device context')
    }
    composeServer()
    const body = await parseDeviceJson(request, CancelBillHandoverPayloadV1)
    const res = await cancelBillHandover(
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

export const Route = createFileRoute('/api/pos/v1/bills/handover/cancel')({
  server: {
    handlers: {
      POST: ({ request }) => handleBillHandoverCancel(request),
    },
  },
})
