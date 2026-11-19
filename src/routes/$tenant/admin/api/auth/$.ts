import { createFileRoute } from '@tanstack/react-router'
import { handleAuthRoute } from '~/server/auth/login-handler'

export const Route = createFileRoute('/$tenant/admin/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleAuthRoute(request, params.tenant),
      POST: ({ request, params }) => handleAuthRoute(request, params.tenant),
    },
  },
})
