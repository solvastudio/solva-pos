import { webcrypto } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { sql } from 'drizzle-orm'
import { createIdGenerator } from '../../src/lib/kernel'
import { writeMaster } from '../../src/modules/sync/public'
import { withTenant } from '../../src/server/db'
import { createThreeOutletE2eTenant } from '../../scripts/bench/seed-catalog'
import { pairDeviceViaUi } from './helpers/device'
import {
  bumpTombstoneFloorVersion,
  createPairingCodeDirect,
  readTenantSyncState,
} from './helpers/server'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    webcrypto.getRandomValues(b)
    return b[0]!
  },
})

test.describe('F2-K03 offline multi-version catchup and cursor below floor full resync', () => {
  test('F2-K03 catches up 300 server changes + tombstones cleanly and preserves local outbox/cart on full resync', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const tenant = await createThreeOutletE2eTenant('f2k03')
    const code = await createPairingCodeDirect(
      tenant.tenantId,
      tenant.registerAId,
      tenant.actorUserId,
    )

    const catId = idGen.newId()
    const uomId = idGen.newId()
    const baseProdIds = Array.from({ length: 50 }, () => idGen.newId())
    const nowIso = new Date().toISOString()

    // Seed initial 50 products before pairing.
    await withTenant(tenant.tenantId, async (tx) => {
      await writeMaster(tx, { actorUserId: tenant.actorUserId }, async (w) => {
        await tx.execute(sql`
          INSERT INTO category (id, tenant_id, version, created_at, updated_at, created_by, updated_by, name, sort_order)
          VALUES (${catId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, 'Cat K03', 0)
        `)
        await tx.execute(sql`
          INSERT INTO uom (id, tenant_id, version, created_at, updated_at, created_by, updated_by, code, name, allow_fraction)
          VALUES (${uomId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, 'pcs', 'Pieces', false)
        `)
        for (let i = 0; i < 50; i += 1) {
          const pid = baseProdIds[i]!
          const sid = idGen.newId()
          await tx.execute(sql`
            INSERT INTO product (id, tenant_id, version, created_at, updated_at, created_by, updated_by, category_id, code, name, product_type, has_variants, base_uom_id, sort_order)
            VALUES (${pid}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${catId}::uuid, ${`INIT-${i}`}, ${`Initial Prod ${i}`}, 'RETAIL', false, ${uomId}::uuid, ${i})
          `)
          await tx.execute(sql`
            INSERT INTO sku (id, tenant_id, version, created_at, updated_at, created_by, updated_by, product_id, sku_code, variant_label, is_default, is_active, sort_order)
            VALUES (${sid}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${pid}::uuid, ${`INIT-${i}`}, NULL, true, true, 0)
          `)
        }
      })
    })

    const ctx = await browser.newContext()
    try {
      const page = await ctx.newPage()
      await pairDeviceViaUi(page, tenant.slug, code, 'E2E Cashier K03')

      await expect
        .poll(() => page.evaluate(() => window.__solva!.catalog.count()), { timeout: 20_000 })
        .toBe(50)

      // Go offline while server accumulates multiple versions totaling 300 master row changes + tombstones.
      await ctx.setOffline(true)

      // 1) Tombstone first 20 products + their SKUs (40 deleted master rows)
      const tombstoneIds = baseProdIds.slice(0, 20)
      const idInList = sql.join(
        tombstoneIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )
      await withTenant(tenant.tenantId, async (tx) => {
        await writeMaster(tx, { actorUserId: tenant.actorUserId }, async (w) => {
          const ts = new Date().toISOString()
          await tx.execute(sql`
            UPDATE sku SET deleted_at = ${ts}::timestamptz, version = ${w.version}, updated_at = ${ts}::timestamptz
            WHERE tenant_id = ${w.tenantId}::uuid AND product_id IN (${idInList})
          `)
          await tx.execute(sql`
            UPDATE product SET deleted_at = ${ts}::timestamptz, version = ${w.version}, updated_at = ${ts}::timestamptz
            WHERE tenant_id = ${w.tenantId}::uuid AND id IN (${idInList})
          `)
        })
      })

      // 2) Add 130 new products + 130 new SKUs across 2 versions (260 rows -> total 300 master row changes)
      for (let batch = 0; batch < 2; batch += 1) {
        await withTenant(tenant.tenantId, async (tx) => {
          await writeMaster(tx, { actorUserId: tenant.actorUserId }, async (w) => {
            const ts = new Date().toISOString()
            for (let j = 0; j < 65; j += 1) {
              const num = batch * 65 + j
              const pid = idGen.newId()
              const sid = idGen.newId()
              await tx.execute(sql`
                INSERT INTO product (id, tenant_id, version, created_at, updated_at, created_by, updated_by, category_id, code, name, product_type, has_variants, base_uom_id, sort_order)
                VALUES (${pid}::uuid, ${w.tenantId}::uuid, ${w.version}, ${ts}::timestamptz, ${ts}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${catId}::uuid, ${`OFF-${num}`}, ${`Offline Catchup ${num}`}, 'RETAIL', false, ${uomId}::uuid, ${num})
              `)
              await tx.execute(sql`
                INSERT INTO sku (id, tenant_id, version, created_at, updated_at, created_by, updated_by, product_id, sku_code, variant_label, is_default, is_active, sort_order)
                VALUES (${sid}::uuid, ${w.tenantId}::uuid, ${w.version}, ${ts}::timestamptz, ${ts}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${pid}::uuid, ${`OFF-${num}`}, NULL, true, true, 0)
              `)
            }
          })
        })
      }

      // Bring device back online and verify convergence: 50 - 20 + 130 = 160 active SKUs.
      await ctx.setOffline(false)
      await expect
        .poll(
          async () => {
            await page.evaluate(() => window.__solva!.kickSync())
            return page.evaluate(() => window.__solva!.catalog.count())
          },
          { timeout: 25_000, intervals: [500] },
        )
        .toBe(160)

      // Part 2: Insert sentinel local outbox_command + cart_draft, then raise tombstone_floor_version above device cursor.
      const sentinels = await page.evaluate(async (regId) => {
        const outboxId = '0192c000-0000-7000-8000-000000000001'
        const draftId = '0192c000-0000-7000-8000-000000000002'
        await window.__solva!.db.outbox_command.put({
          id: outboxId,
          type: 'audit.record',
          payload: { tag: 'preserve-on-resync' },
          schema_version: 1,
          device_seq: 999999,
          register_id: regId,
          status: 'NEEDS_ATTENTION',
          dependency_key: null,
          depends_on: [],
          attempts: 3,
          next_retry_at: null,
          last_error_class: 'STRUCTURAL',
          last_error_code: 'E2E_SENTINEL',
          last_error_ref: 'D-E2E-001',
          result: null,
          created_at_device: new Date().toISOString(),
          app_version: 'v0.1.0-e2e',
        })
        await window.__solva!.db.cart_draft.put({
          id: draftId,
          register_id: regId,
          staff_id: 'staff-1',
          status: 'OPEN',
          bill_key: 'draft-1',
          items: [{ sku: 'INIT-25', qty: 2 }],
        })
        return { outboxId, draftId }
      }, tenant.registerAId)

      let sawFullResyncRequired = false
      page.on('response', async (res) => {
        if (res.url().endsWith('/api/pos/v1/pull') && res.status() === 200) {
          const json = (await res.json().catch(() => null)) as { full_resync_required?: boolean } | null
          if (json?.full_resync_required) {
            sawFullResyncRequired = true
          }
        }
      })

      // Ensure device cursor has converged to current server version before bumping floor.
      const beforeFloorServer = await readTenantSyncState(tenant.tenantId)
      await expect
        .poll(() => page.evaluate(async () => (await window.__solva!.getMeta('cursor'))?.version ?? 0), {
          timeout: 15_000,
        })
        .toBeGreaterThanOrEqual(beforeFloorServer.version)

      // Advance server 1 version past device cursor, then set tombstone_floor_version = server.version
      // (satisfies ck_tenant_sync__floor: floor <= version, while cursor.version < floor).
      const bumpProdId = idGen.newId()
      const bumpSkuId = idGen.newId()
      await withTenant(tenant.tenantId, async (tx) => {
        await writeMaster(tx, { actorUserId: tenant.actorUserId }, async (w) => {
          const ts = new Date().toISOString()
          await tx.execute(sql`
            INSERT INTO product (id, tenant_id, version, created_at, updated_at, created_by, updated_by, category_id, code, name, product_type, has_variants, base_uom_id, sort_order)
            VALUES (${bumpProdId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${ts}::timestamptz, ${ts}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${catId}::uuid, 'FLOOR-1', 'Floor Bump Item', 'RETAIL', false, ${uomId}::uuid, 999)
          `)
          await tx.execute(sql`
            INSERT INTO sku (id, tenant_id, version, created_at, updated_at, created_by, updated_by, product_id, sku_code, variant_label, is_default, is_active, sort_order)
            VALUES (${bumpSkuId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${ts}::timestamptz, ${ts}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${bumpProdId}::uuid, 'FLOOR-1', NULL, true, true, 0)
          `)
        })
      })

      const serverState = await readTenantSyncState(tenant.tenantId)
      await bumpTombstoneFloorVersion(tenant.tenantId, serverState.version)

      await expect
        .poll(
          async () => {
            await page.evaluate(() => window.__solva!.kickSync())
            return sawFullResyncRequired
          },
          { timeout: 20_000, intervals: [500] },
        )
        .toBe(true)

      await expect
        .poll(() => page.evaluate(() => window.__solva!.catalog.count()), { timeout: 20_000 })
        .toBe(161)

      // Confirm local outbox_command and cart_draft sentinels were NEVER touched by full resync.
      const preserved = await page.evaluate(async ({ outboxId, draftId }) => {
        const outboxRow = await window.__solva!.db.outbox_command.get(outboxId)
        const draftRow = await window.__solva!.db.cart_draft.get(draftId)
        return { outboxRow, draftRow }
      }, sentinels)

      expect(preserved.outboxRow?.id).toBe(sentinels.outboxId)
      expect(preserved.outboxRow?.status).toBe('NEEDS_ATTENTION')
      expect(preserved.draftRow?.id).toBe(sentinels.draftId)
    } finally {
      await ctx.close()
    }
  })
})
