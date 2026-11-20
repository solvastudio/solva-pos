import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getHasTransactionsPort } from '~/modules/catalog/server/ports'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { appClient, withClient } from './helpers/db'
import { masterTx } from './helpers/master'
import { createTestTenant, uniqueSlug } from './helpers/tenants'

describe('sales & shift column-level grants, write-once guards, and immutability triggers (Phase 40)', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
  })

  afterAll(async () => {
    await closePools()
  })

  it('enforces column-level UPDATE/DELETE grants, write-once counted_cash, and master code/UOM locks after tx', async () => {
    const { id: tenantId } = await createTestTenant(uniqueSlug('sales-grants'))

    const seeded = await masterTx(tenantId, async (c, v) => {
      const leId = (
        await c.query<{ id: string }>(
          `INSERT INTO legal_entity (tenant_id, version, name) VALUES ($1, $2, 'PT Grants') RETURNING id`,
          [tenantId, v],
        )
      ).rows[0]!.id
      const outletId = (
        await c.query<{ id: string }>(
          `INSERT INTO outlet (tenant_id, version, legal_entity_id, code, name, price_tax_mode)
           VALUES ($1, $2, $3, 'OUTA', 'Outlet A', 'EXCLUSIVE') RETURNING id`,
          [tenantId, v, leId],
        )
      ).rows[0]!.id
      const regId = (
        await c.query<{ id: string }>(
          `INSERT INTO cash_master (tenant_id, version, outlet_id, code, name)
           VALUES ($1, $2, $3, 'POS1', 'POS 1') RETURNING id`,
          [tenantId, v, outletId],
        )
      ).rows[0]!.id
      const u1 = (
        await c.query<{ id: string }>(
          `INSERT INTO app_user (tenant_id, version, display_name) VALUES ($1, $2, 'Cashier') RETURNING id`,
          [tenantId, v],
        )
      ).rows[0]!.id
      const u2 = (
        await c.query<{ id: string }>(
          `INSERT INTO app_user (tenant_id, version, display_name) VALUES ($1, $2, 'Supervisor') RETURNING id`,
          [tenantId, v],
        )
      ).rows[0]!.id
      const devId = (
        await c.query<{ id: string }>(
          `INSERT INTO device (tenant_id, register_id, name, credential_hash, credential_expires_at, enrolled_by)
           VALUES ($1, $2, 'Dev', decode(md5(random()::text), 'hex'), now() + interval '30 days', $3) RETURNING id`,
          [tenantId, regId, u1],
        )
      ).rows[0]!.id
      const catId = (
        await c.query<{ id: string }>(
          `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'Food') RETURNING id`,
          [tenantId, v],
        )
      ).rows[0]!.id
      const uom1Id = (
        await c.query<{ id: string }>(
          `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'pcs', 'Pcs') RETURNING id`,
          [tenantId, v],
        )
      ).rows[0]!.id
      const uom2Id = (
        await c.query<{ id: string }>(
          `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'box', 'Box') RETURNING id`,
          [tenantId, v],
        )
      ).rows[0]!.id
      const prodId = (
        await c.query<{ id: string }>(
          `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id)
           VALUES ($1, $2, $3, 'ITEM1', 'Item 1', $4) RETURNING id`,
          [tenantId, v, catId, uom1Id],
        )
      ).rows[0]!.id
      const skuId = (
        await c.query<{ id: string }>(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default)
           VALUES ($1, $2, $3, 'ITEM1-PCS', true) RETURNING id`,
          [tenantId, v, prodId],
        )
      ).rows[0]!.id

      // Before transactions exist: outlet.code, cash_master.code, and product.base_uom_id can still change
      await c.query(`UPDATE outlet SET code = 'OUTB' WHERE id = $1`, [outletId])
      await c.query(`UPDATE cash_master SET code = 'POS2' WHERE id = $1`, [regId])
      await c.query(`UPDATE product SET base_uom_id = $2 WHERE id = $1`, [prodId, uom2Id])
      await c.query(`UPDATE product SET base_uom_id = $2 WHERE id = $1`, [prodId, uom1Id])

      return { leId, outletId, regId, u1, u2, devId, prodId, skuId, uom1Id, uom2Id }
    })

    // HasTransactionsPort must return false before any sale_line exists
    const beforeHasTx = await withTenant(tenantId, (tx) =>
      getHasTransactionsPort().hasTransactions(seeded.prodId, tx),
    )
    expect(beforeHasTx).toBe(false)

    // Execute app role checks using solva_app_login with app.tenant_id set
    await withClient(appClient, async (c) => {
      await c.query('BEGIN')
      try {
        await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])

        const cmdShift = randomUUID()
        const cmdSale = randomUUID()
        const cmdVoid = randomUUID()
        for (const [idx, [cid, ctype]] of [
          [cmdShift, 'OpenShift'],
          [cmdSale, 'FinalizeSale'],
          [cmdVoid, 'VoidSale'],
        ].entries()) {
          await c.query(
            `INSERT INTO idempotency_command (command_id, tenant_id, device_id, register_id, outlet_id, command_type, schema_version, device_seq, payload_hash, status, result)
             VALUES ($1, $2, $3, $4, $5, $6, 1, $7, repeat('b', 64), 'ACKED', '{}'::jsonb)`,
            [cid, tenantId, seeded.devId, seeded.regId, seeded.outletId, ctype, idx + 1],
          )
        }

        const shiftId = randomUUID()
        await c.query(
          `INSERT INTO cash_cashier (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version, opening_cash)
           VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1, 150000)`,
          [shiftId, tenantId, seeded.outletId, seeded.regId, seeded.devId, seeded.u1, cmdShift],
        )

        const saleId = randomUUID()
        await c.query(
          `INSERT INTO sale (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version,
            invoice_no, invoice_prefix, invoice_period, invoice_seq, shift_id, legal_entity_id, price_tax_mode, tax_profile, tax_rate, service_charge_taxable, cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
            gross_total, net_subtotal, grand_total)
           VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1,
            'OUTB-POS2-1126-000001', 'OUTB-POS2', '1126', 1, $8, $9, 'EXCLUSIVE', 'NONE', 0, true, 100, 'id-ID', false, 20000, 20000, 20000)`,
          [saleId, tenantId, seeded.outletId, seeded.regId, seeded.devId, seeded.u1, cmdSale, shiftId, seeded.leId],
        )

        const saleLineId = randomUUID()
        await c.query(
          `INSERT INTO sale_line (id, tenant_id, sale_id, outlet_id, business_date, line_no, line_kind, product_id, sku_id, uom_id, sku_code, item_name, uom_code, qty, conversion_factor, qty_base, unit_price, price_source, line_gross, line_net)
           VALUES ($1, $2, $3, $4, '2026-11-20', 1, 'ITEM', $5, $6, $7, 'ITEM1-PCS', 'Item 1', 'PCS', '1', '1', '1', 20000, 'OUTLET', 20000, 20000)`,
          [saleLineId, tenantId, saleId, seeded.outletId, seeded.prodId, seeded.skuId, seeded.uom1Id],
        )

        // Allowed UPDATE on sale void columns & cost_snapshot
        await c.query(
          `UPDATE sale SET status = 'VOID', voided_at = now(), voided_by = $2, void_approved_by = $3, void_reason_code = 'ERR', void_reason_text = 'Wrong item', void_command_id = $4 WHERE id = $1`,
          [saleId, seeded.u1, seeded.u2, cmdVoid],
        )
        await c.query(`UPDATE sale_line SET cost_snapshot = 8500 WHERE id = $1`, [saleLineId])

        // Forbidden column UPDATEs & DELETEs as solva_app
        const expectFail = async (q: string, params: unknown[]) => {
          await c.query('SAVEPOINT sp_app')
          try {
            await c.query(q, params)
            throw new Error(`Expected permission failure for: ${q}`)
          } catch (err) {
            await c.query('ROLLBACK TO SAVEPOINT sp_app')
            await c.query('RELEASE SAVEPOINT sp_app')
            return err as Error
          }
        }

        const errGrand = await expectFail(`UPDATE sale SET grand_total = 999 WHERE id = $1`, [saleId])
        expect(errGrand.message).toMatch(/permission denied/i)

        const errDelSale = await expectFail(`DELETE FROM sale WHERE id = $1`, [saleId])
        expect(errDelSale.message).toMatch(/permission denied/i)

        const errLineGross = await expectFail(`UPDATE sale_line SET line_gross = 999 WHERE id = $1`, [saleLineId])
        expect(errLineGross.message).toMatch(/permission denied/i)

        // cash_cashier write-once counted_cash: first set works, second mutation raises trigger error
        await c.query(
          `UPDATE cash_cashier SET status = 'CLOSED', closed_at = now(), counted_cash = 150000, count_submitted_at = now() WHERE id = $1`,
          [shiftId],
        )
        const errWriteOnce = await expectFail(
          `UPDATE cash_cashier SET counted_cash = 155000 WHERE id = $1`,
          [shiftId],
        )
        expect(errWriteOnce.message).toMatch(/counted_cash is write-once/i)

        await c.query('COMMIT')
      } catch (err) {
        await c.query('ROLLBACK')
        throw err
      }
    })

    // Triggers on outlet.code, cash_master.code, product.base_uom_id + HasTransactionsPort now true
    const afterHasProd = await withTenant(tenantId, (tx) =>
      getHasTransactionsPort().hasTransactions(seeded.prodId, tx),
    )
    const afterHasSku = await withTenant(tenantId, (tx) =>
      getHasTransactionsPort().hasTransactions(seeded.skuId, tx),
    )
    expect(afterHasProd).toBe(true)
    expect(afterHasSku).toBe(true)

    await expect(
      masterTx(tenantId, (c, v) =>
        c.query(`UPDATE outlet SET code = 'OUTC', version = $2 WHERE id = $1`, [seeded.outletId, v]),
      ),
    ).rejects.toThrow(/outlet\.code cannot be changed/i)

    await expect(
      masterTx(tenantId, (c, v) =>
        c.query(`UPDATE cash_master SET code = 'POS9', version = $2 WHERE id = $1`, [seeded.regId, v]),
      ),
    ).rejects.toThrow(/cash_master\.code cannot be changed/i)

    await expect(
      masterTx(tenantId, (c, v) =>
        c.query(`UPDATE product SET base_uom_id = $2, version = $3 WHERE id = $1`, [
          seeded.prodId,
          seeded.uom2Id,
          v,
        ]),
      ),
    ).rejects.toThrow(/product\.base_uom_id cannot be changed/i)
  })
})
