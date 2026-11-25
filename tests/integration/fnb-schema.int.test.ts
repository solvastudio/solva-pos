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

describe('F&B schema FKs, constraints, generated column, and unique indexes', () => {
  afterAll(async () => {
    await closePools()
  })

  it('rejects cross-tenant composite FKs on fnb_table, bill, and recipe_item', async () => {
    const a = await setupFnbTenant('fnb-fk-a')
    const b = await setupFnbTenant('fnb-fk-b')

    await expect(
      masterTx(a.tenantId, (c, v) =>
        c.query(
          `INSERT INTO fnb_table (id, tenant_id, outlet_id, code, version) VALUES ($1, $2, $3, 'X01', $4)`,
          [newTestId(), a.tenantId, b.outletA, v],
        ),
      ),
    ).rejects.toThrow()

    await expect(
      withFnbAppTx(a.tenantId, async (c) => {
        const cmd = await seedIdempotencyCommand(c, a)
        await c.query(
          `INSERT INTO bill
            (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version,
             table_id, bill_ref, status, lease_device_id, lease_register_id)
           VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-24', $7, 1, $8, 'Cross', 'OPEN', $5, $4)`,
          [newTestId(), a.tenantId, a.outletA, a.waiterRegId, a.waiterDev.deviceId, a.appUserId, cmd, b.tableA1Id],
        )
      }),
    ).rejects.toThrow()

    await expect(
      withFnbAppTx(a.tenantId, (c) =>
        c.query(
          `INSERT INTO recipe_item (id, tenant_id, menu_sku_id, ingredient_sku_id, qty)
           VALUES ($1, $2, $3, $4, 1)`,
          [newTestId(), a.tenantId, a.menuSkuId, b.ingTrackedSkuId],
        ),
      ),
    ).rejects.toThrow()
  })

  it('enforces CHECK constraints on modifier_ingredient, fnb_table, and recipe_item', async () => {
    const f = await setupFnbTenant('fnb-chk')

    await expect(
      masterTx(f.tenantId, (c, v) =>
        c.query(
          `INSERT INTO fnb_table (id, tenant_id, outlet_id, code, version) VALUES ($1, $2, $3, 'BAD CODE!', $4)`,
          [newTestId(), f.tenantId, f.outletA, v],
        ),
      ),
    ).rejects.toThrow(/ck_fnb_table__code/)

    await expect(
      withFnbAppTx(f.tenantId, (c) =>
        c.query(
          `INSERT INTO recipe_item (id, tenant_id, menu_sku_id, ingredient_sku_id, qty)
           VALUES ($1, $2, $3, $3, 1)`,
          [newTestId(), f.tenantId, f.menuSkuId],
        ),
      ),
    ).rejects.toThrow(/ck_recipe_item__distinct_skus/)

    const grpId = newTestId()
    const modId = newTestId()
    await masterTx(f.tenantId, async (c, v) => {
      await c.query(
        `INSERT INTO modifier_group (id, tenant_id, version, name, selection_type, min_select, max_select)
         VALUES ($1, $2, $3, 'Sauce', 'SINGLE', 0, 1)`,
        [grpId, f.tenantId, v],
      )
      await c.query(
        `INSERT INTO modifier (id, tenant_id, version, modifier_group_id, name, price_delta)
         VALUES ($1, $2, $3, $4, 'No Onion', 0)`,
        [modId, f.tenantId, v, grpId],
      )
    })

    // REMOVE with non-null qty violates ck_modifier_ingredient__adjust_qty
    await expect(
      withFnbAppTx(f.tenantId, (c) =>
        c.query(
          `INSERT INTO modifier_ingredient (id, tenant_id, modifier_id, ingredient_sku_id, adjust_type, qty)
           VALUES ($1, $2, $3, $4, 'REMOVE', 1)`,
          [newTestId(), f.tenantId, modId, f.ingTrackedSkuId],
        ),
      ),
    ).rejects.toThrow(/ck_modifier_ingredient__adjust_qty/)

    // ADD with null qty violates ck_modifier_ingredient__adjust_qty
    await expect(
      withFnbAppTx(f.tenantId, (c) =>
        c.query(
          `INSERT INTO modifier_ingredient (id, tenant_id, modifier_id, ingredient_sku_id, adjust_type, qty)
           VALUES ($1, $2, $3, $4, 'ADD', NULL)`,
          [newTestId(), f.tenantId, modId, f.ingTrackedSkuId],
        ),
      ),
    ).rejects.toThrow(/ck_modifier_ingredient__adjust_qty/)
  })

  it('computes bill.is_awaiting_payment generated column accurately', async () => {
    const f = await setupFnbTenant('fnb-gen')

    const isAwait = await withFnbAppTx(f.tenantId, async (c) => {
      const { billId } = await seedOpenBill(c, f)
      const r1 = await c.query<{ a: boolean }>(
        `SELECT is_awaiting_payment AS a FROM bill WHERE id = $1`,
        [billId],
      )
      await c.query(`UPDATE bill SET prebill_seq = 2, last_content_seq = 1 WHERE id = $1`, [billId])
      const r2 = await c.query<{ a: boolean }>(
        `SELECT is_awaiting_payment AS a FROM bill WHERE id = $1`,
        [billId],
      )
      await c.query(`UPDATE bill SET last_content_seq = 2 WHERE id = $1`, [billId])
      const r3 = await c.query<{ a: boolean }>(
        `SELECT is_awaiting_payment AS a FROM bill WHERE id = $1`,
        [billId],
      )
      return { init: r1.rows[0]!.a, afterPrebill: r2.rows[0]!.a, afterEdit: r3.rows[0]!.a }
    })

    expect(isAwait).toEqual({ init: false, afterPrebill: true, afterEdit: false })
  })
})
