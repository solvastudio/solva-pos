import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
  createLegalEntity,
  createOutlet,
  createPairingCode,
  createRegister,
  createTenant,
  enrollDevice,
  getTenantAuthMetadataBySlug,
  redeemInvite,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import {
  cleanTombstoneFloors,
  FULL_RESYNC_ENTITY_ORDER,
  fullResyncPage,
  handlePull,
  PullRateLimitedError,
  signSnapshotToken,
  SNAPSHOT_TOKEN_TTL_MS,
  startFullResync,
  type SyncDeviceIdentity,
  writeMaster,
} from '~/modules/sync/public'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-fullresync@example.test' }

async function setupDevice(slug: string) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Full ${slug}`,
    slug,
    ownerEmail: email,
    ownerDisplayName: 'Owner',
  })
  const meta = await getTenantAuthMetadataBySlug(slug)
  await redeemInvite({
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    email,
    code: created.ownerInvite.code,
    password: 'OwnerPassword123!',
  })
  const actor: IdentityAuthActor = {
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
    roleCodes: ['OWNER'],
  }
  const le = await createLegalEntity(actor, { name: 'PT Full', isPkp: false })
  const out1 = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  const reg1 = await createRegister(actor, {
    outletId: out1.id,
    code: 'POS01',
    name: 'Cashier 1',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS01',
  })
  const reg2 = await createRegister(actor, {
    outletId: out1.id,
    code: 'POS02',
    name: 'Cashier 2',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS02',
  })
  const pair1 = await createPairingCode(actor, reg1.id)
  const dev1 = await enrollDevice(
    { slug, code: pair1.code, device_name: 'Dev-1' },
    '10.6.0.1',
    { minDelayMs: 0 },
  )
  const pair2 = await createPairingCode(actor, reg2.id)
  const dev2 = await enrollDevice(
    { slug, code: pair2.code, device_name: 'Dev-2' },
    '10.6.0.2',
    { minDelayMs: 0 },
  )
  return {
    tenantId: created.tenantId,
    actor,
    dev1: {
      tenantId: created.tenantId,
      deviceId: dev1.device_id,
      registerId: reg1.id,
      outletId: out1.id,
      registerType: 'CASHIER',
    } satisfies SyncDeviceIdentity,
    dev2: {
      tenantId: created.tenantId,
      deviceId: dev2.device_id,
      registerId: reg2.id,
      outletId: out1.id,
      registerType: 'CASHIER',
    } satisfies SyncDeviceIdentity,
  }
}

describe('pull full resync & tombstone floor cleaner integration', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
    resetLimitersForTests()
    __clearDeviceAuthCacheForTests()
    __clearTenantCacheForTests()
  })

  afterEach(() => {
    resetCompositionForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('converges full snapshot + incremental tail, enforces 1/hour limit, and rejects foreign/expired tokens', async () => {
    const slug = uniqueSlug('full-conv')
    const fx = await setupDevice(slug)

    const pmIds = [testIdGen.newId(), testIdGen.newId(), testIdGen.newId()]
    for (let i = 0; i < pmIds.length; i += 1) {
      await withTenant(fx.tenantId, async (tx) => {
        await writeMaster(tx, { actorUserId: fx.actor.appUserId }, async (w) => {
          await tx.execute(
            sql`INSERT INTO payment_method (id, tenant_id, version, code, name, kind)
                VALUES (${pmIds[i]!}::uuid, ${w.tenantId}::uuid, ${w.version}, ${`PM${i}`}, ${`Method ${i}`}, 'NON_CASH')`,
          )
        })
      })
    }

    const baseNowMs = Date.UTC(2026, 10, 20, 12, 0, 0)
    const start = await startFullResync(
      fx.dev1,
      {},
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'fs-1' },
      { nowMs: () => baseNowMs },
    )
    expect(start.entities).toEqual([...FULL_RESYNC_ENTITY_ORDER])
    expect(start.snapshot_version).toBeGreaterThan(0)

    // Second start within 1 hour hits PullRateLimitedError
    await expect(
      startFullResync(
        fx.dev1,
        {},
        { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'fs-2' },
        { nowMs: () => baseNowMs + 60_000 },
      ),
    ).rejects.toBeInstanceOf(PullRateLimitedError)

    // Concurrent mutation written after startFullResync must converge via incremental tail
    const lateMethodId = testIdGen.newId()
    await withTenant(fx.tenantId, async (tx) => {
      await writeMaster(tx, { actorUserId: fx.actor.appUserId }, async (w) => {
        await tx.execute(
          sql`INSERT INTO payment_method (id, tenant_id, version, code, name, kind)
              VALUES (${lateMethodId}::uuid, ${w.tenantId}::uuid, ${w.version}, 'LATE_PM', 'Late PM', 'NON_CASH')`,
        )
      })
    })

    // Stream all entities page-by-page (page_size = 2) using the same token without tripping 1/hr limit
    const resyncState = new Map<string, Record<string, unknown>>()
    for (const entity of start.entities) {
      let afterId: string | null = null
      for (;;) {
        const page = await fullResyncPage(
          fx.dev1,
          {
            snapshot_token: start.snapshot_token,
            entity,
            after_id: afterId,
            page_size: 2,
          },
          { nowMs: () => baseNowMs + 120_000 },
        )
        for (const r of page.rows) {
          if (r.row) {
            resyncState.set(`${r.entity}:${r.id}`, r.row)
          }
        }
        afterId = page.next_after_id
        if (!page.has_more) break
      }
    }

    // Apply incremental tail starting from snapshot_version
    const tail = await handlePull(
      fx.dev1,
      {
        cursor: {
          version: start.snapshot_version,
          id: '00000000-0000-0000-0000-000000000000',
        },
        cycle: null,
        page_size: 500,
        attention_ids: [],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'tail-1' },
    )
    if ('full_resync_required' in tail) throw new Error('unexpected resync')
    for (const r of tail.rows) {
      if (r.op === 'upsert' && r.row) {
        resyncState.set(`${r.entity}:${r.id}`, r.row)
      } else {
        resyncState.delete(`${r.entity}:${r.id}`)
      }
    }

    // Compare against clean incremental pull from cursor = null
    const incState = new Map<string, Record<string, unknown>>()
    let incCursor: { version: number; id: string } | null = null
    let incCycle: { id: string; upper: number } | null = null
    for (;;) {
      const p = await handlePull(
        fx.dev1,
        { cursor: incCursor, cycle: incCycle, page_size: 5, attention_ids: [] },
        { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'inc-cmp' },
      )
      if ('full_resync_required' in p) throw new Error('unexpected resync')
      for (const r of p.rows) {
        if (r.op === 'upsert' && r.row) {
          incState.set(`${r.entity}:${r.id}`, r.row)
        } else {
          incState.delete(`${r.entity}:${r.id}`)
        }
      }
      incCursor = p.next_cursor
      incCycle = { id: 'cmp', upper: p.upper }
      if (!p.has_more) break
    }

    expect(resyncState.size).toBe(incState.size)
    for (const [key, row] of incState.entries()) {
      expect(resyncState.get(key)).toEqual(row)
    }
    expect(resyncState.has(`payment_method:${lateMethodId}`)).toBe(true)

    // Foreign device token and expired token rejected
    await expect(
      fullResyncPage(
        fx.dev2,
        { snapshot_token: start.snapshot_token, entity: 'outlet', after_id: null, page_size: 10 },
        { nowMs: () => baseNowMs + 1000 },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' } satisfies Partial<AppError>)

    const expiredToken = signSnapshotToken({
      deviceId: fx.dev1.deviceId,
      snapshotVersion: start.snapshot_version,
      iat: baseNowMs,
    })
    await expect(
      fullResyncPage(
        fx.dev1,
        { snapshot_token: expiredToken, entity: 'outlet', after_id: null, page_size: 10 },
        { nowMs: () => baseNowMs + SNAPSHOT_TOKEN_TTL_MS + 5_000 },
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' } satisfies Partial<AppError>)
  })

  it('advances tombstone_floor only for tombstones older than 30 days and triggers CURSOR_BELOW_FLOOR', async () => {
    const slug = uniqueSlug('full-tomb')
    const fx = await setupDevice(slug)

    const deletedPmId = testIdGen.newId()
    let tombstoneVersion = 0
    const createdAtBase = Date.UTC(2026, 9, 1, 0, 0, 0)

    await withTenant(fx.tenantId, async (tx) => {
      await writeMaster(tx, { actorUserId: fx.actor.appUserId }, async (w) => {
        await tx.execute(
          sql`INSERT INTO payment_method (id, tenant_id, version, code, name, kind)
              VALUES (${deletedPmId}::uuid, ${w.tenantId}::uuid, ${w.version}, 'OLD_PM', 'Old PM', 'NON_CASH')`,
        )
      })
    })
    await withTenant(fx.tenantId, async (tx) => {
      const wRes = await writeMaster(tx, { actorUserId: fx.actor.appUserId }, async (w) => {
        await tx.execute(
          sql`UPDATE payment_method
              SET deleted_at = ${new Date(createdAtBase).toISOString()}::timestamptz,
                  version = ${w.version}
              WHERE id = ${deletedPmId}::uuid`,
        )
        return w.version
      })
      tombstoneVersion = wRes.version
    })

    // 15 days later -> cutoff not reached -> floor stays 0
    const res15d = await cleanTombstoneFloors({
      tenantIds: [fx.tenantId],
      nowIso: () => new Date(createdAtBase + 15 * 86_400_000).toISOString(),
    })
    expect(res15d.floorsAdvanced).toBe(0)

    // 31 days later -> floor advances to tombstoneVersion, physical row still present
    const res31d = await cleanTombstoneFloors({
      tenantIds: [fx.tenantId],
      nowIso: () => new Date(createdAtBase + 31 * 86_400_000).toISOString(),
    })
    expect(res31d.floorsAdvanced).toBe(1)

    await withTenant(fx.tenantId, async (tx) => {
      const syncRes = await tx.execute(
        sql`SELECT version, tombstone_floor_version FROM tenant_sync WHERE tenant_id = ${fx.tenantId}::uuid`,
      )
      const floor = Number(syncRes.rows[0]!.tombstone_floor_version)
      const version = Number(syncRes.rows[0]!.version)
      expect(floor).toBe(tombstoneVersion)
      expect(floor).toBeLessThanOrEqual(version)

      const rowStillThere = await tx.execute(
        sql`SELECT id FROM payment_method WHERE id = ${deletedPmId}::uuid`,
      )
      expect(rowStillThere.rows).toHaveLength(1)
    })

    // Cursor below floor receives full_resync_required: CURSOR_BELOW_FLOOR
    const belowFloorPull = await handlePull(
      fx.dev1,
      {
        cursor: {
          version: tombstoneVersion - 1,
          id: '00000000-0000-0000-0000-000000000000',
        },
        cycle: null,
        page_size: 100,
        attention_ids: [],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'floor-chk' },
    )
    expect(belowFloorPull).toEqual({
      full_resync_required: true,
      reason: 'CURSOR_BELOW_FLOOR',
    })
  })
})
