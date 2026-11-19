import { createFileRoute } from '@tanstack/react-router'
import { PushRequest, SCHEMA_VERSION } from '~/lib/contracts'
import { processPush } from '~/modules/sync/public'
import { tryAcquirePushSlot } from '~/server/auth/rate-limit/push-limits'
import { composeServer } from '~/server/composition'
import { deviceRoute } from '~/server/device-api'
import { AppError } from '~/server/error-classify'

const MAX_PUSH_BODY_BYTES = 1024 * 1024

function payloadTooLargeResponse(ref: string): Response {
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

export const handlePush = deviceRoute(
  async ({ request, device, meta }) => {
    if (!device) {
      throw new AppError('UNAUTHORIZED', 'Missing device context')
    }

    composeServer()

    const rawContentLength = request.headers.get('content-length')
    if (rawContentLength !== null) {
      const declaredBytes = Number(rawContentLength)
      if (Number.isFinite(declaredBytes) && declaredBytes > MAX_PUSH_BODY_BYTES) {
        return payloadTooLargeResponse(meta.reqId)
      }
    }

    const rawText = await request.text()
    if (Buffer.byteLength(rawText, 'utf8') > MAX_PUSH_BODY_BYTES) {
      return payloadTooLargeResponse(meta.reqId)
    }

    let rawJson: unknown
    try {
      rawJson = JSON.parse(rawText)
    } catch {
      throw new AppError('VALIDATION_FAILED', 'Malformed JSON body')
    }

    const parsed = PushRequest.safeParse(rawJson)
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid push request body')
    }

    const releaseSlot = tryAcquirePushSlot(device.deviceId)
    try {
      const result = await processPush(device, parsed.data, {
        schemaVersion: meta.schemaVersion ?? SCHEMA_VERSION,
        appVersion: meta.appVersion,
        syncProtocol: meta.syncProtocolVersion,
        requestRef: meta.reqId,
      })

      return Response.json(result, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      })
    } finally {
      releaseSlot()
    }
  },
  { auth: true, rateLimiter: 'devicePush' },
)

export const Route = createFileRoute('/api/pos/v1/push')({
  server: {
    handlers: {
      POST: ({ request }) => handlePush(request),
    },
  },
})
