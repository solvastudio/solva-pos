import '@tanstack/react-start/server-only'
import { normalizeSlug, RESERVED_SLUGS, SLUG_PATTERN } from '~/lib/kernel'
import { withNoTenant, type NoTenantTx } from '~/server/db'
import { callResolveTenantBySlug, type ResolvedTenantRow, type TenantStatus } from './tenant-resolver.repo'

export interface TenantResolution {
  tenantId: string
  slug: string
  status: TenantStatus
  name: string
}

export interface ResolveTenantDeps {
  now?: () => number
  queryBySlug?: (slug: string) => Promise<ResolvedTenantRow | null>
}

const RESERVED_SET = new Set<string>(RESERVED_SLUGS)
const FOUND_TTL_MS = 60_000
const NOT_FOUND_TTL_MS = 10_000
const MAX_CACHE_ENTRIES = 5_000

const cache = new Map<string, { value: TenantResolution | null; expiresAt: number }>()

function setCacheEntry(slug: string, value: TenantResolution | null, expiresAt: number): void {
  if (cache.has(slug)) {
    cache.delete(slug)
  } else if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) {
      cache.delete(oldestKey)
    }
  }
  cache.set(slug, { value, expiresAt })
}

async function defaultQueryBySlug(slug: string): Promise<ResolvedTenantRow | null> {
  return withNoTenant((tx: NoTenantTx) => callResolveTenantBySlug(tx, slug))
}

/**
 * Resolves a tenant by slug without logging tenant names or hitting DB for invalid slugs.
 */
export async function resolveTenantBySlug(
  rawSlug: string,
  deps?: ResolveTenantDeps,
): Promise<TenantResolution | null> {
  const slug = normalizeSlug(rawSlug)
  if (!SLUG_PATTERN.test(slug) || RESERVED_SET.has(slug)) {
    return null
  }

  const now = deps?.now ?? Date.now
  const nowMs = now()

  const cached = cache.get(slug)
  if (cached && cached.expiresAt > nowMs) {
    return cached.value
  }
  if (cached) {
    cache.delete(slug)
  }

  const query = deps?.queryBySlug ?? defaultQueryBySlug
  const row = await query(slug)
  if (!row) {
    setCacheEntry(slug, null, nowMs + NOT_FOUND_TTL_MS)
    return null
  }

  const resolution: TenantResolution = {
    tenantId: row.id,
    slug,
    status: row.status,
    name: row.name,
  }
  setCacheEntry(slug, resolution, nowMs + FOUND_TTL_MS)
  return resolution
}

export function invalidateTenantCache(rawSlug: string): void {
  cache.delete(normalizeSlug(rawSlug))
}

export function __clearTenantCacheForTests(): void {
  cache.clear()
}
