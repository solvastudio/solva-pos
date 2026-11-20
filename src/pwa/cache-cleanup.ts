export const PRECACHE_NAME = 'solva-precache'
export const MANIFEST_CACHE_NAME = 'solva-manifests'
export const META_CACHE_NAME = 'solva-meta'

export interface ManifestRecord {
  scope: string
  urls: readonly string[]
}

export interface LastGoodRecord {
  scope: string
  appVersion: string
  dexieVersion: number
  urls: readonly string[]
  markedAt: string
}

export function scopeManifestKey(scope: string): string {
  return `/__manifest/${encodeURIComponent(scope)}`
}

export function lastGoodKey(scope: string): string {
  return `/__lastgood/${encodeURIComponent(scope)}`
}

/**
 * Computes the union of cached asset URLs across all registered tenant scopes.
 */
export function unionManifests(
  records: Iterable<ManifestRecord | readonly string[]>,
): Set<string> {
  const union = new Set<string>()
  for (const record of records) {
    const urls = Array.isArray(record) ? record : (record as ManifestRecord).urls
    for (const url of urls) {
      union.add(url)
    }
  }
  return union
}

/**
 * Returns only cached URLs that belong to neither any active scope manifest
 * nor any protected last-known-good asset set.
 */
export function entriesToDelete(
  cachedUrls: readonly string[],
  union: ReadonlySet<string>,
  protectLastGood: ReadonlySet<string> = new Set<string>(),
): string[] {
  const deletions: string[] = []
  for (const url of cachedUrls) {
    if (!union.has(url) && !protectLastGood.has(url)) {
      deletions.push(url)
    }
  }
  return deletions
}

export interface CacheLike {
  keys(): Promise<readonly { url: string }[]>
  match(request: string): Promise<Response | undefined>
  put(request: string, response: Response): Promise<void>
  delete(request: string): Promise<boolean>
}

export async function recordManifest(
  cache: CacheLike,
  scope: string,
  urls: readonly string[],
): Promise<void> {
  const payload: ManifestRecord = { scope, urls: [...urls] }
  await cache.put(
    scopeManifestKey(scope),
    new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

export async function removeManifest(cache: CacheLike, scope: string): Promise<boolean> {
  return cache.delete(scopeManifestKey(scope))
}

export async function readAllManifests(cache: CacheLike): Promise<ManifestRecord[]> {
  const keys = await cache.keys()
  const records: ManifestRecord[] = []
  for (const req of keys) {
    const res = await cache.match(req.url)
    if (!res) continue
    try {
      const parsed = (await res.json()) as unknown
      if (Array.isArray(parsed)) {
        records.push({ scope: req.url, urls: parsed.filter((u): u is string => typeof u === 'string') })
      } else if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as Partial<ManifestRecord>).urls)
      ) {
        const rec = parsed as Partial<ManifestRecord>
        records.push({
          scope: typeof rec.scope === 'string' ? rec.scope : req.url,
          urls: (rec.urls ?? []).filter((u): u is string => typeof u === 'string'),
        })
      }
    } catch {
      // Ignore corrupt manifest cache entries so cleanup stays safe.
    }
  }
  return records
}

export async function writeLastGood(cache: CacheLike, state: LastGoodRecord): Promise<void> {
  await cache.put(
    lastGoodKey(state.scope),
    new Response(JSON.stringify(state), {
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

export async function readProtectedLastGoodUrls(metaCache: CacheLike): Promise<Set<string>> {
  const protectedUrls = new Set<string>()
  const keys = await metaCache.keys()
  for (const req of keys) {
    if (!req.url.includes('/__lastgood/')) continue
    const res = await metaCache.match(req.url)
    if (!res) continue
    try {
      const parsed = (await res.json()) as Partial<LastGoodRecord>
      if (Array.isArray(parsed.urls)) {
        for (const u of parsed.urls) {
          if (typeof u === 'string') {
            protectedUrls.add(u)
          }
        }
      }
    } catch {
      // Ignore corrupt metadata entries.
    }
  }
  return protectedUrls
}

export function firstClaimKey(scope: string): string {
  return `/__first_claim/${encodeURIComponent(scope)}`
}

/**
 * Persists first-install claim intent in Cache Storage during `install` when there
 * is no existing active worker so `activate` still calls `clients.claim()` even if
 * the browser terminates the service worker thread between `install` and `activate`.
 */
export async function prepareFirstClaimOnInstall(
  metaCache: CacheLike,
  scope: string,
  hasActiveWorker: boolean,
): Promise<boolean> {
  if (hasActiveWorker) {
    return false
  }
  await metaCache.put(
    firstClaimKey(scope),
    new Response(JSON.stringify({ firstInstall: true }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  return true
}

/**
 * Atomically reads and clears the persistent first-install claim marker on `activate`.
 */
export async function consumePendingFirstClaim(
  metaCache: CacheLike,
  scope: string,
): Promise<boolean> {
  const key = firstClaimKey(scope)
  const hit = await metaCache.match(key)
  if (!hit) {
    return false
  }
  await metaCache.delete(key)
  return true
}
