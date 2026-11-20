import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { closePools } from '~/server/db'
import { ownerClient, withClient } from './helpers/db'
import { masterTx } from './helpers/master'
import { createTestTenant, uniqueSlug } from './helpers/tenants'

interface SalesFixture {
  tenantId: string
  leId: string
  outletId: string
  reg1Id: string
  reg2Id: string
  dev1Id: string
  dev2Id: string
  user1Id: string
  user2Id: string
  catId: string
  uomId: string
  prodId: string
  skuId: string
  cashMethodId: string
  qrisMethodId: string
}

async function createSalesFixture(prefix: string): Promise<SalesFixture> {
  const { id: tenantId } = await createTestTenant(uniqueSlug(`sales-sch-${prefix}`))
  return masterTx(tenantId, async (c, v) => {
    const leId = (
      await c.query<{ id: string }>(
        `INSERT INTO legal_entity (tenant_id, version, name) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, v, `PT ${prefix}`],
      )
    ).rows[0]!.id
    const outletId = (
      await c.query<{ id: string }>(
        `INSERT INTO outlet (tenant_id, version, legal_entity_id, code, name, price_tax_mode)
         VALUES ($1, $2, $3, $4, $5, 'EXCLUSIVE') RETURNING id`,
        [tenantId, v, leId, `O${prefix.slice(0, 8).toUpperCase()}`, `Outlet ${prefix}`],
      )
    ).rows[0]!.id
    const reg1Id = (
      await c.query<{ id: string }>(
        `INSERT INTO cash_master (tenant_id, version, outlet_id, code, name, register_type)
         VALUES ($1, $2, $3, 'POS01', 'Reg 1', 'CASHIER') RETURNING id`,
        [tenantId, v, outletId],
      )
    ).rows[0]!.id
    const reg2Id = (
      await c.query<{ id: string }>(
        `INSERT INTO cash_master (tenant_id, version, outlet_id, code, name, register_type)
         VALUES ($1, $2, $3, 'POS02', 'Reg 2', 'CASHIER') RETURNING id`,
        [tenantId, v, outletId],
      )
    ).rows[0]!.id
    const user1Id = (
      await c.query<{ id: string }>(
        `INSERT INTO app_user (tenant_id, version, display_name) VALUES ($1, $2, 'Cashier 1') RETURNING id`,
        [tenantId, v],
      )
    ).rows[0]!.id
    const user2Id = (
      await c.query<{ id: string }>(
        `INSERT INTO app_user (tenant_id, version, display_name) VALUES ($1, $2, 'Manager 1') RETURNING id`,
        [tenantId, v],
      )
    ).rows[0]!.id
    const dev1Id = (
      await c.query<{ id: string }>(
        `INSERT INTO device (tenant_id, register_id, name, credential_hash, credential_expires_at, enrolled_by)
         VALUES ($1, $2, 'Dev 1', decode(md5(random()::text), 'hex'), now() + interval '30 days', $3) RETURNING id`,
        [tenantId, reg1Id, user1Id],
      )
    ).rows[0]!.id
    const dev2Id = (
      await c.query<{ id: string }>(
        `INSERT INTO device (tenant_id, register_id, name, credential_hash, credential_expires_at, enrolled_by)
         VALUES ($1, $2, 'Dev 2', decode(md5(random()::text), 'hex'), now() + interval '30 days', $3) RETURNING id`,
        [tenantId, reg2Id, user1Id],
      )
    ).rows[0]!.id
    const catId = (
      await c.query<{ id: string }>(
        `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'Beverage') RETURNING id`,
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
         VALUES ($1, $2, $3, 'KOP01', 'Kopi', $4) RETURNING id`,
        [tenantId, v, catId, uomId],
      )
    ).rows[0]!.id
    const skuId = (
      await c.query<{ id: string }>(
        `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default)
         VALUES ($1, $2, $3, 'KOP01-PCS', true) RETURNING id`,
        [tenantId, v, prodId],
      )
    ).rows[0]!.id
    const cashMethodId = (
      await c.query<{ id: string }>(
        `INSERT INTO payment_method (tenant_id, version, code, name, kind)
         VALUES ($1, $2, 'CASH', 'Tunai', 'CASH') RETURNING id`,
        [tenantId, v],
      )
    ).rows[0]!.id
    const qrisMethodId = (
      await c.query<{ id: string }>(
        `INSERT INTO payment_method (tenant_id, version, code, name, kind)
         VALUES ($1, $2, 'QRIS', 'QRIS', 'NON_CASH') RETURNING id`,
        [tenantId, v],
      )
    ).rows[0]!.id

    return {
      tenantId,
      leId,
      outletId,
      reg1Id,
      reg2Id,
      dev1Id,
      dev2Id,
      user1Id,
      user2Id,
      catId,
      uomId,
      prodId,
      skuId,
      cashMethodId,
      qrisMethodId,
    }
  })
}

