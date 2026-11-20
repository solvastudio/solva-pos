import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
} from '~/modules/identity/public'
import {
  __resetReportSlotsForTests,
  getOpsReport,
  type ReportActorContext,
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

describe('R-04 Operations Report (F3 sections, phone masking BR-CUS-002, tenant isolation)', () => {
  it('populates all 8 F3 sections, masks customer_phone without customer.view_phone, and isolates tenants', async () => {
    const fix = await seedV25SalesReportFixture()
    const fixOther = await seedV25SalesReportFixture()

    const lineStaleId = newTestUuid()
    const lineNonaktifId = newTestUuid()
    const lineUnavailableId = newTestUuid()
    const lineOpenPriceId = newTestUuid()

    await withTenant(fix.tenantId, async (tx) => {
      // Insert 4 sale_line rows under sale123Id (which has customer_phone = '08123456789')
      await tx.execute(sql`
        INSERT INTO sale_line (
          id, tenant_id, sale_id, outlet_id, business_date, line_no, line_kind,
          product_id, sku_id, uom_id,
          sku_code, item_name, uom_code, qty, conversion_factor, qty_base,
          unit_price, price_source, is_open_price, taxable,
          line_gross, line_discount, line_net, bill_discount_alloc, service_alloc, tax_alloc
        ) VALUES
          (
            ${lineStaleId}::uuid, ${fix.tenantId}::uuid, ${fix.sale123Id}::uuid, ${fix.out1.id}::uuid, '2026-11-17', 1, 'ITEM',
            ${fix.catalogRefs.prodId}::uuid, ${fix.catalogRefs.skuId}::uuid, ${fix.catalogRefs.uomId}::uuid,
            'SKU-STALE', 'Kopi Susu Stale', 'PCS', 1, 1, 1,
            25000, 'OUTLET', false, true,
            25000, 0, 25000, 0, 0, 2750
          ),
          (
            ${lineNonaktifId}::uuid, ${fix.tenantId}::uuid, ${fix.sale123Id}::uuid, ${fix.out1.id}::uuid, '2026-11-17', 2, 'ITEM',
            ${fix.catalogRefs.prodId}::uuid, ${fix.catalogRefs.skuId}::uuid, ${fix.catalogRefs.uomId}::uuid,
            'SKU-INACT', 'Kopi Nonaktif', 'PCS', 1, 1, 1,
            30000, 'OUTLET', false, true,
            30000, 0, 30000, 0, 0, 3300
          ),
          (
            ${lineUnavailableId}::uuid, ${fix.tenantId}::uuid, ${fix.sale123Id}::uuid, ${fix.out1.id}::uuid, '2026-11-17', 3, 'ITEM',
            ${fix.catalogRefs.prodId}::uuid, ${fix.catalogRefs.skuId}::uuid, ${fix.catalogRefs.uomId}::uuid,
            'SKU-UNAVAIL', 'Kaos Habis', 'PCS', 2, 1, 2,
            75000, 'OUTLET', false, true,
            150000, 0, 150000, 0, 0, 16500
          ),
          (
            ${lineOpenPriceId}::uuid, ${fix.tenantId}::uuid, ${fix.sale123Id}::uuid, ${fix.out1.id}::uuid, '2026-11-17', 4, 'ITEM',
            ${fix.catalogRefs.prodId}::uuid, ${fix.catalogRefs.skuId}::uuid, ${fix.catalogRefs.uomId}::uuid,
            'SKU-OPEN', 'Jasa Bungkus Kado', 'PCS', 1, 1, 1,
            15000, 'OPEN_PRICE', true, true,
            15000, 0, 15000, 0, 0, 1650
          )
      `)

      // Insert data_flag rows for HARGA_STALE, ITEM_NONAKTIF, TARIF_BERBEDA, SELISIH_HITUNG, NOMOR_KONFLIK, ITEM_TIDAK_TERSEDIA
      await tx.execute(sql`
        INSERT INTO data_flag (
          id, tenant_id, outlet_id, business_date, flag_code, severity,
          entity_type, entity_id, parent_id, diff_amount, detail, status
        ) VALUES
          (
            ${newTestUuid()}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, '2026-11-17',
            'HARGA_STALE', 'WARN', 'SALE_LINE', ${lineStaleId}::uuid, ${fix.sale123Id}::uuid, -3000,
            '{"expected_price": 28000, "applied_price": 25000}'::jsonb, 'OPEN'
          ),
          (
            ${newTestUuid()}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, '2026-11-17',
            'ITEM_NONAKTIF', 'WARN', 'SALE_LINE', ${lineNonaktifId}::uuid, ${fix.sale123Id}::uuid, null,
            '{}'::jsonb, 'OPEN'
          ),
          (
            ${newTestUuid()}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, '2026-11-17',
            'TARIF_BERBEDA', 'WARN', 'SALE', ${fix.sale123Id}::uuid, null, 500,
            '{"client_rate": "10.0000", "server_rate": "11.0000"}'::jsonb, 'OPEN'
          ),
          (
            ${newTestUuid()}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, '2026-11-17',
            'SELISIH_HITUNG', 'WARN', 'SALE', ${fix.sale123Id}::uuid, null, 200,
            '{"client_total": 112300, "server_total": 112500}'::jsonb, 'OPEN'
          ),
          (
            ${newTestUuid()}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, '2026-11-17',
            'NOMOR_KONFLIK', 'WARN', 'SALE', ${fix.sale123Id}::uuid, null, null,
            '{"original_invoice_no": "OUT01-POS01-1126-000120"}'::jsonb, 'OPEN'
          ),
          (
            ${newTestUuid()}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, '2026-11-17',
            'ITEM_TIDAK_TERSEDIA', 'WARN', 'SALE_LINE', ${lineUnavailableId}::uuid, ${fix.sale123Id}::uuid, null,
            '{}'::jsonb, 'OPEN'
          )
      `)

      // Insert invoice_gap row
      await tx.execute(sql`
        INSERT INTO invoice_gap (
          id, tenant_id, outlet_id, register_id, doc_type, period,
          seq_from, seq_to, origin, status
        ) VALUES (
          ${newTestUuid()}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, ${fix.reg1.id}::uuid,
          'INVOICE', '1126', 100, 102, 'DETECTED', 'OPEN'
        )
      `)

      // Insert attention_item row
      const attCmdId = await insertStubCommand(tx, {
        tenantId: fix.tenantId,
        outletId: fix.out1.id,
        registerId: fix.reg1.id,
        deviceId: fix.dev1.deviceId,
        commandType: 'FinalizeSale',
      })
      await tx.execute(sql`
        INSERT INTO attention_item (
          id, tenant_id, outlet_id, register_id, device_id, command_id,
          command_type, reason_class, reason_code, payload, status
        ) VALUES (
          ${newTestUuid()}::uuid, ${fix.tenantId}::uuid, ${fix.out1.id}::uuid, ${fix.reg1.id}::uuid, ${fix.dev1.deviceId}::uuid, ${attCmdId}::uuid,
          'FinalizeSale', 'AUTHORIZATION', 'DISCOUNT_LIMIT_EXCEEDED',
          '{"sale": {"invoice_no": "OUT01-POS01-1126-000199", "total_due": 95000}}'::jsonb,
          'OPEN'
        )
      `)
    })

    // 1. Actor WITHOUT customer.view_phone sees masked phone 0812****789
    const rptMasked = await getOpsReport(fix.managerOut1Actor, {
      outletIds: [fix.out1.id],
      from: '2026-11-17',
      to: '2026-11-17',
      groupBy: 'DAY',
    })

    expect(rptMasked.sections.staleHarga).toHaveLength(1)
    expect(rptMasked.sections.staleHarga[0]?.diffAmount).toBe(-3_000)
    expect(rptMasked.sections.staleHarga[0]?.customerPhone).toBe('0812****789')

    expect(rptMasked.sections.itemNonaktifTarifBeda).toHaveLength(2)
    expect(rptMasked.sections.selisihHitung).toHaveLength(1)
    expect(rptMasked.sections.selisihHitung[0]?.clientTotal).toBe(112_300)
    expect(rptMasked.sections.selisihHitung[0]?.serverTotal).toBe(112_500)

    expect(rptMasked.sections.nomorKonflik).toHaveLength(1)
    expect(rptMasked.sections.nomorKonflik[0]?.originalNo).toBe('OUT01-POS01-1126-000120')

    expect(rptMasked.sections.gapInvoice).toHaveLength(1)
    expect(rptMasked.sections.gapInvoice[0]?.seqFrom).toBe(100)
    expect(rptMasked.sections.gapInvoice[0]?.seqTo).toBe(102)

    expect(rptMasked.sections.attention).toHaveLength(1)
    expect(rptMasked.sections.attention[0]?.invoiceNo).toBe('OUT01-POS01-1126-000199')
    expect(rptMasked.sections.attention[0]?.totalDue).toBe(95_000)

    expect(rptMasked.sections.itemTidakTersedia).toHaveLength(1)
    expect(rptMasked.sections.itemTidakTersedia[0]?.qty).toBe('2.0000')
    expect(rptMasked.sections.itemTidakTersedia[0]?.lineGross).toBe(150_000)

    expect(rptMasked.sections.openPrice).toHaveLength(1)
    expect(rptMasked.sections.openPrice[0]?.unitPrice).toBe(15_000)
    expect(rptMasked.sections.openPrice[0]?.cashierName).toBe('Dewi Kasir')

    // 2. Owner WITH customer.view_phone sees unmasked phone 08123456789
    const rptUnmasked = await getOpsReport(fix.ownerActor, {
      outletIds: [fix.out1.id],
      from: '2026-11-17',
      to: '2026-11-17',
      groupBy: 'DAY',
    })
    expect(rptUnmasked.sections.staleHarga[0]?.customerPhone).toBe('08123456789')

    // 3. Tenant isolation: other tenant sees 0 rows in all 8 sections
    const rptOther = await getOpsReport(fixOther.ownerActor, {
      outletIds: [fixOther.out1.id],
      from: '2026-11-17',
      to: '2026-11-17',
      groupBy: 'DAY',
    })
    expect(rptOther.sections.staleHarga).toHaveLength(0)
    expect(rptOther.sections.gapInvoice).toHaveLength(0)
    expect(rptOther.sections.attention).toHaveLength(0)
    expect(rptOther.sections.itemTidakTersedia).toHaveLength(0)
    expect(rptOther.sections.openPrice).toHaveLength(0)

    // 4. Actor without report.view permission is rejected
    const noReportPermActor: ReportActorContext = fix.cashierActorNoReport
    await expect(
      getOpsReport(noReportPermActor, {
        outletIds: [fix.out1.id],
        from: '2026-11-17',
        to: '2026-11-17',
        groupBy: 'DAY',
      }),
    ).rejects.toThrow(/FORBIDDEN|report\.view/i)
  })
})
