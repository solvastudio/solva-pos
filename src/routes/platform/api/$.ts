import { createFileRoute } from '@tanstack/react-router'
import { handlePlatformApi } from '~/server/auth/platform-handler'

export const Route = createFileRoute('/platform/api/$')({
  server: {
    handlers: {
      GET: ({ request }) => handlePlatformApi(request),
      POST: ({ request }) => handlePlatformApi(request),
    },
  },
})
