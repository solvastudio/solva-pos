import { normalizeSlug, SLUG_PATTERN } from '~/lib/kernel'

function hasForbiddenChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f || code === 0x5c) {
      return true
    }
  }
  return false
}

/**
 * Validates and normalizes `returnTo` on `/<slug>/admin/login`.
 * Restricts redirects strictly to same-origin paths inside `/<slug>/admin` (BR-IDN / SEC).
 */
export function safeReturnTo(raw: string | null | undefined, tenantSlug: string): string {
  const slug = normalizeSlug(tenantSlug)
  const fallback = `/${slug}/admin`

  if (!raw || typeof raw !== 'string') {
    return fallback
  }

  const trimmed = raw.trim()
  if (!trimmed || hasForbiddenChars(trimmed)) {
    return fallback
  }

  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return fallback
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(trimmed)
  } catch {
    return fallback
  }
  if (hasForbiddenChars(decoded) || decoded.startsWith('//') || !decoded.startsWith('/')) {
    return fallback
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed, 'https://solva.invalid')
  } catch {
    return fallback
  }

  if (parsed.origin !== 'https://solva.invalid') {
    return fallback
  }

  const adminPrefix = `/${slug}/admin`
  const lowerPathname = parsed.pathname.toLowerCase()
  const isAdminRoot = lowerPathname === adminPrefix
  const isAdminSubpath = lowerPathname.startsWith(`${adminPrefix}/`)

  if (!isAdminRoot && !isAdminSubpath) {
    return fallback
  }

  if (!SLUG_PATTERN.test(slug)) {
    return '/'
  }

  // Normalize leading tenant segment to canonical lowercase slug while preserving rest.
  const rest = parsed.pathname.slice(adminPrefix.length)
  return `${adminPrefix}${rest}${parsed.search}${parsed.hash}`
}
