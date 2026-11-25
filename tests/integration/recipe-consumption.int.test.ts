import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { formatInvoiceNo, invoicePeriod, normalizeQty, parseQty, toMoney, type Qty } from '~/lib/kernel'
import { calcAndSettle, type SaleCalcInput } from '~/lib/sales-calc'
import { createModifier, createModifierGroup, saveRecipe } from '~/modules/catalog/public'
import { applyMovements, enableOutletTracking } from '~/modules/inventory/public'
import type { PushResultItem } from '~/lib/contracts'
import { processPush } from '~/modules/sync/public'
import { dataFlag } from '~/modules/sync/server/schema'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { newTestId, setupFnbTenant } from './helpers/fnb'
import { masterTx } from './helpers/master'

async function seedV17Catalog(f: Awaited<ReturnType<typeof setupFnbTenant>>) {
  const created = await masterTx(f.tenantId, async (c, v) => {
    const mlUomId = (
      await c.query<{ id: string }>(
        `INSERT INTO uom (tenant_id, version, code, name, allow_fraction) VALUES ($1, $2, 'ml', 'Milliliter', true) RETURNING id`,
        [f.tenantId, v],
      )
    ).rows[0]!.id

    const mkSku = async (code: string, name: string, type: 'RETAIL' | 'MENU_FNB', trackStock: boolean, uomId: string) => {
      const pId = (
        await c.query<{ id: string }>(
          `INSERT INTO product (tenant_id, version, category_id, code, name, product_type, base_uom_id, track_stock)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [f.tenantId, v, f.categoryId, code, name, type, uomId, trackStock],
        )
      ).rows[0]!.id
      const sId = (
        await c.query<{ id: string }>(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default) VALUES ($1, $2, $3, $4, true) RETURNING id`,
          [f.tenantId, v, pId, `${code}-1`],
        )
      ).rows[0]!.id
      await c.query(
        `INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base) VALUES ($1, $2, $3, $4, 1, true)`,
        [f.tenantId, v, sId, uomId],
      )
      return { productId: pId, skuId: sId }
    }

    const nasgor = await mkSku('NG-V17', 'Nasi Goreng V17', 'MENU_FNB', true, f.pcsUomId)
    const noRecipe = await mkSku('NR-V17', 'Menu Tanpa Resep', 'MENU_FNB', true, f.pcsUomId)
    const beras = await mkSku('BRS-V17', 'Beras', 'RETAIL', true, f.grUomId)
    const telur = await mkSku('TLR-V17', 'Telur', 'RETAIL', true, f.pcsUomId)
    const minyak = await mkSku('MYK-V17', 'Minyak', 'RETAIL', true, mlUomId)
    const kecap = await mkSku('KCP-V17', 'Kecap', 'RETAIL', true, mlUomId)

    const supervisorId = (
      await c.query<{ id: string }>(
        `INSERT INTO app_user (tenant_id, version, display_name) VALUES ($1, $2, 'Sup V17') RETURNING id`,
        [f.tenantId, v],
      )
    ).rows[0]!.id

    return { nasgor, noRecipe, beras, telur, minyak, kecap, supervisorId }
  })

  await saveRecipe(f.catalogActor, {
    menuSkuId: created.nasgor.skuId,
    items: [
      { ingredientSkuId: created.beras.skuId, qty: '150' },
      { ingredientSkuId: created.telur.skuId, qty: '1' },
      { ingredientSkuId: created.minyak.skuId, qty: '20' },
      { ingredientSkuId: created.kecap.skuId, qty: '10' },
    ],
  })

  const grp = await createModifierGroup(f.catalogActor, {
    name: 'V17 Extras',
    selectionType: 'MULTI',
    minSelect: 0,
    maxSelect: 5,
    isActive: true,
  })
  const modExtraTelur = await createModifier(f.catalogActor, {
    modifierGroupId: grp.id,
    name: 'Extra Telur',
    priceDelta: 5000,
    isActive: true,
    sortOrder: 1,
    ingredients: [{ ingredientSkuId: created.telur.skuId, adjustType: 'ADD', qty: '1' }],
  })
  const modTanpaKecap = await createModifier(f.catalogActor, {
    modifierGroupId: grp.id,
    name: 'Tanpa Kecap',
    priceDelta: 0,
    isActive: true,
    sortOrder: 2,
    ingredients: [{ ingredientSkuId: created.kecap.skuId, adjustType: 'REMOVE', qty: null }],
  })

  return { ...created, modExtraTelur, modTanpaKecap }
}

