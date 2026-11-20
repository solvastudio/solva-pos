import { createFileRoute } from '@tanstack/react-router'
import { getReleasePolicy, releaseBlock } from '~/modules/sync/public'
import { deviceRoute, noStoreJson } from '~/server/device-api'

export const handleGetRelease = deviceRoute(
  async () => {
    const policy = await getReleasePolicy()
    return noStoreJson({ release: releaseBlock(policy) })
  },
  { auth: true },
)

export const Route = createFileRoute('/api/pos/v1/release')({
  server: {
    handlers: {
      GET: ({ request }) => handleGetRelease(request),
    },
  },
})
