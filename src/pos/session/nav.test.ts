import { describe, expect, it } from 'vitest'
import { buildPosNavSpecs, isRouteForbiddenForWaiter, isWaiterRegister } from './nav'

describe('pos/session/nav', () => {
  it('restricts WAITER registers to Tables, Bills, More and blocks sell/pay/shift/cash/return/history routes', () => {
    expect(isWaiterRegister('WAITER')).toBe(true)
    expect(isWaiterRegister('CASHIER')).toBe(false)

    const waiterNav = buildPosNavSpecs({
      cleanSlug: 'warung',
      registerType: 'WAITER',
      shiftOpen: false,
    })
    expect(waiterNav.map((n) => n.key)).toEqual(['tables', 'bills', 'more'])

    const cashierNav = buildPosNavSpecs({
      cleanSlug: 'warung',
      registerType: 'CASHIER',
      shiftOpen: true,
    })
    expect(cashierNav.map((n) => n.key)).toEqual(['sell', 'tables', 'bills', 'history', 'shift', 'more'])

    expect(isRouteForbiddenForWaiter('/warung/pos/sell')).toBe(true)
    expect(isRouteForbiddenForWaiter('/warung/pos/pay')).toBe(true)
    expect(isRouteForbiddenForWaiter('/warung/pos/shift/open')).toBe(true)
    expect(isRouteForbiddenForWaiter('/warung/pos/history')).toBe(true)
    expect(isRouteForbiddenForWaiter('/warung/pos/return/sale-1')).toBe(true)
    expect(isRouteForbiddenForWaiter('/warung/pos/cash')).toBe(true)

    expect(isRouteForbiddenForWaiter('/warung/pos/tables')).toBe(false)
    expect(isRouteForbiddenForWaiter('/warung/pos/bills')).toBe(false)
    expect(isRouteForbiddenForWaiter('/warung/pos/bill/123')).toBe(false)
    expect(isRouteForbiddenForWaiter('/warung/pos/more')).toBe(false)
  })
})