async function seedCommand(
  c: Awaited<ReturnType<typeof ownerClient>>,
  fx: SalesFixture,
  cmdType: string,
  seq: number,
  regId = fx.reg1Id,
  devId = fx.dev1Id,
): Promise<string> {
  const cmdId = randomUUID()
  await c.query(
    `INSERT INTO idempotency_command (command_id, tenant_id, device_id, register_id, outlet_id, command_type, schema_version, device_seq, payload_hash, status, result)
     VALUES ($1, $2, $3, $4, $5, $6, 1, $7, repeat('a', 64), 'ACKED', '{}'::jsonb)`,
    [cmdId, fx.tenantId, devId, regId, fx.outletId, cmdType, seq],
  )
  return cmdId
}

async function withOwnerTenant<T>(
  tenantId: string,
  fn: (c: Awaited<ReturnType<typeof ownerClient>>) => Promise<T>,
): Promise<T> {
  return withClient(ownerClient, async (c) => {
    await c.query('BEGIN')
    try {
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
      const res = await fn(c)
      await c.query('COMMIT')
      return res
    } catch (err) {
      await c.query('ROLLBACK')
      throw err
    }
  })
}

async function expectSavepointError(
  c: Awaited<ReturnType<typeof ownerClient>>,
  sqlText: string,
  params: unknown[],
): Promise<Error> {
  await c.query('SAVEPOINT sp_err')
  try {
    await c.query(sqlText, params)
    throw new Error(`Expected query to fail: ${sqlText}`)
  } catch (err) {
    await c.query('ROLLBACK TO SAVEPOINT sp_err')
    await c.query('RELEASE SAVEPOINT sp_err')
    return err as Error
  }
}

