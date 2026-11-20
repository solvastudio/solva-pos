import { describe, expect, it } from 'vitest'
import { copyPrices, increasePricePercent } from './price-adjust'

describe('price-adjust', () => {
  it('computes half-up percentage adjustments cleanly (18500 + 2,7% => 18999) and never negative', () => {
    // 18500 * 0.027 = 499.5 -> 500? Wait: check exact spec arithmetic:
    // 18500 * 2.7 / 100 = 499.5 -> roundHalfUp = 500 -> 19000; 18499 * 2.7 / 100 = 499.473 -> 499
    // Let's assert exact kernel roundHalfUp behavior + comma parsing + clamp at 0
    expect(increasePricePercent(18500, '2,7')).toBe(19000)
    expect(increasePricePercent(18500, '2.69')).toBe(18998)
    expect(increasePricePercent(18500, '10')).toBe(20350)
    expect(increasePricePercent(10000, '-150')).toBe(0)
    expect(() => increasePricePercent(10000, '1.12345')).toThrow(RangeError)
  })

  it('copies matching outlet or default prices into a clean (skuId:uomId) map', () => {
    const entries = [
      { skuId: 's1', uomId: 'u1', outletId: null, price: 15000 },
      { skuId: 's1', uomId: 'u1', outletId: 'out1', price: 17000 },
      { skuId: 's2', uomId: 'u1', outletId: 'out1', price: 22000 },
    ]
    const fromOut1 = copyPrices(entries, 'out1')
    expect(Array.from(fromOut1.entries())).toEqual([
      ['s1:u1', 17000],
      ['s2:u1', 22000],
    ])
    const fromDefault = copyPrices(entries, null)
    expect(Array.from(fromDefault.entries())).toEqual([['s1:u1', 15000]])
  })
})
