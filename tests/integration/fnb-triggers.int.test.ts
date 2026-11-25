import { afterAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import { closePools } from '~/server/db'
import { adminClient, ownerClient, withClient } from './helpers/db'
import {
  newTestId,
  seedIdempotencyCommand,
  seedOpenBill,
  setupFnbTenant,
  withFnbAppTx,
} from './helpers/fnb'

async function withOwnerTenantTx<T>(tenantId: string, fn: (c: Client) => Promise<T>): Promise<T> {
  return withClient(ownerClient, async (c) => {
    await c.query('BEGIN')
    try {
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
      const res = await fn(c)
      await c.query('COMMIT')
      return res
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {})
      throw err
    }
  })
}

describe('F&B database triggers and cyclic deferrable FK', () => {
  afterAll(async () => {
    await closePools()
  })

  it('bill_lease_guard_trg blocks lease change unless app.bill_lease_change = on', async () => {
    const f = await setupFnbTenant('fnb-trg-lease')
    const { billId } = await withFnbAppTx(f.tenantId, (c) => seedOpenBill(c, f))

    await expect(
      withFnbAppTx(f.tenantId, (c) =>
        c.query(
          `UPDATE bill SET lease_device_id = $2, lease_register_id = $3 WHERE id = $1`,
          [billId, f.cashierDev.deviceId, f.cashierRegId],
        ),
      ),
    ).rejects.toThrow(/bill_lease_immutable/)

    await withFnbAppTx(f.tenantId, async (c) => {
      await c.query(`SET LOCAL app.bill_lease_change = 'on'`)
      await c.query(
        `UPDATE bill SET lease_device_id = $2, lease_register_id = $3 WHERE id = $1`,
        [billId, f.cashierDev.deviceId, f.cashierRegId],
      )
    })
  })

  it('bill_event_immutable and bill_event_no_truncate block UPDATE, DELETE, and TRUNCATE', async () => {
    const f = await setupFnbTenant('fnb-trg-ev')
    const eventId = newTestId()
    await withFnbAppTx(f.tenantId, async (c) => {
      const { billId, commandId } = await seedOpenBill(c, f)
      await c.query(
        `INSERT INTO bill_event
          (id, tenant_id, outlet_id, bill_id, bill_seq, device_id, register_id, device_seq, staff_id,
           event_type, payload, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version)
         VALUES ($1, $2, $3, $4, 1, $5, $6, 1, $7, 'BILL_OPENED', '{}'::jsonb, now(), 0, now(), '2026-11-24', $8, 1)`,
        [eventId, f.tenantId, f.outletA, billId, f.waiterDev.deviceId, f.waiterRegId, f.appUserId, commandId],
      )
    })

    // Owner hits append-only RLS (0 modifiable rows) + BEFORE TRUNCATE trigger
    await withOwnerTenantTx(f.tenantId, async (c) => {
      const upd = await c.query(`UPDATE bill_event SET bill_seq = 2 WHERE id = $1`, [eventId])
      expect(upd.rowCount).toBe(0)
      const del = await c.query(`DELETE FROM bill_event WHERE id = $1`, [eventId])
      expect(del.rowCount).toBe(0)
    })

    // Superuser bypassing RLS hits the BEFORE UPDATE/DELETE forbid_mutation trigger
    await expect(
      withClient(adminClient, (c) =>
        c.query(`UPDATE bill_event SET bill_seq = 2 WHERE id = $1`, [eventId]),
      ),
    ).rejects.toThrow(/append-only/)

    await expect(
      withClient(adminClient, (c) => c.query(`DELETE FROM bill_event WHERE id = $1`, [eventId])),
    ).rejects.toThrow(/append-only/)

    await expect(
      withOwnerTenantTx(f.tenantId, (c) => c.query(`TRUNCATE TABLE bill_event CASCADE`)),
    ).rejects.toThrow(/append-only/)
  })

  it('recipe_one_level_trg enforces single-level BOM across inserts', async () => {
    const f = await setupFnbTenant('fnb-trg-rcp')

    await withFnbAppTx(f.tenantId, (c) =>
      c.query(
        `INSERT INTO recipe_item (id, tenant_id, menu_sku_id, ingredient_sku_id, qty)
         VALUES ($1, $2, $3, $4, 1)`,
        [newTestId(), f.tenantId, f.menuSkuId, f.menu2SkuId],
      ),
    )

    await expect(
      withFnbAppTx(f.tenantId, (c) =>
        c.query(
          `INSERT INTO recipe_item (id, tenant_id, menu_sku_id, ingredient_sku_id, qty)
           VALUES ($1, $2, $3, $4, 2)`,
          [newTestId(), f.tenantId, f.menu2SkuId, f.ingTrackedSkuId],
        ),
      ),
    ).rejects.toThrow(/recipe_must_be_one_level/)
  })

  it('register_type_guard_trg blocks register_type mutation when OPEN bill exists on register', async () => {
    const f = await setupFnbTenant('fnb-trg-reg')
    await withFnbAppTx(f.tenantId, (c) => seedOpenBill(c, f))

    await expect(
      withOwnerTenantTx(f.tenantId, (c) =>
        c.query(
          `UPDATE cash_master SET register_type = 'CASHIER', version = version + 1 WHERE id = $1`,
          [f.waiterRegId],
        ),
      ),
    ).rejects.toThrow(/register_type_immutable/)
  })

  it('supports cyclic deferrable FK bill.handover_event_id -> bill_event inside single tx', async () => {
    const f = await setupFnbTenant('fnb-cyc-fk')
    const { billId } = await withFnbAppTx(f.tenantId, (c) => seedOpenBill(c, f))
    const handoverEventId = newTestId()

    await withFnbAppTx(f.tenantId, async (c) => {
      const cmd = await seedIdempotencyCommand(c, f)
      await c.query(
        `UPDATE bill SET handover_status = 'PENDING', handover_target_register_id = $2, handover_event_id = $3, handover_requested_at = now()
         WHERE id = $1`,
        [billId, f.cashierRegId, handoverEventId],
      )
      await c.query(
        `INSERT INTO bill_event
          (id, tenant_id, outlet_id, bill_id, bill_seq, device_id, register_id, device_seq, staff_id,
           event_type, payload, target_register_id, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version)
         VALUES ($1, $2, $3, $4, 1, $5, $6, 1, $7, 'BILL_HANDED_OVER', '{}'::jsonb, $8, now(), 0, now(), '2026-11-24', $9, 1)`,
        [
          handoverEventId,
          f.tenantId,
          f.outletA,
          billId,
          f.waiterDev.deviceId,
          f.waiterRegId,
          f.appUserId,
          f.cashierRegId,
          cmd,
        ],
      )
    })
  })
})
