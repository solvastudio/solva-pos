import { createFileRoute } from '@tanstack/react-router'
import { checkHealth } from '~/server/health'
import { handleRequestWithLog } from '~/server/logging/request-log'

export async function handleHealthRequest(request: Request): Promise<Response> {
  return handleRequestWithLog(request, async () => {
    const result = await checkHealth()
    return Response.json(result.body, {
      status: result.httpStatus,
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  })
}

export const Route = createFileRoute('/health')({
  server: {
    handlers: {
      GET: ({ request }) => handleHealthRequest(request),
    },
  },
})
