import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
} from '~/modules/identity/public'
import {
  __resetReportSlotsForTests,
  getShiftReport,
} from '~/modules/reporting/public'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { __resetPushLimitsForTests } from '~/server/auth/rate-limit/push-limits'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
import {
  insertStubCommand,
  newTestUuid,
  seedV25SalesReportFixture,
} from '../fixtures/report-seed'

beforeEach(() => {
  resetEnvForTests()
  __clearTenantCacheForTests()
  __clearDeviceAuthCacheForTests()
  resetLimitersForTests()
  __resetPushLimitsForTests()
  __resetReportSlotsForTests()
  resetCompositionForTests()
  composeServer()
})

afterAll(async () => {
  await closePools()
})

describe('R-03 Shift Recap & Cash Variance Report', () => {
  it('reproduces PRD §12 R-03 example (expected 1.782.100, counted 1.780.000, variance -2.100, QRIS 830.000, Transfer 300.000) and handles OPEN & FORCE_CLOSED shifts', async () => {
    const fix = await seedV25SalesReportFixture()

    const r03ShiftId = newTestUuid()
    const forceShiftId = newTestUuid()
    const saleCashId = newTestUuid()
    const saleQrisId = newTestUuid()
    const saleTransferId = newTestUuid()
    const cnCashId = newTestUuid()
    const cnNonCashId = newTestUuid()

    await withTenant(fix.tenantId, async (tx) => {
      const cashRow = await tx.execute(
        sql`SELECT id FROM payment_method WHERE tenant_id = ${fix.tenantId}::uuid AND code = 'CASH' LIMIT 1`,
      )
      const cashMethodId = (cashRow.rows[0] as { id: string }).id

      const mkCmd = (
        commandType:
          | 'OpenShift'
          | 'CloseShift'
          | 'RecordCashMovement'
          | 'FinalizeSale'
          | 'FinalizeCreditNote',
        outletId = fix.out1.id,
        registerId = fix.reg2.id,
        deviceId = fix.dev2.deviceId,
      ) =>
        insertStubCommand(tx, {
          tenantId: fix.tenantId,
          outletId,
          registerId,
          deviceId,
          commandType,
        })

      const openCmdId = await mkCmd('OpenShift')
      const closeCmdId = await mkCmd('CloseShift')
      const saleCashCmdId = await mkCmd('FinalizeSale')
      const saleQrisCmdId = await mkCmd('FinalizeSale')
      const saleTrfCmdId = await mkCmd('FinalizeSale')
      const cmInCmdId = await mkCmd('RecordCashMovement')
      const cmOutCmdId = await mkCmd('RecordCashMovement')
      const cnCashCmdId = await mkCmd('FinalizeCreditNote')
      const cnNonCashCmdId = await mkCmd('FinalizeCreditNote')
      const forceOpenCmdId = await mkCmd(
        'OpenShift',
        fix.out2.id,
        fix.regOut2.id,
        fix.devOut2.deviceId,
      )

      // 1. PRD §12 R-03 Shift on OUT01-POS02, cashier Dewi, 2026-11-18:
      // opening 500.000, cashSales 1.250.000 (with higher cash_tendered 1.300.000 to verify amount_applied is used!),
      // cashIn 200.000, cashOut 150.000, cashRefunds 17.900 -> expected 1.782.100, counted 1.780.000 -> variance -2.100
      await tx.execute(sql`
        INSERT INTO cash_cashier (
          id, tenant_id, outlet_id, register_id, device_id, created_by,
          created_at_device, clock_offset_ms, occurred_at, business_date,
          command_id, schema_version, app_version,
          status, opening_cash, closed_at, closed_at_device, close_command_id,
          counted_cash, count_submitted_at, recap_status
        ) VALUES (
          ${r03ShiftId}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, ${fix.reg2.id}::uuid, ${fix.dev2.deviceId}::uuid, ${fix.cashierId}::uuid,
          '2026-11-18T08:00:00.000Z', 0, '2026-11-18T08:00:00.000Z', '2026-11-18',
          ${openCmdId}::uuid, 1, 'v1.0.0',
          'CLOSED', 500000, '2026-11-18T16:00:00.000Z', '2026-11-18T16:00:00.000Z', ${closeCmdId}::uuid,
          1780000, '2026-11-18T16:00:00.000Z', 'COMPLETE'
        )
      `)

      // Cash sale: amount_applied = 1.250.000, cash_tendered = 1.300.000, change_given = 50.000
      await tx.execute(sql`
        INSERT INTO sale (
          id, tenant_id, outlet_id, register_id, device_id, created_by,
          created_at_device, clock_offset_ms, occurred_at, business_date,
          command_id, schema_version, app_version,
          invoice_no, invoice_prefix, invoice_period, invoice_seq, invoice_conflict_idx,
          shift_id, legal_entity_id, status,
          price_tax_mode, tax_profile, tax_rate, service_charge_rate, service_charge_taxable,
          cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
          gross_total, line_discount_total, bill_discount_total, net_subtotal,
          service_charge, tax_base, tax_amount, dpp, grand_total, rounding
        ) VALUES (
          ${saleCashId}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, ${fix.reg2.id}::uuid, ${fix.dev2.deviceId}::uuid, ${fix.cashierId}::uuid,
          '2026-11-18T09:00:00.000Z', 0, '2026-11-18T09:00:00.000Z', '2026-11-18',
          ${saleCashCmdId}::uuid, 1, 'v1.0.0',
          'OUT01-POS02-1126-000001', 'OUT01-POS02', '1126', 1, 0,
          ${r03ShiftId}::uuid, ${fix.le.id}::uuid, 'PAID',
          'INCLUSIVE', 'NONE', '0.0000', '0.0000', false,
          0, 'id-ID', true,
          1250000, 0, 0, 1250000,
          0, 0, 0, 0, 1250000, 0
        )
      `)
      await tx.execute(sql`
        INSERT INTO sale_payment (
          id, tenant_id, sale_id, shift_id, outlet_id, business_date, seq,
          method_id, method_code, method_name, method_kind,
          amount_applied, cash_tendered, change_given, is_rounding_settler
        ) VALUES (
          ${newTestUuid()}::uuid, ${fix.tenantId}::uuid, ${saleCashId}::uuid, ${r03ShiftId}::uuid, ${fix.out1.id}::uuid, '2026-11-18', 1,
          ${cashMethodId}::uuid, 'CASH', 'Tunai', 'CASH',
          1250000, 1300000, 50000, true
        )
      `)

      // QRIS sale: 830.000
      await tx.execute(sql`
        INSERT INTO sale (
          id, tenant_id, outlet_id, register_id, device_id, created_by,
          created_at_device, clock_offset_ms, occurred_at, business_date,
          command_id, schema_version, app_version,
          invoice_no, invoice_prefix, invoice_period, invoice_seq, invoice_conflict_idx,
          shift_id, legal_entity_id, status,
          price_tax_mode, tax_profile, tax_rate, service_charge_rate, service_charge_taxable,
          cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
          gross_total, line_discount_total, bill_discount_total, net_subtotal,
          service_charge, tax_base, tax_amount, dpp, grand_total, rounding
        ) VALUES (
          ${saleQrisId}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, ${fix.reg2.id}::uuid, ${fix.dev2.deviceId}::uuid, ${fix.cashierId}::uuid,
          '2026-11-18T10:00:00.000Z', 0, '2026-11-18T10:00:00.000Z', '2026-11-18',
          ${saleQrisCmdId}::uuid, 1, 'v1.0.0',
          'OUT01-POS02-1126-000002', 'OUT01-POS02', '1126', 2, 0,
          ${r03ShiftId}::uuid, ${fix.le.id}::uuid, 'PAID',
          'INCLUSIVE', 'NONE', '0.0000', '0.0000', false,
          0, 'id-ID', true,
          830000, 0, 0, 830000,
          0, 0, 0, 0, 830000, 0
        )
      `)
      await tx.execute(sql`
        INSERT INTO sale_payment (
          id, tenant_id, sale_id, shift_id, outlet_id, business_date, seq,
          method_id, method_code, method_name, method_kind,
          amount_applied, reference, is_rounding_settler
        ) VALUES (
          ${newTestUuid()}::uuid, ${fix.tenantId}::uuid, ${saleQrisId}::uuid, ${r03ShiftId}::uuid, ${fix.out1.id}::uuid, '2026-11-18', 1,
          ${fix.qrisMethod.id}::uuid, 'QRIS', 'QRIS', 'NON_CASH',
          830000, 'QRIS-002', false
        )
      `)

      // Transfer sale: 300.000
      await tx.execute(sql`
        INSERT INTO sale (
          id, tenant_id, outlet_id, register_id, device_id, created_by,
          created_at_device, clock_offset_ms, occurred_at, business_date,
          command_id, schema_version, app_version,
          invoice_no, invoice_prefix, invoice_period, invoice_seq, invoice_conflict_idx,
          shift_id, legal_entity_id, status,
          price_tax_mode, tax_profile, tax_rate, service_charge_rate, service_charge_taxable,
          cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
          gross_total, line_discount_total, bill_discount_total, net_subtotal,
          service_charge, tax_base, tax_amount, dpp, grand_total, rounding
        ) VALUES (
          ${saleTransferId}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, ${fix.reg2.id}::uuid, ${fix.dev2.deviceId}::uuid, ${fix.cashierId}::uuid,
          '2026-11-18T11:00:00.000Z', 0, '2026-11-18T11:00:00.000Z', '2026-11-18',
          ${saleTrfCmdId}::uuid, 1, 'v1.0.0',
          'OUT01-POS02-1126-000003', 'OUT01-POS02', '1126', 3, 0,
          ${r03ShiftId}::uuid, ${fix.le.id}::uuid, 'PAID',
          'INCLUSIVE', 'NONE', '0.0000', '0.0000', false,
          0, 'id-ID', true,
          300000, 0, 0, 300000,
          0, 0, 0, 0, 300000, 0
        )
      `)
      await tx.execute(sql`
        INSERT INTO sale_payment (
          id, tenant_id, sale_id, shift_id, outlet_id, business_date, seq,
          method_id, method_code, method_name, method_kind,
          amount_applied, reference, is_rounding_settler
        ) VALUES (
          ${newTestUuid()}::uuid, ${fix.tenantId}::uuid, ${saleTransferId}::uuid, ${r03ShiftId}::uuid, ${fix.out1.id}::uuid, '2026-11-18', 1,
          ${fix.transferMethod.id}::uuid, 'TRANSFER', 'Transfer', 'NON_CASH',
          300000, 'TRF-003', false
        )
      `)

      // Cash movements: CASH_IN 200.000, CASH_OUT 150.000
      await tx.execute(sql`
        INSERT INTO cash_movement (
          id, tenant_id, outlet_id, register_id, device_id, created_by,
          created_at_device, clock_offset_ms, occurred_at, business_date,
          command_id, schema_version, app_version,
          shift_id, direction, amount, reason_code, reason_text
        ) VALUES
          (
            ${newTestUuid()}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, ${fix.reg2.id}::uuid, ${fix.dev2.deviceId}::uuid, ${fix.cashierId}::uuid,
            '2026-11-18T12:00:00.000Z', 0, '2026-11-18T12:00:00.000Z', '2026-11-18',
            ${cmInCmdId}::uuid, 1, 'v1.0.0',
            ${r03ShiftId}::uuid, 'IN', 200000, 'MODAL_TAMBAHAN', 'Tambah uang pecahan'
          ),
          (
            ${newTestUuid()}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, ${fix.reg2.id}::uuid, ${fix.dev2.deviceId}::uuid, ${fix.cashierId}::uuid,
            '2026-11-18T13:00:00.000Z', 0, '2026-11-18T13:00:00.000Z', '2026-11-18',
            ${cmOutCmdId}::uuid, 1, 'v1.0.0',
            ${r03ShiftId}::uuid, 'OUT', 150000, 'SETOR_BANK', 'Setor kas siang'
          )
      `)

      // Cash refund credit note: 17.900 (reduces expectedCash)
      await tx.execute(sql`
        INSERT INTO credit_note (
          id, tenant_id, outlet_id, register_id, device_id, created_by,
          created_at_device, clock_offset_ms, occurred_at, business_date,
          command_id, schema_version, app_version,
          cn_no, cn_prefix, cn_period, cn_seq, cn_conflict_idx,
          original_sale_id, original_invoice_no, shift_id, status,
          reason_code, reason_text, approved_by,
          price_tax_mode, cash_rounding_unit, receipt_locale,
          net_total, service_total, tax_total, refund_gross, rounding
        ) VALUES (
          ${cnCashId}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, ${fix.reg2.id}::uuid, ${fix.dev2.deviceId}::uuid, ${fix.cashierId}::uuid,
          '2026-11-18T14:00:00.000Z', 0, '2026-11-18T14:00:00.000Z', '2026-11-18',
          ${cnCashCmdId}::uuid, 1, 'v1.0.0',
          'OUT01-POS02-NK-1126-000001', 'OUT01-POS02', '1126', 1, 0,
          ${saleCashId}::uuid, 'OUT01-POS02-1126-000001', ${r03ShiftId}::uuid, 'POSTED',
          'RUSAK', 'Retur tunai', ${fix.ownerId}::uuid,
          'INCLUSIVE', 0, 'id-ID',
          17900, 0, 0, 17900, 0
        )
      `)
      await tx.execute(sql`
        INSERT INTO credit_note_refund (
          id, tenant_id, credit_note_id, shift_id, seq,
          method_id, method_code, method_name, method_kind, amount_applied
        ) VALUES (
          ${newTestUuid()}::uuid, ${fix.tenantId}::uuid, ${cnCashId}::uuid, ${r03ShiftId}::uuid, 1,
          ${cashMethodId}::uuid, 'CASH', 'Tunai', 'CASH', 17900
        )
      `)

      // Non-cash refund credit note: 25.000 via Transfer (must NOT reduce expectedCash!)
      await tx.execute(sql`
        INSERT INTO credit_note (
          id, tenant_id, outlet_id, register_id, device_id, created_by,
          created_at_device, clock_offset_ms, occurred_at, business_date,
          command_id, schema_version, app_version,
          cn_no, cn_prefix, cn_period, cn_seq, cn_conflict_idx,
          original_sale_id, original_invoice_no, shift_id, status,
          reason_code, reason_text, approved_by,
          price_tax_mode, cash_rounding_unit, receipt_locale,
          net_total, service_total, tax_total, refund_gross, rounding
        ) VALUES (
          ${cnNonCashId}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, ${fix.reg2.id}::uuid, ${fix.dev2.deviceId}::uuid, ${fix.cashierId}::uuid,
          '2026-11-18T14:30:00.000Z', 0, '2026-11-18T14:30:00.000Z', '2026-11-18',
          ${cnNonCashCmdId}::uuid, 1, 'v1.0.0',
          'OUT01-POS02-NK-1126-000002', 'OUT01-POS02', '1126', 2, 0,
          ${saleTransferId}::uuid, 'OUT01-POS02-1126-000003', ${r03ShiftId}::uuid, 'POSTED',
          'RUSAK', 'Retur transfer', ${fix.ownerId}::uuid,
          'INCLUSIVE', 0, 'id-ID',
          25000, 0, 0, 25000, 0
        )
      `)
      await tx.execute(sql`
        INSERT INTO credit_note_refund (
          id, tenant_id, credit_note_id, shift_id, seq,
          method_id, method_code, method_name, method_kind, amount_applied, reference
        ) VALUES (
          ${newTestUuid()}::uuid, ${fix.tenantId}::uuid, ${cnNonCashId}::uuid, ${r03ShiftId}::uuid, 1,
          ${fix.transferMethod.id}::uuid, 'TRANSFER', 'Transfer', 'NON_CASH', 25000, 'REF-TRF'
        )
      `)

      // 2. FORCE_CLOSED shift on 2026-11-18
      await tx.execute(sql`
        INSERT INTO cash_cashier (
          id, tenant_id, outlet_id, register_id, device_id, created_by,
          created_at_device, clock_offset_ms, occurred_at, business_date,
          command_id, schema_version, app_version,
          status, opening_cash, closed_at, counted_cash, recap_status,
          force_closed_by, force_close_reason_text
        ) VALUES (
          ${forceShiftId}::uuid, ${fix.tenantId}::uuid, ${fix.out2.id}::uuid, ${fix.regOut2.id}::uuid, ${fix.devOut2.deviceId}::uuid, ${fix.cashier2Id}::uuid,
          '2026-11-18T08:00:00.000Z', 0, '2026-11-18T08:00:00.000Z', '2026-11-18',
          ${forceOpenCmdId}::uuid, 1, 'v1.0.0',
          'FORCE_CLOSED', 300000, '2026-11-18T20:00:00.000Z', 300000, 'INCOMPLETE',
          ${fix.ownerId}::uuid, 'Perangkat rusak'
        )
      `)
    })

    const rpt = await getShiftReport(fix.ownerActor, {
      outletIds: [],
      from: '2026-11-17',
      to: '2026-11-18',
      groupBy: 'DAY',
    })

    // Verify PRD §12 R-03 shift row
    const prdShift = rpt.rows.find((r) => r.shiftId === r03ShiftId)!
    expect(prdShift).toBeDefined()
    expect(prdShift.registerLabel).toBe('OUT01-POS02')
    expect(prdShift.cashierName).toBe('Dewi Kasir')
    expect(prdShift.openingCash).toBe(500_000)
    expect(prdShift.cashSales).toBe(1_250_000)
    expect(prdShift.cashIn).toBe(200_000)
    expect(prdShift.cashOut).toBe(150_000)
    expect(prdShift.cashRefunds).toBe(17_900)
    expect(prdShift.expectedCash).toBe(1_782_100)
    expect(prdShift.countedCash).toBe(1_780_000)
    expect(prdShift.variance).toBe(-2_100)
    expect(prdShift.status).toBe('COMPLETE')
    expect(
      prdShift.nonCashByMethod.find((m) => m.methodCode === 'QRIS')?.amountApplied,
    ).toBe(830_000)
    expect(
      prdShift.nonCashByMethod.find((m) => m.methodCode === 'TRANSFER')?.amountApplied,
    ).toBe(300_000)

    // Verify OPEN shift from V-25 fixture has variance: null and status: 'OPEN'
    const openShift = rpt.rows.find((r) => r.shiftId === fix.shiftId)!
    expect(openShift.status).toBe('OPEN')
    expect(openShift.countedCash).toBeNull()
    expect(openShift.variance).toBeNull()

    // Verify FORCE_CLOSED shift has status: 'FORCE_CLOSED'
    const forceShift = rpt.rows.find((r) => r.shiftId === forceShiftId)!
    expect(forceShift.status).toBe('FORCE_CLOSED')
    expect(forceShift.variance).toBe(0)
  })
})
