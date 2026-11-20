import { describe, expect, it } from 'vitest'
import { toMoney } from '~/lib/kernel'
import { addItem, createEmptyCart, setBillDiscount, setLineDiscount, type CartState } from './cart'
import { buildFinalizeSalePayload } from './build-finalize-payload'

function mustOk<T extends { readonly ok: true; readonly cart: CartState } | { readonly ok: false; readonly error: string }>(res: T): CartState {
  if (!res.ok) throw new Error(`Cart error: ${res.error}`)
  return res.cart
}

const SALE_ID = '0192a000-0000-7000-8000-00000000e001'
const SHIFT_ID = '0192a000-0000-7000-8000-00000000e002'
const STAFF_ID = '0192a000-0000-7000-8000-00000000e003'
const TENANT_ID = '0192a000-0000-7000-8000-00000000e004'
const OUTLET_ID = '0192a000-0000-7000-8000-00000000e005'
const REG_ID = '0192a000-0000-7000-8000-00000000e006'
const DEV_ID = '0192a000-0000-7000-8000-00000000e007'
const LE_ID = '0192a000-0000-7000-8000-00000000e008'
const TR_ID = '0192a000-0000-7000-8000-00000000e009'
const PM_CASH = '0192a000-0000-7000-8000-00000000e010'
const PM_QRIS = '0192a000-0000-7000-8000-00000000e011'

const uuid = (n: number) => `0192a000-0000-7000-8000-00000000f${String(n).padStart(3, '0')}`

function baseMeta(cashRoundingUnit: 0 | 100 | 500 | 1000) {
  return {
    saleId: SALE_ID,
    invoice: {
      invoiceNo: 'OUT01-POS02-1126-000001',
      prefix: 'OUT01-POS02',
      period: '1126',
      seq: 1,
    },
    deviceMeta: {
      tenantId: TENANT_ID,
      outletId: OUTLET_ID,
      registerId: REG_ID,
      deviceId: DEV_ID,
      shiftId: SHIFT_ID,
      staffId: STAFF_ID,
      createdAtDevice: '2026-11-20T05:00:00.000Z',
      occurredAt: '2026-11-20T05:00:00.000Z',
      businessDate: '2026-11-20',
      clockOffsetMs: 0,
      catalogCursor: 10,
    },
    outletMeta: {
      legalEntityId: LE_ID,
      legalEntityNpwp: null,
      legalEntityIsPkp: false,
      receiptLocale: 'id-ID' as const,
    },
    cashRoundingUnit,
  }
}

