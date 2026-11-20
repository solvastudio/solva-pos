import { useQuery } from '@tanstack/react-query'

export interface TenantPreview {
  name: string
  slug: string
  onlineResolved: boolean
}

/**
 * Online-only preview fetch for SCR-P01 pairing screen: reads display name from
 * `/<slug>/pos/manifest.webmanifest` without persistent caching, falling back to slug.
 */
export function useTenantPreview(slug: string): TenantPreview {
  const cleanSlug = slug.trim().toLowerCase()
  const query = useQuery({
    queryKey: ['pos-tenant-preview', cleanSlug],
    networkMode: 'online',
    gcTime: 0,
    staleTime: 0,
    retry: 0,
    queryFn: async () => {
      const res = await fetch(`/${cleanSlug}/pos/manifest.webmanifest`, {
        cache: 'no-cache',
      })
      if (!res.ok) {
        throw new Error(`Manifest preview HTTP ${res.status}`)
      }
      const data = (await res.json()) as { name?: unknown }
      if (typeof data.name !== 'string' || !data.name.trim()) {
        throw new Error('Missing manifest tenant name')
      }
      return data.name.trim()
    },
  })

  return {
    name: query.data ?? `/${cleanSlug}`,
    slug: cleanSlug,
    onlineResolved: Boolean(query.data),
  }
}
