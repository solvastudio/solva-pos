import { createFileRoute } from '@tanstack/react-router'
import { DeviceLogRequestSchema, MAX_DEVICE_LOG_BODY_BYTES } from '~/lib/contracts'
import { ingestDeviceLog } from '~/modules/sync/public'
import { deviceRoute, noStoreJson } from '~/server/device-api'
import { AppError } from '~/server/error-classify'

function payloadTooLarge(ref: string): Response {
  return Response.json(
    {
      error: {
        code: 'VALIDATION_FAILED',
        ref,
        class: 'structural',
      },
    },
    {
      status: 413,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}

export const handleDeviceLog = deviceRoute(
  async ({ request, device, meta }) => {
    if (!device) {
      throw new AppError('UNAUTHORIZED', 'Missing device context')
    }

    const declaredLen = request.headers.get('content-length')
    if (declaredLen !== null) {
      const bytes = Number(declaredLen)
      if (Number.isFinite(bytes) && bytes > MAX_DEVICE_LOG_BODY_BYTES) {
        return payloadTooLarge(meta.reqId)
      }
    }

    const rawText = await request.text()
    if (Buffer.byteLength(rawText, 'utf8') > MAX_DEVICE_LOG_BODY_BYTES) {
      return payloadTooLarge(meta.reqId)
    }

    let rawJson: unknown
    try {
      rawJson = JSON.parse(rawText)
    } catch {
      throw new AppError('VALIDATION_FAILED', 'Malformed JSON body')
    }

    const parsed = DeviceLogRequestSchema.safeParse(rawJson)
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid device log payload')
    }

    const res = await ingestDeviceLog(device, parsed.data.entries)
    return noStoreJson(res)
  },
  { auth: true },
)

export const Route = createFileRoute('/api/pos/v1/device-log')({
  server: {
    handlers: {
      POST: ({ request }) => handleDeviceLog(request),
    },
  },
})
