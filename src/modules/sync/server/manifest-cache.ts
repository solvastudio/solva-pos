import type { FeedScope } from '../domain/feed-types'

export const MANIFEST_CACHE_MAX_ENTRIES = 500

const cache = new Map<string, Record<string, number>>()

/**
 * Manifest counts only change when the tenant master version (`upper`) moves, so they are cached per
 * device scope and version. An idle device that polls every minute then skips the per-entity count queries.
 */
export function manifestCountsKey(scope: FeedScope, upper: number): string {
  return `${scope.tenantId}|${scope.outletId}|${scope.registerId}|${scope.deviceId}|${upper}`
}

export function getCachedManifestCounts(key: string): Record<string, number> | undefined {
  const hit = cache.get(key)
  if (hit) {
    // Refresh the LRU position.
    cache.delete(key)
    cache.set(key, hit)
  }
  return hit
}

export function setCachedManifestCounts(key: string, counts: Record<string, number>): void {
  cache.delete(key)
  if (cache.size >= MANIFEST_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) {
      cache.delete(oldest)
    }
  }
  cache.set(key, counts)
}

export function __resetManifestCacheForTests(): void {
  cache.clear()
}
