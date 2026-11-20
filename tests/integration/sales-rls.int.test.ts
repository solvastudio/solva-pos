import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { closePools } from '~/server/db'
import { appClient, ownerClient, withClient } from './helpers/db'
import { masterTx } from './helpers/master'
import { createTestTenant, uniqueSlug } from './helpers/tenants'

const ALL_SALES_SHIFT_TABLES = [
  'cash_cashier',
  'cash_movement',
  'sale',
  'sale_line',
  'sale_payment',
  'credit_note',
  'credit_note_line',
  'credit_note_refund',
  'invoice_series',
  'invoice_gap',
  'register_recovery',
] as const

async function seedTenantTxBundle(tenantId: string, tag: string) {
  return masterTx(tenantId, async (c, v) => {
    const leId = (
      await c.query<{ id: string }>(
        `INSERT INTO legal_entity (tenant_id, version, name) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, v, `PT ${tag}`],
      )
    ).rows[0]!.id
    const outletId = (
      await c.query<{ id: string }>(
        `INSERT INTO outlet (tenant_id, version, legal_entity_id, code, name, price_tax_mode)
         VALUES ($1, $2, $3, $4, $5, 'EXCLUSIVE') RETURNING id`,
        [tenantId, v, leId, `O${tag}`, `Outlet ${tag}`],
      )
    ).rows[0]!.id
    const regId = (
      await c.query<{ id: string }>(
        `INSERT INTO cash_master (tenant_id, version, outlet_id, code, name)
         VALUES ($1, $2, $3, 'POS1', 'Reg 1') RETURNING id`,
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
        `INSERT INTO app_user (tenant_id, version, display_name) VALUES ($1, $2, 'Sup') RETURNING id`,
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
        `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'Cat') RETURNING id`,
        [tenantId, v],
      )
    ).rows[0]!.id
    const uomId = (
      await c.query<{ id: string }>(
        `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'pcs', 'Pcs') RETURNING id`,
        [tenantId, v],
      )
    ).rows[0]!.id
    const prodId = (
      await c.query<{ id: string }>(
        `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id)
         VALUES ($1, $2, $3, 'P1', 'Prod 1', $4) RETURNING id`,
        [tenantId, v, catId, uomId],
      )
    ).rows[0]!.id
    const skuId = (
      await c.query<{ id: string }>(
        `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default)
         VALUES ($1, $2, $3, 'SKU1', true) RETURNING id`,
        [tenantId, v, prodId],
      )
    ).rows[0]!.id
    const methodId = (
      await c.query<{ id: string }>(
        `INSERT INTO payment_method (tenant_id, version, code, name, kind)
         VALUES ($1, $2, 'CASH', 'Tunai', 'CASH') RETURNING id`,
        [tenantId, v],
      )
    ).rows[0]!.id

    const ids: Array<[string, string]> = [
      [randomUUID(), 'OpenShift'],
      [randomUUID(), 'RecordCashMovement'],
      [randomUUID(), 'FinalizeSale'],
      [randomUUID(), 'FinalizeCreditNote'],
    ]
    for (let i = 0; i < ids.length; i += 1) {
      const [cid, type] = ids[i]!
      await c.query(
        `INSERT INTO idempotency_command (command_id, tenant_id, device_id, register_id, outlet_id, command_type, schema_version, device_seq, payload_hash, status, result)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, repeat('c', 64), 'ACKED', '{}'::jsonb)`,
        [cid, tenantId, devId, regId, outletId, type, i + 1],
      )
    }

    const shiftId = randomUUID()
    await c.query(
      `INSERT INTO cash_cashier (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version, opening_cash)
       VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1, 100000)`,
      [shiftId, tenantId, outletId, regId, devId, u1, ids[0]![0]],
    )
    await c.query(
      `INSERT INTO cash_movement (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version, shift_id, direction, amount, reason_code, reason_text)
       VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1, $8, 'IN', 50000, 'TOPUP', 'Top up coins')`,
      [randomUUID(), tenantId, outletId, regId, devId, u1, ids[1]![0], shiftId],
    )
    const saleId = randomUUID()
    await c.query(
      `INSERT INTO sale (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version,
        invoice_no, invoice_prefix, invoice_period, invoice_seq, shift_id, legal_entity_id, price_tax_mode, tax_profile, tax_rate, service_charge_taxable, cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
        gross_total, net_subtotal, grand_total)
       VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1,
        'O-POS1-1126-000001', 'O-POS1', '1126', 1, $8, $9, 'EXCLUSIVE', 'NONE', 0, true, 100, 'id-ID', false, 10000, 10000, 10000)`,
      [saleId, tenantId, outletId, regId, devId, u1, ids[2]![0], shiftId, leId],
    )
    const saleLineId = randomUUID()
    await c.query(
      `INSERT INTO sale_line (id, tenant_id, sale_id, outlet_id, business_date, line_no, line_kind, product_id, sku_id, uom_id, sku_code, item_name, uom_code, qty, conversion_factor, qty_base, unit_price, price_source, line_gross, line_net)
       VALUES ($1, $2, $3, $4, '2026-11-20', 1, 'ITEM', $5, $6, $7, 'SKU1', 'Prod 1', 'PCS', '1', '1', '1', 10000, 'OUTLET', 10000, 10000)`,
      [saleLineId, tenantId, saleId, outletId, prodId, skuId, uomId],
    )
    await c.query(
      `INSERT INTO sale_payment (id, tenant_id, sale_id, shift_id, outlet_id, business_date, seq, method_id, method_code, method_name, method_kind, amount_applied, cash_tendered, change_given)
       VALUES ($1, $2, $3, $4, $5, '2026-11-20', 1, $6, 'CASH', 'Tunai', 'CASH', 10000, 10000, 0)`,
      [randomUUID(), tenantId, saleId, shiftId, outletId, methodId],
    )
    const cnId = randomUUID()
    await c.query(
      `INSERT INTO credit_note (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version,
        cn_no, cn_prefix, cn_period, cn_seq, original_sale_id, original_invoice_no, shift_id, reason_code, approved_by, price_tax_mode, cash_rounding_unit, receipt_locale,
        net_total, refund_gross)
       VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1,
        'O-POS1-NK-1126-000001', 'O-POS1', '1126', 1, $8, 'O-POS1-1126-000001', $9, 'DEFECT', $10, 'EXCLUSIVE', 100, 'id-ID', 5000, 5000)`,
      [cnId, tenantId, outletId, regId, devId, u1, ids[3]![0], saleId, shiftId, u2],
    )
    await c.query(
      `INSERT INTO credit_note_line (id, tenant_id, credit_note_id, sale_line_id, outlet_id, business_date, line_no, qty_returned, qty_returned_base, refund_net, disposition)
       VALUES ($1, $2, $3, $4, $5, '2026-11-20', 1, '0.5', '0.5', 5000, 'BUANG')`,
      [randomUUID(), tenantId, cnId, saleLineId, outletId],
    )
    await c.query(
      `INSERT INTO credit_note_refund (id, tenant_id, credit_note_id, shift_id, seq, method_id, method_code, method_name, method_kind, amount_applied)
       VALUES ($1, $2, $3, $4, 1, $5, 'CASH', 'Tunai', 'CASH', 5000)`,
      [randomUUID(), tenantId, cnId, shiftId, methodId],
    )
    await c.query(
      `INSERT INTO invoice_series (register_id, doc_type, period, tenant_id, outlet_id, max_seq_received, received_count)
       VALUES ($1, 'INVOICE', '1126', $2, $3, 1, 1)`,
      [regId, tenantId, outletId],
    )
    const recId = randomUUID()
    await c.query(
      `INSERT INTO register_recovery (id, tenant_id, outlet_id, register_id, doc_type, period, old_device_id, highest_received_seq, next_seq, performed_by)
       VALUES ($1, $2, $3, $4, 'INVOICE', '1126', $5, 1, 2, $6)`,
      [recId, tenantId, outletId, regId, devId, u2],
    )
    await c.query(
      `INSERT INTO invoice_gap (id, tenant_id, outlet_id, register_id, doc_type, period, seq_from, seq_to, origin, register_recovery_id)
       VALUES ($1, $2, $3, $4, 'INVOICE', '1126', 10, 12, 'RECOVERY_DECLARED', $5)`,
      [randomUUID(), tenantId, outletId, regId, recId],
    )

    return { tenantId, outletId, regId, devId, shiftId, saleId, saleLineId, u1 }
  })
}

describe('sales & shift RLS isolation and cross-tenant composite FKs (Phase 40)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('isolates all 11 tables across tenants and blocks cross-tenant writes and composite FKs', async () => {
    const a = await createTestTenant(uniqueSlug('sales-rls-a'))
    const b = await createTestTenant(uniqueSlug('sales-rls-b'))

    const bundleA = await seedTenantTxBundle(a.id, 'A')
    const bundleB = await seedTenantTxBundle(b.id, 'B')

    await withClient(appClient, async (c) => {
      await c.query('BEGIN')
      try {
        await c.query("SELECT set_config('app.tenant_id', $1, true)", [a.id])

        for (const table of ALL_SALES_SHIFT_TABLES) {
          const ownRes = await c.query(`SELECT count(*)::int AS cnt FROM "${table}" WHERE tenant_id = $1`, [
            a.id,
          ])
          expect(ownRes.rows[0]!.cnt).toBeGreaterThanOrEqual(1)

          const otherRes = await c.query(`SELECT count(*)::int AS cnt FROM "${table}" WHERE tenant_id = $1`, [
            b.id,
          ])
          expect(otherRes.rows[0]!.cnt).toBe(0)
        }

        // Tenant A session inserting with tenant_id = B fails WITH CHECK policy
        await c.query('SAVEPOINT sp_rls_ins')
        await expect(
          c.query(
            `INSERT INTO invoice_series (register_id, doc_type, period, tenant_id, outlet_id, max_seq_received, received_count)
             VALUES ($1, 'CREDIT_NOTE', '1126', $2, $3, 0, 0)`,
            [bundleB.regId, b.id, bundleB.outletId],
          ),
        ).rejects.toThrow(/row-level security policy/i)
        await c.query('ROLLBACK TO SAVEPOINT sp_rls_ins')
        await c.query('RELEASE SAVEPOINT sp_rls_ins')

        await c.query('COMMIT')
      } catch (err) {
        await c.query('ROLLBACK')
        throw err
      }
    })

    // Cross-tenant composite FK rejected even as owner
    await withClient(ownerClient, async (c) => {
      await c.query('BEGIN')
      try {
        await c.query("SELECT set_config('app.tenant_id', $1, true)", [a.id])
        await expect(
          c.query(
            `INSERT INTO sale_line (id, tenant_id, sale_id, outlet_id, business_date, line_no, line_kind, sku_code, item_name, uom_code, qty, conversion_factor, qty_base, unit_price, price_source, line_gross, line_net)
             VALUES ($1, $2, $3, $4, '2026-11-20', 9, 'SHARE', 'SHARE', 'X', 'PCS', '1', '1', '1', 1000, 'OUTLET', 1000, 1000)`,
            [randomUUID(), a.id, bundleB.saleId, bundleA.outletId],
          ),
        ).rejects.toThrow(/fk_sale_line__sale/i)
        await c.query('ROLLBACK')
      } catch (err) {
        await c.query('ROLLBACK')
        throw err
      }
    })
  })
})