describe('sales & shift schema constraints, generated columns, and gap exclusions (Phase 40)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('computes GENERATED total_due and refund_total (V-04, V-05, V-18) and forbids direct writes', async () => {
    const fx = await createSalesFixture('gen1')
    await withOwnerTenant(fx.tenantId, async (c) => {
      const shiftCmd = await seedCommand(c, fx, 'OpenShift', 1)
      const shiftId = randomUUID()
      await c.query(
        `INSERT INTO cash_cashier (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version, opening_cash)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1, 200000)`,
        [shiftId, fx.tenantId, fx.outletId, fx.reg1Id, fx.dev1Id, fx.user1Id, shiftCmd],
      )

      // V-04: 112476 + 24 = 112500
      const saleCmd1 = await seedCommand(c, fx, 'FinalizeSale', 2)
      const sale1Id = randomUUID()
      const res1 = await c.query<{ total_due: string }>(
        `INSERT INTO sale (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version,
          invoice_no, invoice_prefix, invoice_period, invoice_seq, shift_id, legal_entity_id, price_tax_mode, tax_profile, tax_rate, service_charge_taxable, cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
          gross_total, line_discount_total, net_subtotal, tax_base, tax_amount, dpp, grand_total, rounding)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1,
          'OUT1-POS01-1126-000001', 'OUT1-POS01', '1126', 1, $8, $9, 'EXCLUSIVE', 'PPN', 11.0000, true, 100, 'id-ID', true,
          106700, 5370, 101330, 101330, 11146, 101330, 112476, 24)
         RETURNING total_due`,
        [sale1Id, fx.tenantId, fx.outletId, fx.reg1Id, fx.dev1Id, fx.user1Id, saleCmd1, shiftId, fx.leId],
      )
      expect(Number(res1.rows[0]!.total_due)).toBe(112500)

      // V-05: 101330 - 30 = 101300
      const saleCmd2 = await seedCommand(c, fx, 'FinalizeSale', 3)
      const sale2Id = randomUUID()
      const res2 = await c.query<{ total_due: string }>(
        `INSERT INTO sale (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version,
          invoice_no, invoice_prefix, invoice_period, invoice_seq, shift_id, legal_entity_id, price_tax_mode, tax_profile, tax_rate, service_charge_taxable, cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
          gross_total, net_subtotal, tax_base, tax_amount, dpp, grand_total, rounding)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1,
          'OUT1-POS01-1126-000002', 'OUT1-POS01', '1126', 2, $8, $9, 'INCLUSIVE', 'PPN', 11.0000, true, 100, 'id-ID', true,
          101330, 101330, 101330, 10042, 91288, 101330, -30)
         RETURNING total_due`,
        [sale2Id, fx.tenantId, fx.outletId, fx.reg1Id, fx.dev1Id, fx.user1Id, saleCmd2, shiftId, fx.leId],
      )
      expect(Number(res2.rows[0]!.total_due)).toBe(101300)

      // Direct insert to generated column total_due must fail
      const genErr = await expectSavepointError(
        c,
        `UPDATE sale SET total_due = 999999 WHERE id = $1`,
        [sale1Id],
      )
      expect(genErr.message).toMatch(/can only be updated to DEFAULT/i)

      // V-18 Credit Note: 16110 + 1772 = 17882, rounding 18 -> refund_total = 17900
      const cnCmd = await seedCommand(c, fx, 'FinalizeCreditNote', 4)
      const cnRes = await c.query<{ refund_total: string }>(
        `INSERT INTO credit_note (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version,
          cn_no, cn_prefix, cn_period, cn_seq, original_sale_id, original_invoice_no, shift_id, reason_code, approved_by, price_tax_mode, cash_rounding_unit, receipt_locale,
          net_total, tax_total, refund_gross, rounding)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1,
          'OUT1-POS01-NK-1126-000001', 'OUT1-POS01', '1126', 1, $8, 'OUT1-POS01-1126-000001', $9, 'DEFECT', $10, 'EXCLUSIVE', 100, 'id-ID',
          16110, 1772, 17882, 18)
         RETURNING refund_total`,
        [randomUUID(), fx.tenantId, fx.outletId, fx.reg1Id, fx.dev1Id, fx.user1Id, cnCmd, sale1Id, shiftId, fx.user2Id],
      )
      expect(Number(cnRes.rows[0]!.refund_total)).toBe(17900)
    })
  })

  it('enforces invoice series uniqueness, single OPEN shift per register, EXCLUDE gaps, and domain CHECKs', async () => {
    const fx = await createSalesFixture('chk1')
    await withOwnerTenant(fx.tenantId, async (c) => {
      const cmdShift1 = await seedCommand(c, fx, 'OpenShift', 1, fx.reg1Id, fx.dev1Id)
      const shift1Id = randomUUID()
      await c.query(
        `INSERT INTO cash_cashier (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version, opening_cash)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1, 100000)`,
        [shift1Id, fx.tenantId, fx.outletId, fx.reg1Id, fx.dev1Id, fx.user1Id, cmdShift1],
      )

      // Second OPEN shift on same register rejected
      const cmdShiftDup = await seedCommand(c, fx, 'OpenShift', 2, fx.reg1Id, fx.dev1Id)
      const errOpenDup = await expectSavepointError(
        c,
        `INSERT INTO cash_cashier (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version, opening_cash)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1, 100000)`,
        [randomUUID(), fx.tenantId, fx.outletId, fx.reg1Id, fx.dev1Id, fx.user1Id, cmdShiftDup],
      )
      expect(errOpenDup.message).toMatch(/uq_cash_cashier__open_register/)

      // Parallel OPEN shift on reg2 succeeds!
      const cmdShift2 = await seedCommand(c, fx, 'OpenShift', 1, fx.reg2Id, fx.dev2Id)
      await c.query(
        `INSERT INTO cash_cashier (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version, opening_cash)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1, 100000)`,
        [randomUUID(), fx.tenantId, fx.outletId, fx.reg2Id, fx.dev2Id, fx.user2Id, cmdShift2],
      )

      // CLOSED without counted_cash rejected; FORCE_CLOSED without reason rejected
      await expectSavepointError(
        c,
        `INSERT INTO cash_cashier (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version, opening_cash, status, closed_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1, 0, 'CLOSED', now())`,
        [randomUUID(), fx.tenantId, fx.outletId, fx.reg2Id, fx.dev2Id, fx.user1Id, cmdShiftDup],
      )
      await expectSavepointError(
        c,
        `INSERT INTO cash_cashier (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version, opening_cash, status, closed_at, force_closed_by, counted_cash)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1, 0, 'FORCE_CLOSED', now(), $8, 0)`,
        [randomUUID(), fx.tenantId, fx.outletId, fx.reg2Id, fx.dev2Id, fx.user1Id, cmdShiftDup, fx.user2Id],
      )

      // Base sale + conflict_idx = 1 (-D1 vs duplicate invoice_no) + invalid period + invalid command_id FK
      const cmdSale = await seedCommand(c, fx, 'FinalizeSale', 3, fx.reg1Id, fx.dev1Id)
      const saleId = randomUUID()
      await c.query(
        `INSERT INTO sale (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version,
          invoice_no, invoice_prefix, invoice_period, invoice_seq, shift_id, legal_entity_id, price_tax_mode, tax_profile, tax_rate, service_charge_taxable, cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
          gross_total, net_subtotal, grand_total)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1,
          'OUT1-POS01-1126-000010', 'OUT1-POS01', '1126', 10, $8, $9, 'EXCLUSIVE', 'NONE', 0, true, 100, 'id-ID', false, 10000, 10000, 10000)`,
        [saleId, fx.tenantId, fx.outletId, fx.reg1Id, fx.dev1Id, fx.user1Id, cmdSale, shift1Id, fx.leId],
      )

      const cmdConflict = await seedCommand(c, fx, 'FinalizeSale', 4, fx.reg1Id, fx.dev1Id)
      await c.query(
        `INSERT INTO sale (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version,
          invoice_no, invoice_prefix, invoice_period, invoice_seq, invoice_conflict_idx, shift_id, legal_entity_id, price_tax_mode, tax_profile, tax_rate, service_charge_taxable, cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
          gross_total, net_subtotal, grand_total)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1,
          'OUT1-POS01-1126-000010-D1', 'OUT1-POS01', '1126', 10, 1, $8, $9, 'EXCLUSIVE', 'NONE', 0, true, 100, 'id-ID', false, 10000, 10000, 10000)`,
        [randomUUID(), fx.tenantId, fx.outletId, fx.reg1Id, fx.dev1Id, fx.user1Id, cmdConflict, shift1Id, fx.leId],
      )

      // Exact same invoice_no with conflict_idx = 2 must fail UQ(tenant_id, invoice_no)
      const errDupInv = await expectSavepointError(
        c,
        `INSERT INTO sale (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version,
          invoice_no, invoice_prefix, invoice_period, invoice_seq, invoice_conflict_idx, shift_id, legal_entity_id, price_tax_mode, tax_profile, tax_rate, service_charge_taxable, cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
          gross_total, net_subtotal, grand_total)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1,
          'OUT1-POS01-1126-000010', 'OUT1-POS01', '1126', 10, 2, $8, $9, 'EXCLUSIVE', 'NONE', 0, true, 100, 'id-ID', false, 10000, 10000, 10000)`,
        [randomUUID(), fx.tenantId, fx.outletId, fx.reg1Id, fx.dev1Id, fx.user1Id, cmdConflict, shift1Id, fx.leId],
      )
      expect(errDupInv.message).toMatch(/uq_sale__tenant_invoice_no/)

      // Invalid invoice_period 1326 rejected; bogus command_id rejected
      await expectSavepointError(
        c,
        `INSERT INTO sale (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version,
          invoice_no, invoice_prefix, invoice_period, invoice_seq, shift_id, legal_entity_id, price_tax_mode, tax_profile, tax_rate, service_charge_taxable, cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
          gross_total, net_subtotal, grand_total)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1,
          'OUT1-POS01-1326-000001', 'OUT1-POS01', '1326', 1, $8, $9, 'EXCLUSIVE', 'NONE', 0, true, 100, 'id-ID', false, 10000, 10000, 10000)`,
        [randomUUID(), fx.tenantId, fx.outletId, fx.reg1Id, fx.dev1Id, fx.user1Id, cmdConflict, shift1Id, fx.leId],
      )
      await expectSavepointError(
        c,
        `INSERT INTO sale (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version,
          invoice_no, invoice_prefix, invoice_period, invoice_seq, shift_id, legal_entity_id, price_tax_mode, tax_profile, tax_rate, service_charge_taxable, cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
          gross_total, net_subtotal, grand_total)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1,
          'OUT1-POS01-1126-000099', 'OUT1-POS01', '1126', 99, $8, $9, 'EXCLUSIVE', 'NONE', 0, true, 100, 'id-ID', false, 10000, 10000, 10000)`,
        [randomUUID(), fx.tenantId, fx.outletId, fx.reg1Id, fx.dev1Id, fx.user1Id, randomUUID(), shift1Id, fx.leId],
      )

      // Line CHECKs: SHARE without sku_id ok; ITEM without sku_id fail; OPEN_PRICE without is_open_price fail
      await c.query(
        `INSERT INTO sale_line (id, tenant_id, sale_id, outlet_id, business_date, line_no, line_kind, sku_code, item_name, uom_code, qty, conversion_factor, qty_base, unit_price, price_source, line_gross, line_net)
         VALUES ($1, $2, $3, $4, '2026-11-20', 1, 'SHARE', 'SHARE', 'Bagian 1/2', 'PCS', '1', '1', '1', 5000, 'OUTLET', 5000, 5000)`,
        [randomUUID(), fx.tenantId, saleId, fx.outletId],
      )
      await expectSavepointError(
        c,
        `INSERT INTO sale_line (id, tenant_id, sale_id, outlet_id, business_date, line_no, line_kind, sku_code, item_name, uom_code, qty, conversion_factor, qty_base, unit_price, price_source, line_gross, line_net)
         VALUES ($1, $2, $3, $4, '2026-11-20', 2, 'ITEM', 'KOP', 'Kopi', 'PCS', '1', '1', '1', 5000, 'OUTLET', 5000, 5000)`,
        [randomUUID(), fx.tenantId, saleId, fx.outletId],
      )
      await expectSavepointError(
        c,
        `INSERT INTO sale_line (id, tenant_id, sale_id, outlet_id, business_date, line_no, line_kind, sku_id, uom_id, sku_code, item_name, uom_code, qty, conversion_factor, qty_base, unit_price, price_source, is_open_price, line_gross, line_net)
         VALUES ($1, $2, $3, $4, '2026-11-20', 2, 'ITEM', $5, $6, 'KOP', 'Kopi', 'PCS', '1', '1', '1', 5000, 'OPEN_PRICE', false, 5000, 5000)`,
        [randomUUID(), fx.tenantId, saleId, fx.outletId, fx.skuId, fx.uomId],
      )

      // Payment CHECKs: CASH without cash_tendered fails; NON_CASH with cash_tendered fails
      await expectSavepointError(
        c,
        `INSERT INTO sale_payment (id, tenant_id, sale_id, shift_id, outlet_id, business_date, seq, method_id, method_code, method_name, method_kind, amount_applied)
         VALUES ($1, $2, $3, $4, $5, '2026-11-20', 1, $6, 'CASH', 'Tunai', 'CASH', 10000)`,
        [randomUUID(), fx.tenantId, saleId, shift1Id, fx.outletId, fx.cashMethodId],
      )
      await expectSavepointError(
        c,
        `INSERT INTO sale_payment (id, tenant_id, sale_id, shift_id, outlet_id, business_date, seq, method_id, method_code, method_name, method_kind, amount_applied, cash_tendered, change_given)
         VALUES ($1, $2, $3, $4, $5, '2026-11-20', 2, $6, 'QRIS', 'QRIS', 'NON_CASH', 10000, 10000, 0)`,
        [randomUUID(), fx.tenantId, saleId, shift1Id, fx.outletId, fx.qrisMethodId],
      )

      // Void complete CHECK & CN approver <> creator CHECK
      await expectSavepointError(
        c,
        `UPDATE sale SET status = 'VOID', voided_at = now(), voided_by = $2, void_approved_by = $3 WHERE id = $1`,
        [saleId, fx.user1Id, fx.user2Id],
      )
      await expectSavepointError(
        c,
        `INSERT INTO credit_note (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version,
          cn_no, cn_prefix, cn_period, cn_seq, original_sale_id, original_invoice_no, shift_id, reason_code, approved_by, price_tax_mode, cash_rounding_unit, receipt_locale,
          net_total, refund_gross)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1,
          'OUT1-POS01-NK-1126-000002', 'OUT1-POS01', '1126', 2, $8, 'OUT1-POS01-1126-000010', $9, 'ERR', $6, 'EXCLUSIVE', 100, 'id-ID', 1000, 1000)`,
        [randomUUID(), fx.tenantId, fx.outletId, fx.reg1Id, fx.dev1Id, fx.user1Id, cmdConflict, saleId, shift1Id],
      )

      // EXCLUDE USING gist on invoice_gap
      const gap1Id = randomUUID()
      await c.query(
        `INSERT INTO invoice_gap (id, tenant_id, outlet_id, register_id, doc_type, period, seq_from, seq_to, origin, status)
         VALUES ($1, $2, $3, $4, 'INVOICE', '1126', 125, 127, 'DETECTED', 'OPEN')`,
        [gap1Id, fx.tenantId, fx.outletId, fx.reg1Id],
      )
      await expectSavepointError(
        c,
        `INSERT INTO invoice_gap (id, tenant_id, outlet_id, register_id, doc_type, period, seq_from, seq_to, origin, status)
         VALUES ($1, $2, $3, $4, 'INVOICE', '1126', 126, 130, 'DETECTED', 'OPEN')`,
        [randomUUID(), fx.tenantId, fx.outletId, fx.reg1Id],
      )
      // EXPLAINED without explanation fields fails
      await expectSavepointError(
        c,
        `UPDATE invoice_gap SET status = 'EXPLAINED' WHERE id = $1`,
        [gap1Id],
      )
      // After marking gap1 FILLED, overlapping range 126..130 succeeds
      await c.query(`UPDATE invoice_gap SET status = 'FILLED', filled_at = now() WHERE id = $1`, [gap1Id])
      await c.query(
        `INSERT INTO invoice_gap (id, tenant_id, outlet_id, register_id, doc_type, period, seq_from, seq_to, origin, status)
         VALUES ($1, $2, $3, $4, 'INVOICE', '1126', 126, 130, 'DETECTED', 'OPEN')`,
        [randomUUID(), fx.tenantId, fx.outletId, fx.reg1Id],
      )
    })
  })
})
