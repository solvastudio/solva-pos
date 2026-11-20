import { useMemo } from 'react'
import { roundToUnit, toMoney, ZERO, type Money } from '~/lib/kernel'
import { calcSale, type SaleCalc } from '~/lib/sales-calc'
import { useStore } from 'zustand'
import { toCalcInput } from '../domain/cart'
import { posCartStore } from '../state/cart-store'

const EMPTY_CALC: SaleCalc = {
  lines: [],
  grossTotal: ZERO,
  lineDiscountTotal: ZERO,
  billDiscountTotal: ZERO,
  netSubtotal: ZERO,
  serviceCharge: ZERO,
  taxBase: ZERO,
  taxAmount: ZERO,
  dpp: ZERO,
  grandTotal: ZERO,
}

export interface CartTotalsView {
  calc: SaleCalc
  cashTotal: Money
  roundingDelta: number
  itemCount: number
}

export function useCartTotals(): CartTotalsView {
  const cart = useStore(posCartStore, (s) => s.cart)

  return useMemo(() => {
    const calc = cart.lines.length === 0 ? EMPTY_CALC : calcSale(toCalcInput(cart))
    const cashTotal = toMoney(roundToUnit(calc.grandTotal, cart.cashRoundingUnit))
    const roundingDelta = cashTotal - calc.grandTotal
    const itemCount = cart.lines.length
    return {
      calc,
      cashTotal,
      roundingDelta,
      itemCount,
    }
  }, [cart])
}
