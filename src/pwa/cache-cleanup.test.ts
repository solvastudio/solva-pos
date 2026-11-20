import { describe, expect, it } from 'vitest'
import {
  entriesToDelete,
  unionManifests,
  type ManifestRecord,
} from './cache-cleanup'

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
})
