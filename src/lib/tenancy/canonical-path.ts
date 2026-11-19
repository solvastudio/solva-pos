/**
 * Canonicalizes sub-path tenant URLs for 308 permanent redirects:
 * - Collapses repeated slashes (`//` -> `/`)
 * - Removes a single trailing slash (except root `/`)
 * - Lowercases only the first path segment (tenant slug) without altering later segments
 */
export function canonicalizePath(pathname: string): { changed: boolean; pathname: string } {
  let normalized = pathname.replace(/\/{2,}/g, '/')
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  const segments = normalized.split('/')
  if (segments.length >= 2 && segments[1]!.length > 0) {
    segments[1] = segments[1]!.toLowerCase()
  }
  const finalPath = segments.join('/') || '/'
  return {
    changed: finalPath !== pathname,
    pathname: finalPath,
  }
}
