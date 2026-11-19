import { RESERVED_SLUGS, SLUG_PATTERN } from '~/lib/kernel'

export type TenantRef = { kind: 'slug'; slug: string }

const RESERVED_SET = new Set<string>(RESERVED_SLUGS)

export function parseTenantRefFromPath(pathname: string): TenantRef | null {
  const trimmed = pathname.replace(/^\/+/, '')
  const firstSegment = trimmed.split('/')[0] ?? ''
  if (!SLUG_PATTERN.test(firstSegment) || RESERVED_SET.has(firstSegment)) {
    return null
  }
  return { kind: 'slug', slug: firstSegment }
}
