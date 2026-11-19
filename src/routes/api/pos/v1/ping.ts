import { createFileRoute } from '@tanstack/react-router'
import { SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS } from '~/lib/contracts'
import { deviceRoute, serverAppVersion } from '~/server/device-api'

export const handlePing = deviceRoute(
  async () => {
    const minSchema = SUPPORTED_SCHEMA_VERSIONS[0] ?? 1
    return Response.json(
      {
        ok: true,
        server_time: Date.now(),
        min_schema: minSchema,
        max_schema: SCHEMA_VERSION,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'X-App-Version': serverAppVersion(),
        },
      },
    )
  },
  { auth: false },
)

export const Route = createFileRoute('/api/pos/v1/ping')({
  server: {
    handlers: {
      GET: ({ request }) => handlePing(request),
    },
  },
})
