import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import type { FeatureFlagDefinition } from '~/lib/feature-flags'
import { tenantDbName } from '../locks/names'
import { closeTenantDb, openTenantDb } from '../db/solva-db'
import * as flagRepo from './feature-flag.repo'

const TENANT = '0192a000-0000-7000-8000-00000000b364'

afterEach(async () => {
  closeTenantDb(TENANT)
  await Dexie.delete(tenantDbName(TENANT))
})

describe('pos/data/feature-flag.repo', () => {
  const testRegistry: Record<string, FeatureFlagDefinition> = {
    'sample.closed': {
      default: false,
      failMode: 'closed',
      description: 'Sample closed flag',
    },
    'sample.open': {
      default: true,
      failMode: 'open',
      description: 'Sample open flag',
    },
  }

  it('resolves active override, missing default, tombstone revert, and ignores unknown keys strictly offline', async () => {
    const db = await openTenantDb(TENANT)

    // Missing row -> registry default
    expect(await flagRepo.featureEnabled(db, 'sample.closed', testRegistry)).toBe(false)
    expect(await flagRepo.featureEnabled(db, 'sample.open', testRegistry)).toBe(true)

    // Synced override persisted in Dexie
    await db.feature_flag.bulkPut([
      { id: 'f1', flag_key: 'sample.closed', enabled: true, deleted_at: null },
      { id: 'f2', flag_key: 'sample.open', enabled: false, deleted_at: '2026-11-20T00:00:00Z' },
    ])

    expect(await flagRepo.featureEnabled(db, 'sample.closed', testRegistry)).toBe(true)
    // Tombstoned row reverts to registry default (true)
    expect(await flagRepo.featureEnabled(db, 'sample.open', testRegistry)).toBe(true)
    // Unknown key in code ignored cleanly even if present in DB
    await db.feature_flag.put({ id: 'f3', flag_key: 'unknown.flag', enabled: true, deleted_at: null })
    expect(await flagRepo.featureEnabled(db, 'unknown.flag', testRegistry)).toBe(false)

    // Read-only guarantee: only read helpers exported
    expect(Object.keys(flagRepo).sort()).toEqual(['featureEnabled', 'getFlagRows'])
  })
})
