import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetManifestCacheForTests,
  getCachedManifestCounts,
  MANIFEST_CACHE_MAX_ENTRIES,
  manifestCountsKey,
  setCachedManifestCounts,
} from './manifest-cache'

const scope = { tenantId: 't1', outletId: 'o1', registerId: 'r1', deviceId: 'd1' }

describe('sync/manifest-cache', () => {
  beforeEach(() => {
    __resetManifestCacheForTests()
  })

  it('keys counts per device scope and master version', () => {
    expect(manifestCountsKey(scope, 5)).not.toBe(manifestCountsKey(scope, 6))
    expect(manifestCountsKey(scope, 5)).not.toBe(manifestCountsKey({ ...scope, deviceId: 'd2' }, 5))
  })

  it('returns cached counts and evicts the least recently used entry beyond the cap', () => {
    for (let i = 0; i < MANIFEST_CACHE_MAX_ENTRIES; i += 1) {
      setCachedManifestCounts(`k${i}`, { entity: i })
    }
    // Reading k0 makes k1 the least recently used entry.
    expect(getCachedManifestCounts('k0')).toEqual({ entity: 0 })
    setCachedManifestCounts('overflow', { entity: -1 })

    expect(getCachedManifestCounts('k1')).toBeUndefined()
    expect(getCachedManifestCounts('k0')).toEqual({ entity: 0 })
    expect(getCachedManifestCounts('overflow')).toEqual({ entity: -1 })
  })
})
