import { describe, expect, it } from 'vitest'
import { toMoney } from '~/lib/kernel'
import { OPEN_SHIFT_QUICK_AMOUNTS, suggestCashAmounts } from './quick-amounts'

describe('pos/domain/quick-amounts', () => {
  it('exports open shift presets and computes exact + up to 3 higher clean ceilings', () => {
    expect(OPEN_SHIFT_QUICK_AMOUNTS).toEqual([100_000, 200_000, 500_000])
    expect(suggestCashAmounts(toMoney(112_500))).toEqual([
      112_500,
      115_000,
      120_000,
      150_000,
    ])
    expect(suggestCashAmounts(toMoney(50_000))).toEqual([
      50_000,
      55_000,
      60_000,
      100_000,
    ])
    expect(suggestCashAmounts(toMoney(0))).toEqual([])
  })
})
