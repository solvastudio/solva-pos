import { createFileRoute } from '@tanstack/react-router'
import { resolveTenantBySlug } from '~/modules/identity/public'
import { handleRequestWithLog } from '~/server/logging/request-log'
import { buildManifest } from '~/server/pwa/manifest'

export async function handleTenantManifestRequest(
  request: Request,
  rawSlug: string,
): Promise<Response> {
  return handleRequestWithLog(request, async () => {
    const found = await resolveTenantBySlug(rawSlug)
    if (!found || found.status !== 'ACTIVE') {
      return new Response('Not Found', {
        status: 404,
        headers: { 'Cache-Control': 'no-cache' },
      })
    }

    const manifest = buildManifest({ slug: found.slug, name: found.name })
    return new Response(JSON.stringify(manifest), {
      status: 200,
      headers: {
        'Content-Type': 'application/manifest+json; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    })
  })
}

export const Route = createFileRoute('/$tenant/pos/manifest.webmanifest')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleTenantManifestRequest(request, params.tenant),
    },
  },
})