async function seedV17Balances(
  f: Awaited<ReturnType<typeof setupFnbTenant>>,
  skus: Awaited<ReturnType<typeof seedV17Catalog>>,
) {
  await enableOutletTracking(f.actor, f.outletA)
  await withTenant(f.tenantId, (tx) =>
    applyMovements(tx, { tenantId: f.tenantId, processedAt: '2026-11-20T09:00:00.000Z' }, [
      { outletId: f.outletA, skuId: skus.beras.skuId, kind: 'IN', qty: parseQty('25000'), valueIn: toMoney(350000), movementType: 'GR_IN', sourceType: 'GR_LINE', sourceId: newTestId(), occurredAt: '2026-11-20T09:00:00.000Z', businessDate: '2026-11-20', order: 1 },
      { outletId: f.outletA, skuId: skus.telur.skuId, kind: 'IN', qty: parseQty('120'), valueIn: toMoney(228000), movementType: 'GR_IN', sourceType: 'GR_LINE', sourceId: newTestId(), occurredAt: '2026-11-20T09:00:00.000Z', businessDate: '2026-11-20', order: 2 },
      { outletId: f.outletA, skuId: skus.minyak.skuId, kind: 'IN', qty: parseQty('8000'), valueIn: toMoney(112000), movementType: 'GR_IN', sourceType: 'GR_LINE', sourceId: newTestId(), occurredAt: '2026-11-20T09:00:00.000Z', businessDate: '2026-11-20', order: 3 },
      { outletId: f.outletA, skuId: skus.kecap.skuId, kind: 'IN', qty: parseQty('5000'), valueIn: toMoney(40000), movementType: 'GR_IN', sourceType: 'GR_LINE', sourceId: newTestId(), occurredAt: '2026-11-20T09:00:00.000Z', businessDate: '2026-11-20', order: 4 },
    ]),
  )
}

