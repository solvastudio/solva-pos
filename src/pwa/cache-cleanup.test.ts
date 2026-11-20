import { describe, expect, it } from 'vitest'
import {
  consumePendingFirstClaim,
  entriesToDelete,
  prepareFirstClaimOnInstall,
  unionManifests,
  type CacheLike,
  type ManifestRecord,
} from './cache-cleanup'

function createMemoryCache(store: Map<string, string> = new Map()): CacheLike {
  return {
    async keys() {
      return [...store.keys()].map((url) => ({ url }))
    },
    async match(request: string) {
      const raw = store.get(request)
      return raw === undefined
        ? undefined
        : new Response(raw, { headers: { 'Content-Type': 'application/json' } })
    },
    async put(request: string, response: Response) {
      store.set(request, await response.text())
    },
    async delete(request: string) {
      return store.delete(request)
    },
  }
}

describe('pwa/cache-cleanup (cross-tenant shared cache GC)', () => {
  it('preserves assets still referenced by tenant B when tenant A updates version', () => {
    const v1Common = ['https://pos.solva.test/pos-shell.html?__WB_REVISION__=v1', 'https://pos.solva.test/assets/index-v1.js']
    const v2New = ['https://pos.solva.test/pos-shell.html?__WB_REVISION__=v2', 'https://pos.solva.test/assets/index-v2.js']
    const orphan = 'https://pos.solva.test/assets/old-v0.js'

    const records: ManifestRecord[] = [
      { scope: '/acme/pos/', urls: v2New },
      { scope: '/beta/pos/', urls: v1Common },
    ]

    const union = unionManifests(records)
    const toDelete = entriesToDelete([...v1Common, ...v2New, orphan], union)

    expect(toDelete).toEqual([orphan])
  })

  it('protects last-known-good assets until BOOT_OK replaces them', () => {
    const v1Protected = 'https://pos.solva.test/assets/index-v1.js'
    const v2Active = 'https://pos.solva.test/assets/index-v2.js'
    const obsolete = 'https://pos.solva.test/assets/index-v0.js'

    const union = unionManifests([{ scope: '/acme/pos/', urls: [v2Active] }])

    // Before BOOT_OK: v1 is still in protectLastGood so it MUST NOT be deleted.
    const beforeBootOk = entriesToDelete(
      [obsolete, v1Protected, v2Active],
      union,
      new Set([v1Protected]),
    )
    expect(beforeBootOk).toEqual([obsolete])

    // After BOOT_OK: protectLastGood now holds v2 instead of v1, so v1 is cleaned up.
    const afterBootOk = entriesToDelete(
      [obsolete, v1Protected, v2Active],
      union,
      new Set([v2Active]),
    )
    expect(afterBootOk).toEqual([obsolete, v1Protected])
  })

  it('persists first-install claim intent in Cache Storage across SW worker restarts', async () => {
    const persistentBacking = new Map<string, string>()

    // SW isolate #1: handles `install` when registration has no active worker yet, then terminates.
    const cacheInInstallingWorker = createMemoryCache(persistentBacking)
    const marked = await prepareFirstClaimOnInstall(
      cacheInInstallingWorker,
      'https://pos.solva.test/acme/pos/',
      false,
    )
    expect(marked).toBe(true)

    // SW isolate #2: fresh worker spun up for `activate` reads from persistent Cache Storage.
    const cacheInActivatingWorker = createMemoryCache(persistentBacking)
    expect(
      await consumePendingFirstClaim(cacheInActivatingWorker, 'https://pos.solva.test/acme/pos/'),
    ).toBe(true)
    // Consumed marker is deleted so subsequent activates do not re-claim.
    expect(
      await consumePendingFirstClaim(cacheInActivatingWorker, 'https://pos.solva.test/acme/pos/'),
    ).toBe(false)
  })

  it('skips first-install claim marker on SW updates when an active worker already exists', async () => {
    const cache = createMemoryCache()
    const marked = await prepareFirstClaimOnInstall(
      cache,
      'https://pos.solva.test/acme/pos/',
      true,
    )
    expect(marked).toBe(false)
    expect(await consumePendingFirstClaim(cache, 'https://pos.solva.test/acme/pos/')).toBe(false)
  })
})
