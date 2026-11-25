import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { formatInvoiceNo, invoicePeriod, parseQty, toMoney } from '~/lib/kernel'
import { calcAndSettle, type PaymentInput, type SaleCalcInput } from '~/lib/sales-calc'
import { createModifier, createModifierGroup } from '~/modules/catalog/public'
import { createRegister, enrollDevice, createPairingCode } from '~/modules/identity/public'
import { bill } from '~/modules/fnb/public'
import { sale, saleLineModifier } from '~/modules/sales/server/schema'
import { processPush, type SyncDeviceIdentity } from '~/modules/sync/public'
import { dataFlag } from '~/modules/sync/server/schema'
import { handleBillAccept } from '~/routes/api/pos/v1/bills/accept'
import { handleBillHandover } from '~/routes/api/pos/v1/bills/handover'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { SALES_CALC_VECTORS } from '../../src/lib/sales-calc/sales-calc.vectors'
import { newTestId, setupFnbTenant } from './helpers/fnb'
import { masterTx } from './helpers/master'

function buildFinalizeSalePayload(params: {
  f: Awaited<ReturnType<typeof setupFnbTenant>>
  saleId: string
  seq: number
  prefix: string
  billId: string | null
  billRef: string | null
  calcInput: SaleCalcInput
  payments: readonly PaymentInput[]
  paymentMethodIds: Record<string, string>
  lineMeta: Array<{ productId: string; skuId: string; uomId: string; skuCode: string; itemName: string; modifiers?: Array<{ modifier_id: string | null; name: string; price_delta: number; qty: number }> }>
  taxRateId?: string | null
}) {
  const { f, calcInput, payments } = params
  const { calc, settlement } = calcAndSettle(calcInput, payments, 100)
  const businessDate = '2026-11-24'
  const period = invoicePeriod(businessDate)
  const invoiceNo = formatInvoiceNo({
    prefix: params.prefix,
    kind: 'INVOICE',
    period,
    seq: params.seq,
  })

  return {
    sale: {
      id: params.saleId,
      shift_id: f.cashierShiftId,
      created_by: f.appUserId,
      created_at_device: '2026-11-24T13:00:00.000Z',
      clock_offset_ms: 0,
      occurred_at: '2026-11-24T13:00:00.000Z',
      business_date: businessDate,
      invoice_no: invoiceNo,
      invoice_prefix: params.prefix,
      invoice_period: period,
      invoice_seq: params.seq,
      legal_entity_id: f.legalEntityId,
      legal_entity_npwp: null,
      legal_entity_is_pkp: false,
      price_tax_mode: calcInput.config.priceTaxMode,
      tax_profile: calcInput.config.taxProfile,
      tax_rate: calcInput.config.taxRate,
      tax_rate_id: params.taxRateId ?? null,
      service_charge_rate: calcInput.config.serviceChargeRate,
      service_charge_taxable: calcInput.config.serviceChargeTaxable,
      cash_rounding_unit: 100,
      receipt_locale: 'id-ID' as const,
      currency: 'IDR' as const,
      gross_total: calc.grossTotal,
      line_discount_total: calc.lineDiscountTotal,
      bill_discount_type: calcInput.billDiscount?.kind ?? null,
      bill_discount_pct: calcInput.billDiscount?.kind === 'PERCENT' ? calcInput.billDiscount.percent : null,
      bill_discount_input: calcInput.billDiscount?.kind === 'NOMINAL' ? calcInput.billDiscount.amount : null,
      bill_discount_total: calc.billDiscountTotal,
      discount_approved_by: null,
      net_subtotal: calc.netSubtotal,
      service_charge: calc.serviceCharge,
      tax_base: calc.taxBase,
      tax_amount: calc.taxAmount,
      dpp: calc.dpp,
      grand_total: calc.grandTotal,
      rounding: settlement.rounding,
      customer_name: null,
      customer_phone: null,
      catalog_cursor: null,
      bill_id: params.billId,
      bill_ref: params.billRef,
    },
    lines: calc.lines.map((cl, idx) => {
      const m = params.lineMeta[idx]!
      const srcLine = calcInput.lines[idx]!
      return {
        id: newTestId(),
        line_no: cl.lineNo,
        line_kind: 'ITEM' as const,
        product_id: m.productId,
        sku_id: m.skuId,
        uom_id: m.uomId,
        sku_code: m.skuCode,
        item_name: m.itemName,
        uom_code: 'pcs',
        qty: srcLine.qty,
        conversion_factor: '1',
        qty_base: srcLine.qty,
        unit_price: srcLine.unitPrice,
        price_source: 'TENANT_DEFAULT' as const,
        is_open_price: false,
        taxable: srcLine.taxable,
        discount_type: srcLine.discount?.kind ?? null,
        discount_pct: srcLine.discount?.kind === 'PERCENT' ? srcLine.discount.percent : null,
        discount_input: srcLine.discount?.kind === 'NOMINAL' ? srcLine.discount.amount : null,
        discount_approved_by: null,
        line_gross: cl.lineGross,
        line_discount: cl.lineDiscount,
        line_net: cl.lineNet,
        bill_discount_alloc: cl.billDiscountAlloc,
        service_alloc: cl.serviceAlloc,
        tax_alloc: cl.taxAlloc,
        note: null,
        source_bill_item_id: null,
        modifiers: m.modifiers ?? [],
      }
    }),
    payments: settlement.payments.map((sp, idx) => {
      const isLastCash =
        sp.kind === 'CASH' &&
        idx === settlement.payments.findLastIndex((p) => p.kind === 'CASH')
      return {
        id: newTestId(),
        seq: idx + 1,
        method_id: params.paymentMethodIds[sp.methodCode]!,
        method_code: sp.methodCode,
        method_name: sp.methodCode === 'CASH' ? 'Tunai' : 'QRIS',
        method_kind: sp.kind,
        amount_applied: sp.applied,
        cash_tendered: sp.kind === 'CASH' ? sp.tendered : null,
        change_given: sp.kind === 'CASH' ? sp.change : null,
        reference: sp.reference,
        is_rounding_settler: isLastCash && settlement.rounding !== 0,
      }
    }),
  }
}

