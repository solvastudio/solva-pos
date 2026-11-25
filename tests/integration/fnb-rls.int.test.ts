import { afterAll, describe, expect, it } from 'vitest'
import { closePools } from '~/server/db'
import {
  newTestId,
  seedIdempotencyCommand,
  seedOpenBill,
  setupFnbTenant,
  withFnbAppTx,
} from './helpers/fnb'
import { masterTx } from './helpers/master'

const FNB_RLS_TABLES = [
  'modifier_group',
  'modifier_group_product',
  'modifier',
  'modifier_ingredient',
  'recipe_item',
  'fnb_table',
  'bill',
  'bill_item',
  'bill_item_modifier',
  'bill_event',
] as const

async function seedFnbRows(prefix: string) {
  const f = await setupFnbTenant(prefix)
  const groupId = newTestId()
  const modId = newTestId()
  const mgpId = newTestId()

  await masterTx(f.tenantId, async (c, v) => {
    await c.query(
      `INSERT INTO modifier_group (id, tenant_id, version, name, selection_type, min_select, max_select)
       VALUES ($1, $2, $3, 'Topping', 'SINGLE', 0, 1)`,
      [groupId, f.tenantId, v],
    )
    await c.query(
      `INSERT INTO modifier (id, tenant_id, version, modifier_group_id, name, price_delta)
       VALUES ($1, $2, $3, $4, 'Extra Egg', 5000)`,
      [modId, f.tenantId, v, groupId],
    )
    await c.query(
      `INSERT INTO modifier_group_product (id, tenant_id, version, modifier_group_id, product_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [mgpId, f.tenantId, v, groupId, f.menuProductId],
    )
  })

  const { billId, eventId, billItemId } = await withFnbAppTx(f.tenantId, async (c) => {
    await c.query(
      `INSERT INTO modifier_ingredient (id, tenant_id, modifier_id, ingredient_sku_id, adjust_type, qty)
       VALUES ($1, $2, $3, $4, 'ADD', 1)`,
      [newTestId(), f.tenantId, modId, f.ingTrackedSkuId],
    )
    await c.query(
      `INSERT INTO recipe_item (id, tenant_id, menu_sku_id, ingredient_sku_id, qty)
       VALUES ($1, $2, $3, $4, 150)`,
      [newTestId(), f.tenantId, f.menuSkuId, f.ingTrackedSkuId],
    )
    const { billId, commandId } = await seedOpenBill(c, f)
    const eventId = newTestId()
    await c.query(
      `INSERT INTO bill_event
        (id, tenant_id, outlet_id, bill_id, bill_seq, device_id, register_id, device_seq, staff_id,
         event_type, payload, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version)
       VALUES ($1, $2, $3, $4, 1, $5, $6, 1, $7, 'BILL_OPENED', '{}'::jsonb, now(), 0, now(), '2026-11-24', $8, 1)`,
      [eventId, f.tenantId, f.outletA, billId, f.waiterDev.deviceId, f.waiterRegId, f.appUserId, commandId],
    )
    const billItemId = newTestId()
    await c.query(
      `INSERT INTO bill_item
        (id, tenant_id, outlet_id, bill_id, line_no, sku_id, uom_id, sku_code, item_name, uom_code,
         qty, conversion_factor, unit_price, price_source, created_event_id)
       VALUES ($1, $2, $3, $4, 1, $5, $6, 'NASGOR-01', 'Nasi Goreng', 'pcs', 1, 1, 35000, 'TENANT_DEFAULT', $7)`,
      [billItemId, f.tenantId, f.outletA, billId, f.menuSkuId, f.pcsUomId, eventId],
    )
    await c.query(
      `INSERT INTO bill_item_modifier (id, tenant_id, bill_item_id, modifier_id, name, price_delta, qty)
       VALUES ($1, $2, $3, $4, 'Extra Egg', 5000, 1)`,
      [newTestId(), f.tenantId, billItemId, modId],
    )
    return { billId, eventId, billItemId }
  })

  return { f, groupId, modId, mgpId, billId, eventId, billItemId }
}

describe('F&B RLS isolation, cross-tenant composite FKs, and column/table grants', () => {
  afterAll(async () => {
    await closePools()
  })

  it('isolates F&B tables across tenants and blocks cross-tenant writes and composite FKs', async () => {
    const a = await seedFnbRows('fnb-rls-a')
    const b = await seedFnbRows('fnb-rls-b')

    await withFnbAppTx(a.f.tenantId, async (c) => {
      for (const table of FNB_RLS_TABLES) {
        const res = await c.query<{ cnt: number }>(
          `SELECT count(*)::int AS cnt FROM "${table}" WHERE tenant_id = $1`,
          [b.f.tenantId],
        )
        expect(res.rows[0]?.cnt, `Tenant A must see 0 rows of Tenant B in ${table}`).toBe(0)
      }

      const selfRes = await c.query<{ cnt: number }>(`SELECT count(*)::int AS cnt FROM "bill"`)
      expect(selfRes.rows[0]?.cnt).toBe(1)
    })

    // Cross-tenant write with Tenant B's tenant_id inside Tenant A's app context fails RLS (42501)
    await expect(
      withFnbAppTx(a.f.tenantId, (c) =>
        c.query(
          `INSERT INTO recipe_item (id, tenant_id, menu_sku_id, ingredient_sku_id, qty)
           VALUES ($1, $2, $3, $4, 1)`,
          [newTestId(), b.f.tenantId, b.f.menu2SkuId, b.f.ingUntrackedSkuId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' })

    // Cross-tenant composite FKs rejected cleanly (23503)
    await expect(
      masterTx(a.f.tenantId, (c, v) =>
        c.query(
          `INSERT INTO modifier_group_product (id, tenant_id, version, modifier_group_id, product_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [newTestId(), a.f.tenantId, v, a.groupId, b.f.menuProductId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' })

    await expect(
      withFnbAppTx(a.f.tenantId, (c) =>
        c.query(
          `INSERT INTO modifier_ingredient (id, tenant_id, modifier_id, ingredient_sku_id, adjust_type, qty)
           VALUES ($1, $2, $3, $4, 'ADD', 1)`,
          [newTestId(), a.f.tenantId, b.modId, a.f.ingTrackedSkuId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' })

    await expect(
      withFnbAppTx(a.f.tenantId, async (c) => {
        const cmd = await seedIdempotencyCommand(c, a.f)
        await c.query(
          `INSERT INTO bill_event
            (id, tenant_id, outlet_id, bill_id, bill_seq, device_id, register_id, device_seq, staff_id,
             event_type, payload, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version)
           VALUES ($1, $2, $3, $4, 99, $5, $6, 99, $7, 'BILL_OPENED', '{}'::jsonb, now(), 0, now(), '2026-11-24', $8, 1)`,
          [newTestId(), a.f.tenantId, a.f.outletA, b.billId, a.f.waiterDev.deviceId, a.f.waiterRegId, a.f.appUserId, cmd],
        )
      }),
    ).rejects.toMatchObject({ code: '23503' })

    await expect(
      withFnbAppTx(a.f.tenantId, (c) =>
        c.query(
          `INSERT INTO bill_item_modifier (id, tenant_id, bill_item_id, modifier_id, name, price_delta, qty)
           VALUES ($1, $2, $3, $4, 'CrossMod', 0, 1)`,
          [newTestId(), a.f.tenantId, a.billItemId, b.modId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('enforces least-privilege column and append-only grants for solva_app', async () => {
    const seeded = await seedFnbRows('fnb-grants')

    // Identity columns on bill are NOT updatable by solva_app
    await expect(
      withFnbAppTx(seeded.f.tenantId, (c) =>
        c.query(`UPDATE bill SET outlet_id = $2 WHERE id = $1`, [seeded.billId, seeded.f.outletB]),
      ),
    ).rejects.toMatchObject({ code: '42501' })

    // bill_event has SELECT, INSERT only for solva_app
    await expect(
      withFnbAppTx(seeded.f.tenantId, (c) =>
        c.query(`UPDATE bill_event SET bill_seq = 2 WHERE id = $1`, [seeded.eventId]),
      ),
    ).rejects.toMatchObject({ code: '42501' })

    await expect(
      withFnbAppTx(seeded.f.tenantId, (c) =>
        c.query(`DELETE FROM bill_event WHERE id = $1`, [seeded.eventId]),
      ),
    ).rejects.toMatchObject({ code: '42501' })

    // Master tables forbid physical DELETE for solva_app
    await expect(
      withFnbAppTx(seeded.f.tenantId, (c) =>
        c.query(`DELETE FROM fnb_table WHERE id = $1`, [seeded.f.tableA1Id]),
      ),
    ).rejects.toMatchObject({ code: '42501' })

    await expect(
      withFnbAppTx(seeded.f.tenantId, (c) =>
        c.query(`DELETE FROM modifier_group WHERE id = $1`, [seeded.groupId]),
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
