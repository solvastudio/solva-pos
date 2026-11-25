import { createFileRoute } from '@tanstack/react-router'
import type { SignalMessage } from '~/lib/contracts'
import { getSignalsHub } from '~/modules/sync/public'
import { deviceRoute } from '~/server/device-api'
import { AppError } from '~/server/error-classify'

export const handleSignals = deviceRoute(
  async ({ device }) => {
    if (!device) {
      throw new AppError('UNAUTHORIZED', 'Missing device context')
    }

    const encoder = new TextEncoder()
    let unregister: (() => void) | null = null
    let closed = false

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const closeSafe = () => {
          if (closed) return
          closed = true
          unregister?.()
          unregister = null
          try {
            controller.close()
          } catch {
            // Stream already closed by consumer.
          }
        }

        const enqueueText = (chunk: string) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(chunk))
          } catch {
            closeSafe()
          }
        }

        unregister = getSignalsHub().register({
          deviceId: device.deviceId,
          tenantId: device.tenantId,
          outletId: device.outletId,
          sendEvent: (msg: SignalMessage) => {
            enqueueText(`data: ${JSON.stringify(msg)}\n\n`)
          },
          sendComment: (comment: string) => {
            enqueueText(`: ${comment}\n\n`)
          },
          close: closeSafe,
        })

        enqueueText(': connected\n\n')
      },
      cancel() {
        closed = true
        unregister?.()
        unregister = null
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      },
    })
  },
  { auth: true },
)

export const Route = createFileRoute('/api/pos/v1/signals')({
  server: {
    handlers: {
      GET: ({ request }) => handleSignals(request),
    },
  },
})
