import { describe, expect, it } from 'vitest'
import { toMoney } from '~/lib/kernel'
import { calcSale } from '~/lib/sales-calc'
import {
  addItem,
  createEmptyCart,
  removeLine,
  setLineDiscount,
  setOpenPrice,
  setQty,
  toCalcInput,
} from './cart'

const CFG_PPN_EXCL = {
  priceTaxMode: 'EXCLUSIVE' as const,
  taxProfile: 'PPN' as const,
  taxRate: '11',
  serviceChargeEnabled: false,
  serviceChargeRate: '0',
  serviceChargeTaxable: true,
}

const KOPI = {
  skuId: 'sku-kopi',
  productId: 'prod-kopi',
  uomId: 'uom-pcs',
  skuCode: 'KOP',
  itemName: 'Kopi',
  uomCode: 'pcs',
  conversionFactor: '1',
  taxable: true,
  allowFraction: false,
  price: { kind: 'PRICE' as const, price: toMoney(18_500), source: 'OUTLET' as const },
}

const GULA = {
  skuId: 'sku-gula',
  productId: 'prod-gula',
  uomId: 'uom-pcs',
  skuCode: 'GUL',
  itemName: 'Gula 1kg',
  uomCode: 'pcs',
  conversionFactor: '1',
  taxable: true,
  allowFraction: false,
  price: { kind: 'PRICE' as const, price: toMoney(16_000), source: 'DEFAULT' as const },
}

const SUSU = {
  skuId: 'sku-susu',
  productId: 'prod-susu',
  uomId: 'uom-pcs',
  skuCode: 'SUS',
  itemName: 'Susu UHT 1L',
  uomCode: 'pcs',
  conversionFactor: '1',
  taxable: true,
  allowFraction: false,
  price: { kind: 'PRICE' as const, price: toMoney(17_900), source: 'OUTLET' as const },
}

const SUSU_DUS = {
  ...SUSU,
  uomId: 'uom-dus',
  uomCode: 'dus',
  conversionFactor: '12',
  allowFraction: true,
  price: { kind: 'PRICE' as const, price: toMoney(200_000), source: 'OUTLET' as const },
}

describe('pos/domain/cart (V-04, V-24, V-30)', () => {
  it('merges repeated fixed scans to qty 3 and computes V-04 grandTotal 112,476', () => {
    let cart = createEmptyCart({
      finalizeId: 'fin-1',
      config: CFG_PPN_EXCL,
      cashRoundingUnit: 100,
      taxRateId: 'tr-1',
      createdAt: '2026-11-20T09:00:00.000Z',
      shiftId: 'shift-1',
    })

    // 2x Kopi via scans -> single line qty 2
    const r1 = addItem(cart, KOPI, { newId: 'l1' })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    cart = r1.cart

    const r2 = addItem(cart, KOPI, { newId: 'l2' })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    cart = r2.cart
    expect(cart.lines).toHaveLength(1)
    expect(cart.lines[0]!.qty).toBe('2')

    // Gula 1x + Susu 3x with 10% line discount -> V-04 G = 112,476
    const rg = addItem(cart, GULA, { newId: 'l3' })
    expect(rg.ok).toBe(true)
    if (!rg.ok) return
    cart = rg.cart

    const rs = addItem(cart, SUSU, { newId: 'l4', qtyInput: '3' })
    expect(rs.ok).toBe(true)
    if (!rs.ok) return
    cart = rs.cart

    const disc = setLineDiscount(cart, 'l4', { type: 'PERCENT', pct: '10' })
    expect(disc.ok).toBe(true)
    if (!disc.ok) return
    cart = disc.cart

    const res = calcSale(toCalcInput(cart))
    expect(res.netSubtotal).toBe(101_330)
    expect(res.taxAmount).toBe(11_146)
    expect(res.grandTotal).toBe(112_476)

    // Remove line renumbers sequentially
    const trimmed = removeLine(cart, 'l3')
    expect(trimmed.lines.map((l) => l.lineNo)).toEqual([1, 2])
  })

  it('validates Susu dus 0.5 -> base 6 and V-24 0.35 dus -> FRACTION_NOT_ALLOWED on pcs base', () => {
    let cart = createEmptyCart({
      finalizeId: 'fin-2',
      config: CFG_PPN_EXCL,
      cashRoundingUnit: 100,
      taxRateId: 'tr-1',
      createdAt: '2026-11-20T09:00:00.000Z',
      shiftId: 'shift-1',
    })

    const added = addItem(cart, SUSU_DUS, { newId: 'l1' })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    cart = added.cart

    const halfDus = setQty(cart, 'l1', '0,5', false) // note allowFraction on base pcs is false!
    expect(halfDus.ok).toBe(true)
    if (halfDus.ok) {
      expect(halfDus.cart.lines[0]!.qty).toBe('0.5')
      expect(halfDus.cart.lines[0]!.qtyBase).toBe('6')
    }

    const badDus = setQty(cart, 'l1', '0.35', false)
    expect(badDus).toEqual({ ok: false, error: 'FRACTION_NOT_ALLOWED' })
  })

  it('rejects NO_PRICE items, blocks editing fixed price, and reproduces V-30 with open price 12,500', () => {
    let cart = createEmptyCart({
      finalizeId: 'fin-3',
      config: CFG_PPN_EXCL,
      cashRoundingUnit: 0,
      taxRateId: 'tr-1',
      createdAt: '2026-11-20T09:00:00.000Z',
      shiftId: 'shift-1',
    })

    const noPrice = addItem(cart, { ...KOPI, price: { kind: 'NO_PRICE' } }, { newId: 'lx' })
    expect(noPrice).toEqual({ ok: false, error: 'NO_PRICE' })

    const rKopi = addItem(cart, KOPI, { newId: 'l1', qtyInput: '2' })
    expect(rKopi.ok).toBe(true)
    if (!rKopi.ok) return
    cart = rKopi.cart

    // Fixed item price cannot be edited via setOpenPrice
    expect(setOpenPrice(cart, 'l1', 99_000)).toEqual({ ok: false, error: 'INVALID_PRICE' })

    const openRes = addItem(
      cart,
      {
        skuId: 'sku-open',
        productId: 'prod-open',
        uomId: 'uom-pcs',
        skuCode: 'OPEN',
        itemName: 'Custom Tambah',
        uomCode: 'pcs',
        conversionFactor: '1',
        taxable: true,
        allowFraction: false,
        price: { kind: 'OPEN_PRICE', suggested: null },
      },
      { newId: 'l2', openPriceOverride: 12_500 },
    )
    expect(openRes.ok).toBe(true)
    if (!openRes.ok) return
    cart = openRes.cart

    const calc = calcSale(toCalcInput(cart))
    expect(calc.grossTotal).toBe(49_500)
    expect(calc.taxAmount).toBe(5_445)
    expect(calc.grandTotal).toBe(54_945)
  })
})
