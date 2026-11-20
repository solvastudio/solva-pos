import { sql } from 'drizzle-orm'
import { webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { FEATURE_FLAGS, type FeatureFlagDefinition } from '~/lib/feature-flags'
import { createIdGenerator } from '~/lib/kernel'
import {
  clearFeatureFlag,
  createTenant,
  getTenantAuthMetadataBySlug,
  listFeatureFlags,
  setFeatureFlag,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools } from '~/server/db'
import { uniqueSlug, withTestTenant } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-flags@example.test' }

const TEST_REGISTRY: Readonly<Record<string, FeatureFlagDefinition>> = {
  'ui.pos.fast_pay': {
    default: false,
    failMode: 'closed',
    description: 'Test flag for integration tests only',
  },
}

async function setupFlagTenant(prefix: string) {
  const slug = uniqueSlug(prefix)
  const created = await createTenant(testOp, {
    name: `Tenant ${prefix}`,
    slug,
    ownerEmail: `owner-${slug}@example.test`,
    ownerDisplayName: 'Owner',
  })
  const meta = await getTenantAuthMetadataBySlug(slug)
  const ownerActor: IdentityAuthActor = {
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
    roleCodes: ['OWNER'],
  }
  return { tenantId: created.tenantId, ownerActor }
}

describe('feature-flag integration (tenant feature flags, permissions, audit)', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
  })

  afterAll(async () => {
    resetCompositionForTests()
    await closePools()
  })

  it('keeps built-in FEATURE_FLAGS empty, enforces flag.manage permission, upserts uniquely, clears cleanly, and audits', async () => {
    expect(Object.keys(FEATURE_FLAGS)).toHaveLength(0)

    const { tenantId, ownerActor } = await setupFlagTenant('fflag1')

    // Missing permission rejected
    const noFlagPermActor: IdentityAuthActor = {
      ...ownerActor,
      permissions: new Set(['catalog.manage']),
    }
    await expect(
      setFeatureFlag(
        noFlagPermActor,
        { key: 'ui.pos.fast_pay', enabled: true },
        { registry: TEST_REGISTRY },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Outlet-scoped actor rejected (must be tenant-wide)
    const outletScopedActor: IdentityAuthActor = {
      ...ownerActor,
      outletIds: [testIdGen.newId()],
    }
    await expect(
      setFeatureFlag(
        outletScopedActor,
        { key: 'ui.pos.fast_pay', enabled: true },
        { registry: TEST_REGISTRY },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Unknown key rejected (both against default empty registry and test registry)
    await expect(
      setFeatureFlag(ownerActor, { key: 'ui.pos.fast_pay', enabled: true }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(
      setFeatureFlag(
        ownerActor,
        { key: 'nonexistent.flag', enabled: true },
        { registry: TEST_REGISTRY },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    // Set flag enabled with params & note
    const enabledRow = await setFeatureFlag(
      ownerActor,
      {
        key: 'ui.pos.fast_pay',
        enabled: true,
        params: { threshold: 50000 },
        note: 'Pilot rollout',
      },
      { registry: TEST_REGISTRY },
    )
    expect(enabledRow.enabled).toBe(true)
    expect(enabledRow.params).toEqual({ threshold: 50000 })

    // Update same key (still 1 DB row)
    const updatedRow = await setFeatureFlag(
      ownerActor,
      {
        key: 'ui.pos.fast_pay',
        enabled: false,
        params: null,
        note: 'Paused',
      },
      { registry: TEST_REGISTRY },
    )
    expect(updatedRow.id).toBe(enabledRow.id)
    expect(updatedRow.enabled).toBe(false)

    // Clear flag -> tombstoned -> listFeatureFlags omits it
    const cleared = await clearFeatureFlag(ownerActor, 'ui.pos.fast_pay', {
      registry: TEST_REGISTRY,
    })
    expect(cleared.cleared).toBe(true)
    expect(await listFeatureFlags(ownerActor)).toHaveLength(0)

    // Re-set flag after tombstone -> revives same single row
    const revivedRow = await setFeatureFlag(
      ownerActor,
      { key: 'ui.pos.fast_pay', enabled: true },
      { registry: TEST_REGISTRY },
    )
    expect(revivedRow.id).toBe(enabledRow.id)
    expect(await listFeatureFlags(ownerActor)).toHaveLength(1)

    const dbState = await withTestTenant(tenantId, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT count(*)::text AS count FROM feature_flag WHERE tenant_id = ${tenantId}::uuid AND flag_key = 'ui.pos.fast_pay'`,
      )
      const audits = await tx.execute(
        sql`SELECT action, after_data FROM audit_log WHERE tenant_id = ${tenantId}::uuid AND action = 'feature_flag.changed' ORDER BY chain_seq ASC`,
      )
      return {
        rowCount: Number((rows.rows[0] as { count: string }).count),
        audits: audits.rows as Array<{ action: string; after_data: unknown }>,
      }
    })

    expect(dbState.rowCount).toBe(1)
    expect(dbState.audits).toHaveLength(4)
    expect(dbState.audits[2]!.after_data).toBeNull()
  })
})
