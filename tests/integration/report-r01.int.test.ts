import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
} from '~/modules/identity/public'
import {
  __resetReportSlotsForTests,
  getDashboard,
  getSalesReport,
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

describe('R-01 Sales Report & Dashboard KPIs (V-25, BR-RPT-001)', () => {
  it('reproduces PRD §12 R-01 example (V-25) figures to the exact rupiah', async () => {
    const fix = await seedV25SalesReportFixture()

    const rpt = await getSalesReport(fix.ownerActor, {
      outletIds: [fix.out1.id],
      from: '2026-11-17',
      to: '2026-11-17',
      groupBy: 'DAY',
    })

    expect(rpt.rows).toHaveLength(1)
    const row = rpt.rows[0]!
    expect(row.periodKey).toBe('2026-11-17')
    expect(row.outletCode).toBe('OUT01')
    expect(row.transactionCount).toBe(3)
    expect(row.voidCount).toBe(1)
    expect(row.gross).toBe(176_700)
    expect(row.discount).toBe(7_370)
    expect(row.netSubtotal).toBe(169_330)
    expect(row.serviceCharge).toBe(0)
    expect(row.tax).toBe(18_626)
    expect(row.rounding).toBe(44)
    expect(row.totalReceived).toBe(188_000)
    expect(row.returns).toBe(17_900)
    expect(row.netSales).toBe(170_100)
    expect(row.netBeforeTax).toBe(153_220)
    expect(row.netTax).toBe(16_854)
    expect(row.netRounding).toBe(26)

    // Payment method breakdown excludes VOID and does not subtract credit note refunds
    const cashPm = rpt.byPaymentMethod.find((m) => m.methodCode === 'CASH')
    const qrisPm = rpt.byPaymentMethod.find((m) => m.methodCode === 'QRIS')
    expect(cashPm?.amountApplied).toBe(132_500)
    expect(qrisPm?.amountApplied).toBe(55_500)

    // Totals footer matches row and computes roundHalfUp(188000 / 3) = 62667
    expect(rpt.totals.netSales).toBe(170_100)
    expect(rpt.totals.averageTransaction).toBe(62_667)

    // Dashboard KPIs match R-01 totals
    const dash = await getDashboard(fix.ownerActor, {
      outletIds: [fix.out1.id],
      from: '2026-11-17',
      to: '2026-11-17',
      groupBy: 'DAY',
    })
    expect(dash.kpis.netSales).toBe(170_100)
    expect(dash.kpis.totalReceived).toBe(188_000)
    expect(dash.kpis.transactionCount).toBe(3)
    expect(dash.kpis.voidCount).toBe(1)
    expect(dash.kpis.averageTransaction).toBe(62_667)
    expect(dash.kpis.returns).toBe(17_900)
    expect(dash.dailySeries).toHaveLength(1)
    expect(dash.dailySeries[0]?.netSales).toBe(170_100)
  })

  it('counts credit notes on their own business_date, supports WEEK/MONTH grouping, cashier filter, and enforces tenant isolation & >366 day limit', async () => {
    const fixA = await seedV25SalesReportFixture()
    const fixB = await seedV25SalesReportFixture()

    // Insert a second credit note on 2026-11-18 in tenant A (different business_date from original sale 2026-11-17)
    const cnDay2Id = newTestUuid()
    await withTenant(fixA.tenantId, async (tx) => {
      const cnDay2CmdId = await insertStubCommand(tx, {
        tenantId: fixA.tenantId,
        outletId: fixA.out1.id,
        registerId: fixA.reg1.id,
        deviceId: fixA.dev1.deviceId,
        commandType: 'FinalizeCreditNote',
      })
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
          ${cnDay2Id}::uuid, ${fixA.tenantId}::uuid, ${fixA.out1.id}::uuid, ${fixA.reg1.id}::uuid, ${fixA.dev1.deviceId}::uuid, ${fixA.cashierId}::uuid,
          '2026-11-18T10:00:00.000Z', 0, '2026-11-18T10:00:00.000Z', '2026-11-18',
          ${cnDay2CmdId}::uuid, 1, 'v1.0.0',
          'OUT01-POS01-NK-1126-000002', 'OUT01-POS01', '1126', 2, 0,
          ${fixA.sale124Id}::uuid, 'OUT01-POS01-1126-000124', ${fixA.shiftId}::uuid, 'POSTED',
          'RUSAK', 'Retur hari berikutnya', ${fixA.ownerId}::uuid,
          'EXCLUSIVE', 100, 'id-ID',
          10000, 0, 1100, 11100, 0
        )
      `)
    })

    const byDay = await getSalesReport(fixA.ownerActor, {
      outletIds: [fixA.out1.id],
      from: '2026-11-17',
      to: '2026-11-18',
      groupBy: 'DAY',
    })
    expect(byDay.rows).toHaveLength(2)
    expect(byDay.rows[0]?.periodKey).toBe('2026-11-17')
    expect(byDay.rows[0]?.returns).toBe(17_900)
    expect(byDay.rows[1]?.periodKey).toBe('2026-11-18')
    expect(byDay.rows[1]?.transactionCount).toBe(0)
    expect(byDay.rows[1]?.returns).toBe(11_100)
    expect(byDay.rows[1]?.netSales).toBe(-11_100)

    // WEEK and MONTH group totals match DAY totals
    const byWeek = await getSalesReport(fixA.ownerActor, {
      outletIds: [fixA.out1.id],
      from: '2026-11-17',
      to: '2026-11-18',
      groupBy: 'WEEK',
    })
    expect(byWeek.totals.netSales).toBe(byDay.totals.netSales)
    expect(byWeek.totals.returns).toBe(29_000)

    const byMonth = await getSalesReport(fixA.ownerActor, {
      outletIds: [fixA.out1.id],
      from: '2026-11-01',
      to: '2026-11-30',
      groupBy: 'MONTH',
    })
    expect(byMonth.totals.netSales).toBe(byDay.totals.netSales)

    // Cashier filter (cashier2Id only sold Invoice 000125 = Rp 20,000)
    const cashier2Rpt = await getSalesReport(fixA.ownerActor, {
      outletIds: [fixA.out1.id],
      from: '2026-11-17',
      to: '2026-11-17',
      groupBy: 'DAY',
      cashierId: fixA.cashier2Id,
    })
    expect(cashier2Rpt.totals.transactionCount).toBe(1)
    expect(cashier2Rpt.totals.totalReceived).toBe(20_000)

    // Tenant isolation: tenant B report does not see tenant A's 2026-11-18 credit note
    const rptB = await getSalesReport(fixB.ownerActor, {
      outletIds: [fixB.out1.id],
      from: '2026-11-18',
      to: '2026-11-18',
      groupBy: 'DAY',
    })
    expect(rptB.rows).toHaveLength(0)

    // Out-of-scope manager rejected with FORBIDDEN
    await expect(
      getSalesReport(fixA.managerOut2Actor, {
        outletIds: [fixA.out1.id],
        from: '2026-11-17',
        to: '2026-11-17',
        groupBy: 'DAY',
      }),
    ).rejects.toThrow(/scope|FORBIDDEN/i)

    // Range > 366 days rejected with VALIDATION_FAILED
    await expect(
      getSalesReport(fixA.ownerActor, {
        outletIds: [fixA.out1.id],
        from: '2025-01-01',
        to: '2026-06-01',
        groupBy: 'DAY',
      }),
    ).rejects.toThrow(/366/)
  })
})
