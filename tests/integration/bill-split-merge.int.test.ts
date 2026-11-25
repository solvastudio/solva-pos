import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { formatInvoiceNo, parseQty, toMoney } from '~/lib/kernel'
import { saveRecipe } from '~/modules/catalog/public'
import { createTable } from '~/modules/fnb/public'
import type { BillEventEnvelopeV1 } from '~/modules/fnb/shared'
import { applyMovements, enableOutletTracking } from '~/modules/inventory/public'
import { processPush } from '~/modules/sync/public'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant, withTenantReadOnly } from '~/server/db'
import { newTestId, setupFnbTenant } from './helpers/fnb'
import { masterTx } from './helpers/master'

const META = (requestRef: string) => ({
  schemaVersion: 1,
  appVersion: 'v1.6.0',
  syncProtocol: 1,
  requestRef,
})

function billPush(
  cmdId: string,
  deviceSeq: number,
  billId: string,
  events: BillEventEnvelopeV1[],
  dependsOn: string[] = [],
) {
  return {
    sent_at_device: events[0]!.created_at_device,
    clock_offset_ms: 0,
    commands: [
      {
        id: cmdId,
        type: 'AppendBillEvents' as const,
        schema_version: 1,
        device_seq: deviceSeq,
        depends_on: dependsOn,
        created_at_device: events[0]!.created_at_device,
        app_version: 'v1.6.0',
        payload: {
          bill_id: billId,
          events,
        },
      },
    ],
  }
}