async function openBillForDevice(
  f: Awaited<ReturnType<typeof setupFnbTenant>>,
  dev: SyncDeviceIdentity,
  billId: string,
  deviceSeq: number,
) {
  const res = await processPush(
    dev,
    {
      sent_at_device: '2026-11-24T12:00:00.000Z',
      clock_offset_ms: 0,
      commands: [
        {
          id: newTestId(),
          type: 'AppendBillEvents',
          schema_version: 1,
          device_seq: deviceSeq,
          created_at_device: '2026-11-24T12:00:00.000Z',
          depends_on: [],
          payload: {
            bill_id: billId,
            events: [
              {
                id: newTestId(),
                bill_id: billId,
                bill_seq: 1,
                device_id: dev.deviceId,
                register_id: dev.registerId,
                device_seq: deviceSeq,
                staff_id: f.appUserId,
                event_type: 'BILL_OPENED',
                payload: { table_id: f.tableA1Id, bill_ref: 'M05-0003' },
                created_at_device: '2026-11-24T12:00:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-11-24T12:00:00.000Z',
                business_date: '2026-11-24',
                schema_version: 1,
              },
            ],
          },
        },
      ],
    },
    { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
  )
  expect(res.results[0]!.outcome).toBe('ACK')
}

describe('FinalizeSale with bill_id, sale_line_modifier, and Contoh 3 V-06/V-07 (Phase 56)', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
  })

  afterAll(async () => {
    await closePools()
  })

  it('pays accepted bill on CASHIER register, writes sale_line_modifier, marks bill PAID, and handles V-06/V-07 Contoh 3', async () => {
    const f = await setupFnbTenant('fsb-contoh3')
    const grp = await createModifierGroup(f.catalogActor, {
      name: 'Sambal',
      selectionType: 'SINGLE',
      minSelect: 0,
      maxSelect: 1,
      isActive: true,
    })
    const mod = await createModifier(f.catalogActor, {
      modifierGroupId: grp.id,
      name: 'Extra Sambal',
      priceDelta: 2500,
      isActive: true,
      sortOrder: 1,
    })

    const pb1Id = await masterTx(f.tenantId, async (c, v) => {
      return (
        await c.query<{ id: string }>(
          `INSERT INTO tax_rate_history (tenant_id, version, tax_code, outlet_id, effective_from, rate)
           VALUES ($1, $2, 'PB1', $3, '2026-01-01', 10.0000) RETURNING id`,
          [f.tenantId, v, f.outletA],
        )
      ).rows[0]!.id
    })

    // 1. Waiter opens bill, hands over, cashier accepts -> cashier pays V-06 (135.655)
    const billId = newTestId()
    await openBillForDevice(f, f.waiterDev, billId, 1)

    const ho = await handleBillHandover(
      new Request('https://app.solva.test/api/pos/v1/bills/handover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${f.waiterCredential}`, 'X-Schema-Version': '1' },
        body: JSON.stringify({
          event_id: newTestId(),
          bill_id: billId,
          device_seq: 10,
          staff_id: f.appUserId,
          client_last_event_seq: 1,
          target_register_id: f.cashierRegId,
          created_at_device: '2026-11-24T12:10:00.000Z',
          clock_offset_ms: 0,
          schema_version: 1,
        }),
      }),
    )
    expect(ho.status).toBe(200)

    const acc = await handleBillAccept(
      new Request('https://app.solva.test/api/pos/v1/bills/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${f.cashierCredential}`, 'X-Schema-Version': '1' },
        body: JSON.stringify({
          event_id: newTestId(),
          bill_id: billId,
          device_seq: 1,
          staff_id: f.appUserId,
          client_last_event_seq: 2,
          created_at_device: '2026-11-24T12:11:00.000Z',
          clock_offset_ms: 0,
          schema_version: 1,
        }),
      }),
    )
    expect(acc.status).toBe(200)

    const v06 = SALES_CALC_VECTORS.find((v) => v.id === 'V-06')!
    const sale1Id = newTestId()
    const payload1 = buildFinalizeSalePayload({
      f,
      saleId: sale1Id,
      seq: 1,
      prefix: 'CAS1',
      billId,
      billRef: 'M05-0003',
      calcInput: v06.input,
      payments: v06.settlement!.payments,
      paymentMethodIds: { CASH: f.cashMethodId, QRIS: f.qrisMethodId },
      taxRateId: pb1Id,
      lineMeta: [
        { productId: f.menuProductId, skuId: f.menuSkuId, uomId: f.pcsUomId, skuCode: 'NASGOR-01', itemName: 'Nasi Goreng' },
        { productId: f.menuProductId, skuId: f.menuSkuId, uomId: f.pcsUomId, skuCode: 'ESTEH-01', itemName: 'Es Teh' },
        {
          productId: f.menu2ProductId,
          skuId: f.menu2SkuId,
          uomId: f.pcsUomId,
          skuCode: 'AYAMBK-01',
          itemName: 'Ayam Bakar',
          modifiers: [{ modifier_id: mod.id, name: 'Extra Sambal', price_delta: 2500, qty: 1 }],
        },
      ],
    })
    expect(payload1.sale.grand_total).toBe(135655)

    const cmd1Id = newTestId()
    const push1 = await processPush(
      f.cashierDev,
      {
        sent_at_device: '2026-11-24T13:00:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: cmd1Id,
            type: 'FinalizeSale',
            schema_version: 1,
            device_seq: 2,
            created_at_device: '2026-11-24T13:00:00.000Z',
            depends_on: [],
            payload: payload1,
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
    )
    expect(push1.results[0]!.outcome).toBe('ACK')

    // Replay same command -> idempotent ACK
    const push1Replay = await processPush(
      f.cashierDev,
      {
        sent_at_device: '2026-11-24T13:00:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: cmd1Id,
            type: 'FinalizeSale',
            schema_version: 1,
            device_seq: 2,
            created_at_device: '2026-11-24T13:00:00.000Z',
            depends_on: [],
            payload: payload1,
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
    )
    expect(push1Replay.results[0]!.outcome).toBe('ACK')

    // 2. Also verify V-07 (SC not taxable = 135.068) on a second cashier-owned bill
    const bill2Id = newTestId()
    await openBillForDevice(f, f.cashierDev, bill2Id, 3)
    const v07 = SALES_CALC_VECTORS.find((v) => v.id === 'V-07')!
    const sale2Id = newTestId()
    const payload2 = buildFinalizeSalePayload({
      f,
      saleId: sale2Id,
      seq: 2,
      prefix: 'CAS1',
      billId: bill2Id,
      billRef: 'M05-0004',
      calcInput: v07.input,
      payments: v07.settlement!.payments,
      paymentMethodIds: { CASH: f.cashMethodId, QRIS: f.qrisMethodId },
      taxRateId: pb1Id,
      lineMeta: [
        { productId: f.menuProductId, skuId: f.menuSkuId, uomId: f.pcsUomId, skuCode: 'NASGOR-01', itemName: 'Nasi Goreng' },
        { productId: f.menuProductId, skuId: f.menuSkuId, uomId: f.pcsUomId, skuCode: 'ESTEH-01', itemName: 'Es Teh' },
        { productId: f.menu2ProductId, skuId: f.menu2SkuId, uomId: f.pcsUomId, skuCode: 'AYAMBK-01', itemName: 'Ayam Bakar' },
      ],
    })
    expect(payload2.sale.grand_total).toBe(135068)

    const push2 = await processPush(
      f.cashierDev,
      {
        sent_at_device: '2026-11-24T13:05:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: newTestId(),
            type: 'FinalizeSale',
            schema_version: 1,
            device_seq: 4,
            created_at_device: '2026-11-24T13:05:00.000Z',
            depends_on: [],
            payload: payload2,
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
    )
    expect(push2.results[0]!.outcome).toBe('ACK')

    await withTenant(f.tenantId, async (tx) => {
      const [b1] = await tx.select().from(bill).where(eq(bill.id, billId))
      expect(b1!.status).toBe('PAID')
      expect(b1!.closedAt).not.toBeNull()

      const [s1] = await tx.select().from(sale).where(eq(sale.id, sale1Id))
      expect(s1!.billId).toBe(billId)
      expect(s1!.grandTotal).toBe(135655)

      const mods = await tx.select().from(saleLineModifier).where(eq(saleLineModifier.tenantId, f.tenantId))
      expect(mods).toHaveLength(1)
      expect(mods[0]!.name).toBe('Extra Sambal')
      expect(mods[0]!.priceDelta).toBe(2500)

      const selisihFlags = await tx
        .select()
        .from(dataFlag)
        .where(eq(dataFlag.flagCode, 'SELISIH_HITUNG'))
      expect(selisihFlags).toHaveLength(0)
    })
  })

  it('rejects WAITER payment, PENDING bill payment, non-holder cashier payment, and serializes parallel payments on same bill', async () => {
    const f = await setupFnbTenant('fsb-guards')
    const cash2Reg = await createRegister(f.actor, {
      outletId: f.outletA,
      code: 'CAS2',
      name: 'Cashier 2',
      registerType: 'CASHIER',
      invoicePrefix: 'CAS2',
    })
    const pair2 = await createPairingCode(f.actor, cash2Reg.id)
    const enr2 = await enrollDevice({ slug: f.slug, code: pair2.code, device_name: 'Cas2 Dev' }, '10.10.0.9', {
      minDelayMs: 0,
    })
    const cash2Dev: SyncDeviceIdentity = {
      tenantId: f.tenantId,
      deviceId: enr2.device_id,
      registerId: cash2Reg.id,
      outletId: f.outletA,
      registerType: 'CASHIER',
    }

    const simpleInput: SaleCalcInput = {
      lines: [
        { lineNo: 1, skuId: f.menuSkuId, uomId: f.pcsUomId, qty: parseQty('1'), unitPrice: toMoney(35000), taxable: true },
      ],
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'NONE',
        taxRate: '0.0000',
        serviceChargeEnabled: false,
        serviceChargeRate: '0.0000',
        serviceChargeTaxable: false,
      },
    }

    // 1. Waiter-held bill -> waiter cannot pay (FORBIDDEN), cashier2 cannot pay (BILL_NOT_PAYABLE)
    const waiterBill = newTestId()
    await openBillForDevice(f, f.waiterDev, waiterBill, 1)

    const waiterPay = await processPush(
      f.waiterDev,
      {
        sent_at_device: '2026-11-24T13:00:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: newTestId(),
            type: 'FinalizeSale',
            schema_version: 1,
            device_seq: 5,
            created_at_device: '2026-11-24T13:00:00.000Z',
            depends_on: [],
            payload: buildFinalizeSalePayload({
              f,
              saleId: newTestId(),
              seq: 1,
              prefix: 'CAS1',
              billId: waiterBill,
              billRef: 'M05-0003',
              calcInput: simpleInput,
              payments: [{ methodCode: 'QRIS', kind: 'NON_CASH', amount: toMoney(35000) }],
              paymentMethodIds: { CASH: f.cashMethodId, QRIS: f.qrisMethodId },
              lineMeta: [{ productId: f.menuProductId, skuId: f.menuSkuId, uomId: f.pcsUomId, skuCode: 'NASGOR-01', itemName: 'Nasi Goreng' }],
            }),
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
    )
    expect(waiterPay.results[0]).toMatchObject({ outcome: 'ATTENTION', reason_class: 'AUTHORIZATION' })

    const nonHolderCashierPay = await processPush(
      f.cashierDev,
      {
        sent_at_device: '2026-11-24T13:00:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: newTestId(),
            type: 'FinalizeSale',
            schema_version: 1,
            device_seq: 1,
            created_at_device: '2026-11-24T13:00:00.000Z',
            depends_on: [],
            payload: buildFinalizeSalePayload({
              f,
              saleId: newTestId(),
              seq: 1,
              prefix: 'CAS1',
              billId: waiterBill,
              billRef: 'M05-0003',
              calcInput: simpleInput,
              payments: [{ methodCode: 'QRIS', kind: 'NON_CASH', amount: toMoney(35000) }],
              paymentMethodIds: { CASH: f.cashMethodId, QRIS: f.qrisMethodId },
              lineMeta: [{ productId: f.menuProductId, skuId: f.menuSkuId, uomId: f.pcsUomId, skuCode: 'NASGOR-01', itemName: 'Nasi Goreng' }],
            }),
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
    )
    expect(nonHolderCashierPay.results[0]).toMatchObject({ outcome: 'ATTENTION', reason_code: 'BILL_NOT_PAYABLE' })

    // 2. Cashier1 opens bill and hands over to Cash2 (PENDING) -> Cashier1 cannot pay while PENDING
    const casBill = newTestId()
    await openBillForDevice(f, f.cashierDev, casBill, 2)
    const ho = await handleBillHandover(
      new Request('https://app.solva.test/api/pos/v1/bills/handover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${f.cashierCredential}`, 'X-Schema-Version': '1' },
        body: JSON.stringify({
          event_id: newTestId(),
          bill_id: casBill,
          device_seq: 3,
          staff_id: f.appUserId,
          client_last_event_seq: 1,
          target_register_id: cash2Dev.registerId,
          created_at_device: '2026-11-24T12:10:00.000Z',
          clock_offset_ms: 0,
          schema_version: 1,
        }),
      }),
    )
    expect(ho.status).toBe(200)

    const payPending = await processPush(
      f.cashierDev,
      {
        sent_at_device: '2026-11-24T13:01:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: newTestId(),
            type: 'FinalizeSale',
            schema_version: 1,
            device_seq: 4,
            created_at_device: '2026-11-24T13:01:00.000Z',
            depends_on: [],
            payload: buildFinalizeSalePayload({
              f,
              saleId: newTestId(),
              seq: 2,
              prefix: 'CAS1',
              billId: casBill,
              billRef: 'M05-0003',
              calcInput: simpleInput,
              payments: [{ methodCode: 'QRIS', kind: 'NON_CASH', amount: toMoney(35000) }],
              paymentMethodIds: { CASH: f.cashMethodId, QRIS: f.qrisMethodId },
              lineMeta: [{ productId: f.menuProductId, skuId: f.menuSkuId, uomId: f.pcsUomId, skuCode: 'NASGOR-01', itemName: 'Nasi Goreng' }],
            }),
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
    )
    expect(payPending.results[0]).toMatchObject({ outcome: 'ATTENTION', reason_code: 'BILL_NOT_PAYABLE' })

    // 3. Two parallel FinalizeSale commands on the same cashier-owned bill -> exactly one sale
    const raceBill = newTestId()
    await openBillForDevice(f, f.cashierDev, raceBill, 5)
    const pA = buildFinalizeSalePayload({
      f,
      saleId: newTestId(),
      seq: 3,
      prefix: 'CAS1',
      billId: raceBill,
      billRef: 'M05-0003',
      calcInput: simpleInput,
      payments: [{ methodCode: 'QRIS', kind: 'NON_CASH', amount: toMoney(35000) }],
      paymentMethodIds: { CASH: f.cashMethodId, QRIS: f.qrisMethodId },
      lineMeta: [{ productId: f.menuProductId, skuId: f.menuSkuId, uomId: f.pcsUomId, skuCode: 'NASGOR-01', itemName: 'Nasi Goreng' }],
    })
    const pB = buildFinalizeSalePayload({
      f,
      saleId: newTestId(),
      seq: 4,
      prefix: 'CAS1',
      billId: raceBill,
      billRef: 'M05-0003',
      calcInput: simpleInput,
      payments: [{ methodCode: 'QRIS', kind: 'NON_CASH', amount: toMoney(35000) }],
      paymentMethodIds: { CASH: f.cashMethodId, QRIS: f.qrisMethodId },
      lineMeta: [{ productId: f.menuProductId, skuId: f.menuSkuId, uomId: f.pcsUomId, skuCode: 'NASGOR-01', itemName: 'Nasi Goreng' }],
    })

    const [r1, r2] = await Promise.all([
      processPush(
        f.cashierDev,
        {
          sent_at_device: '2026-11-24T13:02:00.000Z',
          clock_offset_ms: 0,
          commands: [
            { id: newTestId(), type: 'FinalizeSale', schema_version: 1, device_seq: 6, created_at_device: '2026-11-24T13:02:00.000Z', depends_on: [], payload: pA },
          ],
        },
        { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
      ),
      processPush(
        f.cashierDev,
        {
          sent_at_device: '2026-11-24T13:02:00.000Z',
          clock_offset_ms: 0,
          commands: [
            { id: newTestId(), type: 'FinalizeSale', schema_version: 1, device_seq: 7, created_at_device: '2026-11-24T13:02:00.000Z', depends_on: [], payload: pB },
          ],
        },
        { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
      ),
    ])

    const outcomes = [r1.results[0]!.outcome, r2.results[0]!.outcome].sort()
    expect(outcomes).toEqual(['ACK', 'ATTENTION'])

    await withTenant(f.tenantId, async (tx) => {
      const salesForBill = await tx.select().from(sale).where(eq(sale.billId, raceBill))
      expect(salesForBill).toHaveLength(1)
    })
  })
})
