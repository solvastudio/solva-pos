import { createFileRoute } from '@tanstack/react-router'
import { handleReset } from '~/server/auth/redeem-handler'

export const Route = createFileRoute('/$tenant/api/reset')({
  server: {
    handlers: {
      POST: ({ request, params }) => handleReset(request, params.tenant),
    },
  },
})