describe('pos/domain/build-finalize-payload (V-04, V-05, V-11, V-30)', () => {
  it('builds and verifies schema + calc invariants for V-04', () => {
    let cart = createEmptyCart({
      finalizeId: SALE_ID,
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PPN',
        taxRate: '11',
        serviceChargeEnabled: false,
        serviceChargeRate: '0',
        serviceChargeTaxable: true,
      },
      cashRoundingUnit: 100,
      taxRateId: TR_ID,
      createdAt: '2026-11-20T05:00:00.000Z',
      shiftId: SHIFT_ID,
    })
    cart = mustOk(addItem(
      cart,
      {
        skuId: uuid(1),
        productId: uuid(2),
        uomId: uuid(3),
        skuCode: 'KOP',
        itemName: 'Kopi',
        uomCode: 'pcs',
        conversionFactor: '1',
        taxable: true,
        allowFraction: false,
        price: { kind: 'PRICE', price: toMoney(18_500), source: 'OUTLET' },
      },
      { newId: uuid(4), qtyInput: '2' },
    ))
    cart = mustOk(addItem(
      cart,
      {
        skuId: uuid(5),
        productId: uuid(6),
        uomId: uuid(3),
        skuCode: 'GUL',
        itemName: 'Gula 1kg',
        uomCode: 'pcs',
        conversionFactor: '1',
        taxable: true,
        allowFraction: false,
        price: { kind: 'PRICE', price: toMoney(16_000), source: 'DEFAULT' },
      },
      { newId: uuid(7) },
    ))
    cart = mustOk(addItem(
      cart,
      {
        skuId: uuid(8),
        productId: uuid(9),
        uomId: uuid(3),
        skuCode: 'SUS',
        itemName: 'Susu UHT 1L',
        uomCode: 'pcs',
        conversionFactor: '1',
        taxable: true,
        allowFraction: false,
        price: { kind: 'PRICE', price: toMoney(17_900), source: 'OUTLET' },
      },
      { newId: uuid(10), qtyInput: '3' },
    ))
    cart = mustOk(setLineDiscount(cart, uuid(10), { type: 'PERCENT', pct: '10' }))

    const res = buildFinalizeSalePayload({
      ...baseMeta(100),
      cart,
      payments: [
        {
          methodId: PM_CASH,
          methodCode: 'CASH',
          methodName: 'Tunai',
          kind: 'CASH',
          amount: toMoney(150_000),
        },
      ],
      lineIds: [uuid(20), uuid(21), uuid(22)],
      paymentIds: [uuid(30)],
    })

    expect(res.verifyResult).toEqual({ ok: true, diffs: [] })
    expect(res.payload.sale.grand_total).toBe(112_476)
    expect(res.payload.sale.rounding).toBe(24)
    expect(res.payload.payments[0]?.is_rounding_settler).toBe(true)
    expect(res.payload.payments[0]?.change_given).toBe(37_500)
  })

  it('builds and verifies schema + calc invariants for V-11 mixed QRIS + Cash with bill discount', () => {
    let cart = createEmptyCart({
      finalizeId: SALE_ID,
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PB1',
        taxRate: '10',
        serviceChargeEnabled: true,
        serviceChargeRate: '5',
        serviceChargeTaxable: true,
      },
      cashRoundingUnit: 100,
      taxRateId: TR_ID,
      createdAt: '2026-11-20T05:00:00.000Z',
      shiftId: SHIFT_ID,
    })
    cart = mustOk(addItem(
      cart,
      {
        skuId: uuid(1),
        productId: uuid(2),
        uomId: uuid(3),
        skuCode: 'NGR',
        itemName: 'Nasi Goreng',
        uomCode: 'pcs',
        conversionFactor: '1',
        taxable: true,
        allowFraction: false,
        price: { kind: 'PRICE', price: toMoney(45_000), source: 'OUTLET' },
      },
      { newId: uuid(4), qtyInput: '2' },
    ))
    cart = mustOk(addItem(
      cart,
      {
        skuId: uuid(5),
        productId: uuid(6),
        uomId: uuid(3),
        skuCode: 'ETM',
        itemName: 'Es Teh Manis',
        uomCode: 'pcs',
        conversionFactor: '1',
        taxable: true,
        allowFraction: false,
        price: { kind: 'PRICE', price: toMoney(12_000), source: 'DEFAULT' },
      },
      { newId: uuid(7), qtyInput: '3' },
    ))
    cart = mustOk(addItem(
      cart,
      {
        skuId: uuid(8),
        productId: uuid(9),
        uomId: uuid(3),
        skuCode: 'AIR',
        itemName: 'Air Mineral',
        uomCode: 'pcs',
        conversionFactor: '1',
        taxable: false,
        allowFraction: false,
        price: { kind: 'PRICE', price: toMoney(8_000), source: 'DEFAULT' },
      },
      { newId: uuid(10) },
    ))
    cart = mustOk(setBillDiscount(cart, { type: 'NOMINAL', input: toMoney(15_000) }))

    const res = buildFinalizeSalePayload({
      ...baseMeta(100),
      cart,
      payments: [
        {
          methodId: PM_QRIS,
          methodCode: 'QRIS',
          methodName: 'QRIS',
          kind: 'NON_CASH',
          amount: toMoney(100_000),
          reference: 'QR-99',
        },
        {
          methodId: PM_CASH,
          methodCode: 'CASH',
          methodName: 'Tunai',
          kind: 'CASH',
          amount: toMoney(50_000),
        },
      ],
      lineIds: [uuid(20), uuid(21), uuid(22)],
      paymentIds: [uuid(30), uuid(31)],
    })

    expect(res.verifyResult).toEqual({ ok: true, diffs: [] })
    expect(res.payload.sale.grand_total).toBe(136_735)
    expect(res.payload.sale.rounding).toBe(-35)
    expect(res.payload.payments[0]?.is_rounding_settler).toBe(false)
    expect(res.payload.payments[1]?.is_rounding_settler).toBe(true)
    expect(res.payload.payments[1]?.change_given).toBe(13_300)
  })
})