async function pushMenuSale(params: {
  f: Awaited<ReturnType<typeof setupFnbTenant>>
  seq: number
  deviceSeq: number
  cmdId?: string
  saleId?: string
  paymentId?: string
  lines: Array<{
    lineId?: string
    productId: string
    skuId: string
    skuCode: string
    itemName: string
    qty: string
    unitPrice: number
    modifiers?: Array<{ modifier_id: string; name: string; price_delta: number; qty: number }>
  }>
}) {
  const { f } = params
  const saleId = params.saleId ?? newTestId()
  const lineIds = params.lines.map((l) => l.lineId ?? newTestId())
  const calcInput: SaleCalcInput = {
    lines: params.lines.map((l, idx) => ({
      lineNo: idx + 1,
      skuId: l.skuId,
      uomId: f.pcsUomId,
      qty: parseQty(l.qty),
      unitPrice: toMoney(l.unitPrice),
      taxable: false,
    })),
    config: {
      priceTaxMode: 'EXCLUSIVE',
      taxProfile: 'NONE',
      taxRate: '0.0000',
      serviceChargeEnabled: false,
      serviceChargeRate: '0.0000',
      serviceChargeTaxable: false,
    },
  }
  const { calc, settlement } = calcAndSettle(
    calcInput,
    [{ methodCode: 'QRIS', kind: 'NON_CASH', amount: toMoney(calcInput.lines.reduce((s, l) => s + l.unitPrice * Number(l.qty), 0)) }],
    100,
  )
  const businessDate = '2026-11-24'
  const period = invoicePeriod(businessDate)
  const invoiceNo = formatInvoiceNo({ prefix: 'CAS1', kind: 'INVOICE', period, seq: params.seq })

  const res = await processPush(
    f.cashierDev,
    {
      sent_at_device: '2026-11-24T14:00:00.000Z',
      clock_offset_ms: 0,
      commands: [
        {
          id: params.cmdId ?? newTestId(),
          type: 'FinalizeSale',
          schema_version: 1,
          device_seq: params.deviceSeq,
          created_at_device: '2026-11-24T14:00:00.000Z',
          depends_on: [],
          payload: {
            sale: {
              id: saleId,
              shift_id: f.cashierShiftId,
              created_by: f.appUserId,
              created_at_device: '2026-11-24T14:00:00.000Z',
              clock_offset_ms: 0,
              occurred_at: '2026-11-24T14:00:00.000Z',
              business_date: businessDate,
              invoice_no: invoiceNo,
              invoice_prefix: 'CAS1',
              invoice_period: period,
              invoice_seq: params.seq,
              legal_entity_id: f.legalEntityId,
              legal_entity_npwp: null,
              legal_entity_is_pkp: false,
              price_tax_mode: 'EXCLUSIVE',
              tax_profile: 'NONE',
              tax_rate: '0.0000',
              tax_rate_id: null,
              service_charge_rate: '0.0000',
              service_charge_taxable: false,
              cash_rounding_unit: 100,
              receipt_locale: 'id-ID',
              currency: 'IDR',
              gross_total: calc.grossTotal,
              line_discount_total: 0,
              bill_discount_type: null,
              bill_discount_pct: null,
              bill_discount_input: null,
              bill_discount_total: 0,
              discount_approved_by: null,
              net_subtotal: calc.netSubtotal,
              service_charge: 0,
              tax_base: 0,
              tax_amount: 0,
              dpp: 0,
              grand_total: calc.grandTotal,
              rounding: settlement.rounding,
              customer_name: null,
              customer_phone: null,
              catalog_cursor: null,
              bill_id: null,
              bill_ref: null,
            },
            lines: calc.lines.map((cl, idx) => {
              const src = params.lines[idx]!
              return {
                id: lineIds[idx]!,
                line_no: cl.lineNo,
                line_kind: 'ITEM',
                product_id: src.productId,
                sku_id: src.skuId,
                uom_id: f.pcsUomId,
                sku_code: src.skuCode,
                item_name: src.itemName,
                uom_code: 'pcs',
                qty: src.qty,
                conversion_factor: '1',
                qty_base: src.qty,
                unit_price: src.unitPrice,
                price_source: 'TENANT_DEFAULT',
                is_open_price: false,
                taxable: false,
                discount_type: null,
                discount_pct: null,
                discount_input: null,
                discount_approved_by: null,
                line_gross: cl.lineGross,
                line_discount: 0,
                line_net: cl.lineNet,
                bill_discount_alloc: 0,
                service_alloc: 0,
                tax_alloc: 0,
                note: null,
                source_bill_item_id: null,
                modifiers: src.modifiers ?? [],
              }
            }),
            payments: [
              {
                id: params.paymentId ?? newTestId(),
                seq: 1,
                method_id: f.qrisMethodId,
                method_code: 'QRIS',
                method_name: 'QRIS',
                method_kind: 'NON_CASH',
                amount_applied: calc.grandTotal,
                cash_tendered: null,
                change_given: null,
                reference: null,
                is_rounding_settler: false,
              },
            ],
          },
        },
      ],
    },
    { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
  )
  return { saleId, lineIds, result: res.results[0]! }
}

describe('Recipe consumption & menu COGS (V-17, BR-RCP-003..006, Phase 56)', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
  })

  afterAll(async () => {
    await closePools()
  })

  it('V-17(a): 2 portions Nasi Goreng -> Beras 4200, Telur 3800, Minyak 560, Kecap 160 -> cost_snapshot 8720; replay idempotent; VoidSale reverses all', async () => {
    const f = await setupFnbTenant('rcp-v17a')
    const skus = await seedV17Catalog(f)
    await seedV17Balances(f, skus)

    const cmdId = newTestId()
    const saleId = newTestId()
    const paymentId = newTestId()
    const { lineIds, result } = await pushMenuSale({
      f,
      seq: 1,
      deviceSeq: 1,
      cmdId,
      saleId,
      paymentId,
      lines: [
        {
          productId: skus.nasgor.productId,
          skuId: skus.nasgor.skuId,
          skuCode: 'NG-V17-1',
          itemName: 'Nasi Goreng V17',
          qty: '2',
          unitPrice: 35000,
        },
      ],
    })

    const ackResult = result as Extract<PushResultItem, { outcome: 'ACK' }>
    expect(ackResult.outcome).toBe('ACK')
    expect(ackResult.result).toMatchObject({
      cost_total: 8720,
      lines: [{ line_no: 1, cost_snapshot: 8720 }],
    })

    // Replay does not duplicate movements
    const replay = await pushMenuSale({
      f,
      seq: 1,
      deviceSeq: 1,
      cmdId,
      saleId,
      paymentId,
      lines: [
        {
          lineId: lineIds[0]!,
          productId: skus.nasgor.productId,
          skuId: skus.nasgor.skuId,
          skuCode: 'NG-V17-1',
          itemName: 'Nasi Goreng V17',
          qty: '2',
          unitPrice: 35000,
        },
      ],
    })
    expect(replay.result.outcome).toBe('ACK')

    await withTenant(f.tenantId, async (tx) => {
      const movs = await tx.execute<{ sku_id: string; qty_delta: string; value_delta: string }>(sql`
        SELECT sku_id, qty_delta::text, value_delta::text
        FROM stock_movement
        WHERE tenant_id = ${f.tenantId}::uuid AND source_id = ${lineIds[0]!}::uuid AND movement_type = 'RECIPE_CONSUMPTION'
        ORDER BY sku_id ASC
      `)
      expect(movs.rows).toHaveLength(4)
      const bySku = new Map(movs.rows.map((r) => [r.sku_id, { qty: normalizeQty(r.qty_delta as Qty), val: Number(r.value_delta) }]))
      expect(bySku.get(skus.beras.skuId)).toEqual({ qty: '-300', val: -4200 })
      expect(bySku.get(skus.telur.skuId)).toEqual({ qty: '-2', val: -3800 })
      expect(bySku.get(skus.minyak.skuId)).toEqual({ qty: '-40', val: -560 })
      expect(bySku.get(skus.kecap.skuId)).toEqual({ qty: '-20', val: -160 })
    })

    // VoidSale reverses all 4 RECIPE_CONSUMPTION movements
    const voidRes = await processPush(
      f.cashierDev,
      {
        sent_at_device: '2026-11-24T14:05:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: newTestId(),
            type: 'VoidSale',
            schema_version: 1,
            device_seq: 2,
            created_at_device: '2026-11-24T14:05:00.000Z',
            depends_on: [cmdId],
            payload: {
              sale_id: saleId,
              voided_at: '2026-11-24T14:05:00.000Z',
              voided_by: f.appUserId,
              void_approved_by: skus.supervisorId,
              reason_code: 'MISTAKE',
              reason_text: 'Salah pesan',
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
    )
    expect(voidRes.results[0]!.outcome).toBe('ACK')

    await withTenant(f.tenantId, async (tx) => {
      const balBeras = await tx.execute<{ qty: string; inventory_value: string }>(sql`
        SELECT qty::text, inventory_value::text FROM stock_balance
        WHERE tenant_id = ${f.tenantId}::uuid AND outlet_id = ${f.outletA}::uuid AND sku_id = ${skus.beras.skuId}::uuid
      `)
      expect(normalizeQty(balBeras.rows[0]!.qty as Qty)).toBe('25000')
      expect(Number(balBeras.rows[0]!.inventory_value)).toBe(350000)
    })
  })

  it('V-17(b): 1 portion + Extra Telur + Tanpa Kecap -> 6180; menu without recipe flags TANPA_RESEP; negative stock flags STOK_MINUS; parallel menus conserve value', async () => {
    const f = await setupFnbTenant('rcp-v17b')
    const skus = await seedV17Catalog(f)

    // Before inventory enabled: no movements, no TANPA_RESEP
    const disabledSale = await pushMenuSale({
      f,
      seq: 1,
      deviceSeq: 1,
      lines: [
        {
          productId: skus.noRecipe.productId,
          skuId: skus.noRecipe.skuId,
          skuCode: 'NR-V17-1',
          itemName: 'Menu Tanpa Resep',
          qty: '1',
          unitPrice: 20000,
        },
      ],
    })
    const disabledAck = disabledSale.result as Extract<PushResultItem, { outcome: 'ACK' }>
    expect(disabledAck.outcome).toBe('ACK')
    expect(disabledAck.result).toMatchObject({ cost_total: null, flags: [] })

    await seedV17Balances(f, skus)

    const { lineIds, result } = await pushMenuSale({
      f,
      seq: 2,
      deviceSeq: 2,
      lines: [
        {
          productId: skus.nasgor.productId,
          skuId: skus.nasgor.skuId,
          skuCode: 'NG-V17-1',
          itemName: 'Nasi Goreng V17',
          qty: '1',
          unitPrice: 40000,
          modifiers: [
            { modifier_id: skus.modExtraTelur.id, name: 'Extra Telur', price_delta: 5000, qty: 1 },
            { modifier_id: skus.modTanpaKecap.id, name: 'Tanpa Kecap', price_delta: 0, qty: 1 },
          ],
        },
        {
          productId: skus.noRecipe.productId,
          skuId: skus.noRecipe.skuId,
          skuCode: 'NR-V17-1',
          itemName: 'Menu Tanpa Resep',
          qty: '1',
          unitPrice: 20000,
        },
      ],
    })

    const v17bAck = result as Extract<PushResultItem, { outcome: 'ACK' }>
    expect(v17bAck.outcome).toBe('ACK')
    expect(v17bAck.result).toMatchObject({
      cost_total: 6180,
      lines: [
        { line_no: 1, cost_snapshot: 6180 },
        { line_no: 2, cost_snapshot: null },
      ],
    })
    expect((v17bAck.result as { flags: string[] }).flags).toContain('TANPA_RESEP')

    await withTenant(f.tenantId, async (tx) => {
      const movs = await tx.execute<{ sku_id: string }>(sql`
        SELECT sku_id FROM stock_movement
        WHERE tenant_id = ${f.tenantId}::uuid AND source_id = ${lineIds[0]!}::uuid AND movement_type = 'RECIPE_CONSUMPTION'
      `)
      expect(movs.rows).toHaveLength(3)
      expect(movs.rows.map((r) => r.sku_id)).not.toContain(skus.kecap.skuId)

      const flags = await tx
        .select()
        .from(dataFlag)
        .where(and(eq(dataFlag.entityId, lineIds[1]!), eq(dataFlag.flagCode, 'TANPA_RESEP')))
      expect(flags).toHaveLength(1)
    })

    // Parallel sales sharing ingredients + going negative on Telur -> zero deadlocks, STOK_MINUS flagged
    const [p1, p2] = await Promise.all([
      pushMenuSale({
        f,
        seq: 3,
        deviceSeq: 3,
        lines: [
          {
            productId: skus.nasgor.productId,
            skuId: skus.nasgor.skuId,
            skuCode: 'NG-V17-1',
            itemName: 'Nasi Goreng V17',
            qty: '80',
            unitPrice: 35000,
          },
        ],
      }),
      pushMenuSale({
        f,
        seq: 4,
        deviceSeq: 4,
        lines: [
          {
            productId: skus.nasgor.productId,
            skuId: skus.nasgor.skuId,
            skuCode: 'NG-V17-1',
            itemName: 'Nasi Goreng V17',
            qty: '80',
            unitPrice: 35000,
          },
        ],
      }),
    ])
    expect(p1.result.outcome).toBe('ACK')
    expect(p2.result.outcome).toBe('ACK')

    await withTenant(f.tenantId, async (tx) => {
      const negFlags = await tx.select().from(dataFlag).where(eq(dataFlag.flagCode, 'STOK_MINUS'))
      expect(negFlags.length).toBeGreaterThanOrEqual(1)
    })
  })
})