describe('integration: fnb BILL_SPLIT, BILL_MERGED, STOCK_BASIS, and parent closure', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
    resetLimitersForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('executes EQUAL split, finalizes all children with once-per-parent STOCK_BASIS stock deduction, closes parent CLOSED_BY_SPLIT, and skips BILL_GANDA_MEJA for split siblings', async () => {
    const f = await setupFnbTenant('split-eq')

    await enableOutletTracking(f.actor, f.outletA)
    const trackedMenu = await masterTx(f.tenantId, async (c, v) => {
      const pId = (
        await c.query<{ id: string }>(
          `INSERT INTO product (tenant_id, version, category_id, code, name, product_type, base_uom_id, track_stock)
           VALUES ($1, $2, $3, 'NG-TRK', 'Nasi Goreng Tracked', 'MENU_FNB', $4, true) RETURNING id`,
          [f.tenantId, v, f.categoryId, f.pcsUomId],
        )
      ).rows[0]!.id
      const sId = (
        await c.query<{ id: string }>(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default) VALUES ($1, $2, $3, 'NG-TRK-01', true) RETURNING id`,
          [f.tenantId, v, pId],
        )
      ).rows[0]!.id
      await c.query(
        `INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base) VALUES ($1, $2, $3, $4, 1, true)`,
        [f.tenantId, v, sId, f.pcsUomId],
      )
      return { productId: pId, skuId: sId }
    })

    await saveRecipe(f.catalogActor, {
      menuSkuId: trackedMenu.skuId,
      items: [{ ingredientSkuId: f.ingTrackedSkuId, qty: '2' }],
    })
    await withTenant(f.tenantId, (tx) =>
      applyMovements(tx, { tenantId: f.tenantId, processedAt: '2026-11-25T09:00:00.000Z' }, [
        {
          outletId: f.outletA,
          skuId: f.ingTrackedSkuId,
          kind: 'IN',
          qty: parseQty('20'),
          valueIn: toMoney(200000),
          movementType: 'GR_IN',
          sourceType: 'GR_LINE',
          sourceId: newTestId(),
          occurredAt: '2026-11-25T09:00:00.000Z',
          businessDate: '2026-11-25',
          order: 1,
        },
      ]),
    )

    const parentId = newTestId()
    const itemId = newTestId()
    const c1 = newTestId()
    const c2 = newTestId()
    const c3 = newTestId()
    const ts = '2026-11-25T10:00:00.000Z'

    const openAndSplitRes = await processPush(
      f.cashierDev,
      billPush(newTestId(), 10, parentId, [
        {
          id: newTestId(),
          bill_id: parentId,
          bill_seq: 1,
          device_id: f.cashierDev.deviceId,
          register_id: f.cashierDev.registerId,
          device_seq: 10,
          staff_id: f.appUserId,
          event_type: 'BILL_OPENED',
          payload: { table_id: f.tableA1Id, bill_ref: 'A1-0001' },
          created_at_device: ts,
          clock_offset_ms: 0,
          occurred_at: ts,
          business_date: '2026-11-25',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
        {
          id: newTestId(),
          bill_id: parentId,
          bill_seq: 2,
          device_id: f.cashierDev.deviceId,
          register_id: f.cashierDev.registerId,
          device_seq: 11,
          staff_id: f.appUserId,
          event_type: 'ITEM_ADDED',
          payload: {
            item_id: itemId,
            line_no: 1,
            sku_id: trackedMenu.skuId,
            uom_id: f.pcsUomId,
            sku_code: 'NG-TRK-01',
            item_name: 'Nasi Goreng Tracked',
            uom_code: 'pcs',
            qty: '2',
            conversion_factor: '1',
            unit_price: 35000,
            base_unit_price: 35000,
            price_source: 'TENANT_DEFAULT',
            is_open_price: false,
            taxable: true,
            modifiers: [],
          },
          created_at_device: ts,
          clock_offset_ms: 0,
          occurred_at: ts,
          business_date: '2026-11-25',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
        {
          id: newTestId(),
          bill_id: parentId,
          bill_seq: 3,
          device_id: f.cashierDev.deviceId,
          register_id: f.cashierDev.registerId,
          device_seq: 12,
          staff_id: f.appUserId,
          event_type: 'BILL_SPLIT',
          payload: {
            split_mode: 'EQUAL',
            children: [
              { child_bill_id: c1, child_bill_ref: 'A1-0001-1', share_index: 1, share_count: 3, items: [] },
              { child_bill_id: c2, child_bill_ref: 'A1-0001-2', share_index: 2, share_count: 3, items: [] },
              { child_bill_id: c3, child_bill_ref: 'A1-0001-3', share_index: 3, share_count: 3, items: [] },
            ],
          },
          created_at_device: ts,
          clock_offset_ms: 0,
          occurred_at: ts,
          business_date: '2026-11-25',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
      ]),
      META('req-split-eq'),
    )
    expect(openAndSplitRes.results[0]?.outcome).toBe('ACK')

    // Assert NO BILL_GANDA_MEJA raised even though 3 child bills are OPEN on the same table.
    const flagCount = await withTenantReadOnly(f.tenantId, async (tx) => {
      const r = await tx.execute<{ cnt: number }>(
        sql`SELECT count(*)::int AS cnt FROM data_flag WHERE tenant_id = ${f.tenantId}::uuid AND flag_code = 'BILL_GANDA_MEJA'`,
      )
      return Number(r.rows[0]?.cnt ?? 0)
    })
    expect(flagCount).toBe(0)

    const shareTotals = [23334, 23333, 23333]
    const rounding = [-34, -33, -33]
    const childrenIds = [c1, c2, c3]

    for (let i = 0; i < 3; i += 1) {
      const childId = childrenIds[i]!
      const net = shareTotals[i]!
      const rnd = rounding[i]!
      const due = net + rnd
      const isLast = i === 2
      const lines: Record<string, unknown>[] = [
        {
          id: newTestId(),
          line_no: 1,
          line_kind: 'SHARE',
          product_id: null,
          sku_id: null,
          uom_id: null,
          sku_code: 'SHARE',
          item_name: `Bagian ${i + 1}/3 (A1-0001)`,
          uom_code: 'share',
          qty: '1',
          conversion_factor: '1',
          qty_base: '1',
          unit_price: net,
          price_source: 'TENANT_DEFAULT',
          is_open_price: false,
          taxable: true,
          discount_type: null,
          discount_pct: null,
          discount_input: null,
          discount_approved_by: null,
          line_gross: net,
          line_discount: 0,
          line_net: net,
          bill_discount_alloc: 0,
          service_alloc: 0,
          tax_alloc: 0,
          note: null,
          source_bill_item_id: null,
          modifiers: [],
        },
      ]
      if (isLast) {
        lines.push({
          id: newTestId(),
          line_no: 2,
          line_kind: 'STOCK_BASIS',
          product_id: trackedMenu.productId,
          sku_id: trackedMenu.skuId,
          uom_id: f.pcsUomId,
          sku_code: 'NG-TRK-01',
          item_name: 'Nasi Goreng Tracked',
          uom_code: 'pcs',
          qty: '2',
          conversion_factor: '1',
          qty_base: '2',
          unit_price: 0,
          price_source: 'TENANT_DEFAULT',
          is_open_price: false,
          taxable: true,
          discount_type: null,
          discount_pct: null,
          discount_input: null,
          discount_approved_by: null,
          line_gross: 0,
          line_discount: 0,
          line_net: 0,
          bill_discount_alloc: 0,
          service_alloc: 0,
          tax_alloc: 0,
          note: null,
          source_bill_item_id: itemId,
          modifiers: [],
        })
      }

      const seq = i + 1
      const payRes = await processPush(
        f.cashierDev,
        {
          sent_at_device: ts,
          clock_offset_ms: 0,
          commands: [
            {
              id: newTestId(),
              type: 'FinalizeSale',
              schema_version: 1,
              device_seq: 20 + i,
              depends_on: [],
              created_at_device: ts,
              payload: {
                sale: {
                  id: newTestId(),
                  shift_id: f.cashierShiftId,
                  created_by: f.appUserId,
                  created_at_device: ts,
                  clock_offset_ms: 0,
                  occurred_at: ts,
                  business_date: '2026-11-25',
                  invoice_no: formatInvoiceNo({ prefix: 'POS01', kind: 'INVOICE', period: '1126', seq }),
                  invoice_prefix: 'POS01',
                  invoice_period: '1126',
                  invoice_seq: seq,
                  legal_entity_id: f.legalEntityId,
                  legal_entity_npwp: null,
                  legal_entity_is_pkp: false,
                  price_tax_mode: 'EXCLUSIVE',
                  tax_profile: 'NONE',
                  tax_rate: '0.0000',
                  tax_rate_id: null,
                  service_charge_rate: '0.0000',
                  service_charge_taxable: true,
                  cash_rounding_unit: 100,
                  receipt_locale: 'id-ID',
                  currency: 'IDR',
                  gross_total: net,
                  line_discount_total: 0,
                  bill_discount_type: null,
                  bill_discount_pct: null,
                  bill_discount_input: null,
                  bill_discount_total: 0,
                  discount_approved_by: null,
                  net_subtotal: net,
                  service_charge: 0,
                  tax_base: net,
                  tax_amount: 0,
                  dpp: net,
                  grand_total: net,
                  rounding: rnd,
                  customer_name: null,
                  customer_phone: null,
                  catalog_cursor: 1,
                  bill_id: childId,
                  bill_ref: `A1-0001-${seq}`,
                },
                lines,
                payments: [
                  {
                    id: newTestId(),
                    seq: 1,
                    method_id: f.cashMethodId,
                    method_code: 'CASH',
                    method_name: 'Tunai',
                    method_kind: 'CASH',
                    amount_applied: due,
                    cash_tendered: due,
                    change_given: 0,
                    reference: null,
                    is_rounding_settler: true,
                  },
                ],
              },
            },
          ],
        },
        META(`req-pay-share-${seq}`),
      )
      expect(payRes.results[0]?.outcome).toBe('ACK')
    }

    // Verify parent bill is now CLOSED_BY_SPLIT and stock was deducted ONCE (2 * 2 = 4 qty -> 20 - 4 = 16).
    const after = await withTenantReadOnly(f.tenantId, async (tx) => {
      const p = await tx.execute<{ status: string }>(
        sql`SELECT status FROM bill WHERE tenant_id = ${f.tenantId}::uuid AND id = ${parentId}::uuid`,
      )
      const st = await tx.execute<{ qty: string }>(
        sql`SELECT qty::text FROM stock_balance WHERE tenant_id = ${f.tenantId}::uuid AND outlet_id = ${f.outletA}::uuid AND sku_id = ${f.ingTrackedSkuId}::uuid`,
      )
      return {
        parentStatus: p.rows[0]?.status,
        qtyOnHand: Number(st.rows[0]?.qty ?? -1),
      }
    })
    expect(after.parentStatus).toBe('CLOSED_BY_SPLIT')
    expect(after.qtyOnHand).toBe(16)
  })

  it('executes ITEM split and BILL_MERGED consolidating identical items cleanly', async () => {
    const f = await setupFnbTenant('merge-it')
    const table2 = await createTable(f.fnbActor, {
      outletId: f.outletA,
      area: 'Main',
      code: 'A2',
      capacity: 4,
    })

    const b1 = newTestId()
    const b2 = newTestId()
    const b1Item = newTestId()
    const b2ItemSame = newTestId()
    const b2ItemDiff = newTestId()
    const mergedNewDiffId = newTestId()
    const ts = '2026-11-25T11:00:00.000Z'

    const open1 = await processPush(
      f.cashierDev,
      billPush(newTestId(), 30, b1, [
        {
          id: newTestId(),
          bill_id: b1,
          bill_seq: 1,
          device_id: f.cashierDev.deviceId,
          register_id: f.cashierDev.registerId,
          device_seq: 30,
          staff_id: f.appUserId,
          event_type: 'BILL_OPENED',
          payload: { table_id: f.tableA1Id, bill_ref: 'A1-0002' },
          created_at_device: ts,
          clock_offset_ms: 0,
          occurred_at: ts,
          business_date: '2026-11-25',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
        {
          id: newTestId(),
          bill_id: b1,
          bill_seq: 2,
          device_id: f.cashierDev.deviceId,
          register_id: f.cashierDev.registerId,
          device_seq: 31,
          staff_id: f.appUserId,
          event_type: 'ITEM_ADDED',
          payload: {
            item_id: b1Item,
            line_no: 1,
            sku_id: f.menuSkuId,
            uom_id: f.pcsUomId,
            sku_code: 'MENU-1',
            item_name: 'Nasi Goreng',
            uom_code: 'pcs',
            qty: '2',
            conversion_factor: '1',
            unit_price: 35000,
            price_source: 'TENANT_DEFAULT',
            is_open_price: false,
            taxable: true,
            modifiers: [],
          },
          created_at_device: ts,
          clock_offset_ms: 0,
          occurred_at: ts,
          business_date: '2026-11-25',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
      ]),
      META('req-m-open1'),
    )
    expect(open1.results[0]?.outcome).toBe('ACK')

    const open2 = await processPush(
      f.cashierDev,
      billPush(newTestId(), 32, b2, [
        {
          id: newTestId(),
          bill_id: b2,
          bill_seq: 1,
          device_id: f.cashierDev.deviceId,
          register_id: f.cashierDev.registerId,
          device_seq: 32,
          staff_id: f.appUserId,
          event_type: 'BILL_OPENED',
          payload: { table_id: table2.id, bill_ref: 'A2-0001' },
          created_at_device: ts,
          clock_offset_ms: 0,
          occurred_at: ts,
          business_date: '2026-11-25',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
        {
          id: newTestId(),
          bill_id: b2,
          bill_seq: 2,
          device_id: f.cashierDev.deviceId,
          register_id: f.cashierDev.registerId,
          device_seq: 33,
          staff_id: f.appUserId,
          event_type: 'ITEM_ADDED',
          payload: {
            item_id: b2ItemSame,
            line_no: 1,
            sku_id: f.menuSkuId,
            uom_id: f.pcsUomId,
            sku_code: 'MENU-1',
            item_name: 'Nasi Goreng',
            uom_code: 'pcs',
            qty: '1',
            conversion_factor: '1',
            unit_price: 35000,
            price_source: 'TENANT_DEFAULT',
            is_open_price: false,
            taxable: true,
            modifiers: [],
          },
          created_at_device: ts,
          clock_offset_ms: 0,
          occurred_at: ts,
          business_date: '2026-11-25',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
        {
          id: newTestId(),
          bill_id: b2,
          bill_seq: 3,
          device_id: f.cashierDev.deviceId,
          register_id: f.cashierDev.registerId,
          device_seq: 34,
          staff_id: f.appUserId,
          event_type: 'ITEM_ADDED',
          payload: {
            item_id: b2ItemDiff,
            line_no: 2,
            sku_id: f.menu2SkuId,
            uom_id: f.pcsUomId,
            sku_code: 'MENU-2',
            item_name: 'Es Teh',
            uom_code: 'pcs',
            qty: '2',
            conversion_factor: '1',
            unit_price: 8000,
            price_source: 'TENANT_DEFAULT',
            is_open_price: false,
            taxable: true,
            modifiers: [],
          },
          created_at_device: ts,
          clock_offset_ms: 0,
          occurred_at: ts,
          business_date: '2026-11-25',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
      ]),
      META('req-m-open2'),
    )
    expect(open2.results[0]?.outcome).toBe('ACK')

    // Merge b2 into b1
    const mergeRes = await processPush(
      f.cashierDev,
      billPush(newTestId(), 35, b1, [
        {
          id: newTestId(),
          bill_id: b1,
          bill_seq: 3,
          device_id: f.cashierDev.deviceId,
          register_id: f.cashierDev.registerId,
          device_seq: 35,
          staff_id: f.appUserId,
          event_type: 'BILL_MERGED',
          payload: {
            source_bill_ids: [b2],
            source_device_seqs: { [b2]: 36 },
            moved_item_targets: {
              [b2ItemDiff]: mergedNewDiffId,
            },
          },
          created_at_device: ts,
          clock_offset_ms: 0,
          occurred_at: ts,
          business_date: '2026-11-25',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
      ]),
      META('req-m-exec'),
    )
    expect(mergeRes.results[0]?.outcome).toBe('ACK')

    // Test ITEM split on merged b1 -> cA gets item 1, cB gets item 2
    const cA = newTestId()
    const cB = newTestId()
    const cAItem = newTestId()
    const cBItem = newTestId()
    const splitItemRes = await processPush(
      f.cashierDev,
      billPush(newTestId(), 37, b1, [
        {
          id: newTestId(),
          bill_id: b1,
          bill_seq: 4,
          device_id: f.cashierDev.deviceId,
          register_id: f.cashierDev.registerId,
          device_seq: 37,
          staff_id: f.appUserId,
          event_type: 'BILL_SPLIT',
          payload: {
            split_mode: 'ITEM',
            children: [
              {
                child_bill_id: cA,
                child_device_seq: 38,
                child_bill_ref: 'A1-0002-1',
                items: [{ item_id: cAItem, source_bill_item_id: b1Item, line_no: 1, qty: '3' }],
              },
              {
                child_bill_id: cB,
                child_device_seq: 39,
                child_bill_ref: 'A1-0002-2',
                items: [{ item_id: cBItem, source_bill_item_id: mergedNewDiffId, line_no: 1, qty: '2' }],
              },
            ],
          },
          created_at_device: ts,
          clock_offset_ms: 0,
          occurred_at: ts,
          business_date: '2026-11-25',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
      ]),
      META('req-split-it'),
    )
    expect(splitItemRes.results[0]?.outcome).toBe('ACK')

    const verified = await withTenantReadOnly(f.tenantId, async (tx) => {
      const b2Row = await tx.execute<{ status: string; merged_into_bill_id: string | null }>(
        sql`SELECT status, merged_into_bill_id FROM bill WHERE tenant_id = ${f.tenantId}::uuid AND id = ${b2}::uuid`,
      )
      const b1Row = await tx.execute<{ status: string }>(
        sql`SELECT status FROM bill WHERE tenant_id = ${f.tenantId}::uuid AND id = ${b1}::uuid`,
      )
      const b1Items = await tx.execute<{ id: string; sku_code: string; qty: string; status: string }>(
        sql`SELECT id, sku_code, qty::text, status FROM bill_item WHERE tenant_id = ${f.tenantId}::uuid AND bill_id = ${b1}::uuid ORDER BY line_no`,
      )
      const cAItems = await tx.execute<{ qty: string }>(
        sql`SELECT qty::text FROM bill_item WHERE tenant_id = ${f.tenantId}::uuid AND bill_id = ${cA}::uuid`,
      )
      return {
        b2Status: b2Row.rows[0]?.status,
        b2MergedInto: b2Row.rows[0]?.merged_into_bill_id,
        b1Status: b1Row.rows[0]?.status,
        b1Items: b1Items.rows,
        cAQty: Number(cAItems.rows[0]?.qty ?? 0),
      }
    })

    expect(verified.b2Status).toBe('MERGED')
    expect(verified.b2MergedInto).toBe(b1)
    expect(verified.b1Status).toBe('SPLIT')
    expect(verified.b1Items).toHaveLength(2)
    expect(Number(verified.b1Items[0]?.qty)).toBe(3)
    expect(verified.b1Items[0]?.status).toBe('MOVED')
    expect(verified.b1Items[1]?.id).toBe(mergedNewDiffId)
    expect(verified.cAQty).toBe(3)
  })
})
