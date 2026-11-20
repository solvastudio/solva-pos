import { describe, expect, it } from 'vitest'
import { parseQty, toMoney, ZERO } from '~/lib/kernel'
import { calcCreditNote, calcReturnLine, isWithinReturnWindow } from './return'
import { ReturnError } from './types'

describe('sales-calc/return (BR-RTR-003/006, V-18, V-23)', () => {
  it('computes V-18 (1 of 3 Susu returned -> 17,882 gross / 17,900 cash rounding +18)', () => {
    const cn = calcCreditNote({
      lines: [
        {
          qtySold: parseQty('3'),
          qtyAlreadyReturned: parseQty('0'),
          qtyReturn: parseQty('1'),
          originalNet: toMoney(48330),
          originalScAlloc: ZERO,
          originalTaxAlloc: toMoney(5316),
          returnedSoFar: { net: ZERO, sc: ZERO, tax: ZERO },
        },
      ],
      priceTaxMode: 'EXCLUSIVE',
      refund: { method: 'CASH', cashRoundingUnit: 100 },
    })

    expect(cn.lines[0]).toEqual({ net: 16110, sc: 0, tax: 1772, isLast: false })
    expect(cn.netTotal).toBe(16110)
    expect(cn.taxTotal).toBe(1772)
    expect(cn.refundGross).toBe(17882)
    expect(cn.refundCashApplied).toBe(17900)
    expect(cn.rounding).toBe(18)
  })

  it('guarantees exact residual remainder on last partial return (Contoh 2: 3333 / 3333 / 3334)', () => {
    const r1 = calcReturnLine({
      qtySold: parseQty('3'),
      qtyAlreadyReturned: parseQty('0'),
      qtyReturn: parseQty('1'),
      originalNet: toMoney(10000),
      originalScAlloc: ZERO,
      originalTaxAlloc: toMoney(1100),
      returnedSoFar: { net: ZERO, sc: ZERO, tax: ZERO },
    })
    const r2 = calcReturnLine({
      qtySold: parseQty('3'),
      qtyAlreadyReturned: parseQty('1'),
      qtyReturn: parseQty('1'),
      originalNet: toMoney(10000),
      originalScAlloc: ZERO,
      originalTaxAlloc: toMoney(1100),
      returnedSoFar: { net: r1.net, sc: r1.sc, tax: r1.tax },
    })
    const r3 = calcReturnLine({
      qtySold: parseQty('3'),
      qtyAlreadyReturned: parseQty('2'),
      qtyReturn: parseQty('1'),
      originalNet: toMoney(10000),
      originalScAlloc: ZERO,
      originalTaxAlloc: toMoney(1100),
      returnedSoFar: {
        net: toMoney(r1.net + r2.net),
        sc: toMoney(r1.sc + r2.sc),
        tax: toMoney(r1.tax + r2.tax),
      },
    })

    expect([r1.net, r2.net, r3.net]).toEqual([3333, 3333, 3334])
    expect(r3.isLast).toBe(true)
    expect(r1.net + r2.net + r3.net).toBe(10000)
    expect(r1.tax + r2.tax + r3.tax).toBe(1100)
  })

  it('handles ORIGINAL refund without cash rounding and rejects excess cumulative return qty', () => {
    const origCn = calcCreditNote({
      lines: [
        {
          qtySold: parseQty('2'),
          qtyAlreadyReturned: parseQty('0'),
          qtyReturn: parseQty('1'),
          originalNet: toMoney(10133),
          originalScAlloc: ZERO,
          originalTaxAlloc: ZERO,
          returnedSoFar: { net: ZERO, sc: ZERO, tax: ZERO },
        },
      ],
      priceTaxMode: 'INCLUSIVE',
      refund: { method: 'ORIGINAL', cashRoundingUnit: 100 },
    })
    expect(origCn.refundCashApplied).toBeNull()
    expect(origCn.rounding).toBe(0)

    expect(() =>
      calcReturnLine({
        qtySold: parseQty('3'),
        qtyAlreadyReturned: parseQty('2'),
        qtyReturn: parseQty('1.0001'),
        originalNet: toMoney(10000),
        originalScAlloc: ZERO,
        originalTaxAlloc: ZERO,
        returnedSoFar: { net: toMoney(6667), sc: ZERO, tax: ZERO },
      }),
    ).toThrowError(ReturnError)
  })

  it('checks V-23 return window end bounds cleanly', () => {
    expect(isWithinReturnWindow('2026-08-31', '2026-11-30')).toBe(true)
    expect(isWithinReturnWindow('2026-08-31', '2026-12-01')).toBe(false)
    expect(isWithinReturnWindow('2026-08-15', '2026-11-15')).toBe(true)
    expect(isWithinReturnWindow('2026-08-15', '2026-11-16')).toBe(false)
    expect(isWithinReturnWindow('2026-08-15', '2026-08-14')).toBe(false)
  })
})
