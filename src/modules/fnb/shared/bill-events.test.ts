import { describe, expect, it } from 'vitest'
import { toMoney } from '~/lib/kernel'
import { computeModifierDeltaSum, verifyBillItemUnitPrice } from './bill-events'

const MOD_1 = '01950000-0000-7000-8000-000000000901'
const MOD_2 = '01950000-0000-7000-8000-000000000902'

describe('fnb/shared/bill-events (BR-PRC-006)', () => {
  it('verifies item unit_price against base_unit_price + modifier deltas', () => {
    const mods = [
      { modifier_id: MOD_1, name: 'Extra Telur', price_delta: 5000, qty: 1 },
      { modifier_id: MOD_2, name: 'Tanpa Kecap', price_delta: -2000, qty: 1 },
    ]
    expect(computeModifierDeltaSum(mods)).toBe(3000)

    expect(verifyBillItemUnitPrice(toMoney(35000), mods, toMoney(38000))).toEqual({
      ok: true,
      expectedUnitPrice: 38000,
      diffAmount: 0,
    })

    expect(verifyBillItemUnitPrice(toMoney(35000), mods, toMoney(39500))).toEqual({
      ok: false,
      expectedUnitPrice: 38000,
      diffAmount: 1500,
    })
  })
})
