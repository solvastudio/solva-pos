import type { CashRoundingUnit } from '~/lib/kernel'
import { calcSale } from './calc-sale'
import { settlePayments } from './payment'
import type { PaymentInput, PaymentSettlement, SaleCalc, SaleCalcInput } from './types'

export interface CalcAndSettleResult {
  calc: SaleCalc
  settlement: PaymentSettlement
}

/**
 * Composes bill calculation (`calcSale`) with multi-method payment & rounding (`settlePayments`).
 */
export function calcAndSettle(
  input: SaleCalcInput,
  payments: readonly PaymentInput[],
  cashRoundingUnit: CashRoundingUnit,
): CalcAndSettleResult {
  const calc = calcSale(input)
  const settlement = settlePayments({
    grandTotal: calc.grandTotal,
    cashRoundingUnit,
    payments,
  })
  return { calc, settlement }
}
