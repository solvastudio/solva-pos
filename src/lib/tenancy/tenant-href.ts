export function tenantHref(slug: string, path: '' | `/${string}`): string {
  const normalizedSlug = slug.trim().toLowerCase()
  return path === '' ? `/${normalizedSlug}` : `/${normalizedSlug}${path}`
}
