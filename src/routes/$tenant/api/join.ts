import { createFileRoute } from '@tanstack/react-router'
import { handleJoin } from '~/server/auth/redeem-handler'

export const Route = createFileRoute('/$tenant/api/join')({
  server: {
    handlers: {
      POST: ({ request, params }) => handleJoin(request, params.tenant),
    },
  },
})
