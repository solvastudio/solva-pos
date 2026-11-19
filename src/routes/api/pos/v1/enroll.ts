import { createFileRoute } from '@tanstack/react-router'
import { enrollDevice } from '~/modules/identity/public'
import { deviceRoute } from '~/server/device-api'

const handleEnroll = deviceRoute(
  async ({ request, meta }) => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      body = null
    }
    const uaHeader = request.headers.get('user-agent')
    const raw =
      body && typeof body === 'object' && !Array.isArray(body)
        ? { user_agent: uaHeader ? uaHeader.slice(0, 300) : undefined, ...(body as Record<string, unknown>) }
        : body

    const result = await enrollDevice(raw, meta.ip, { requestRef: meta.reqId })
    return Response.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  },
  { auth: false },
)

export const Route = createFileRoute('/api/pos/v1/enroll')({
  server: {
    handlers: {
      POST: ({ request }) => handleEnroll(request),
    },
  },
})
