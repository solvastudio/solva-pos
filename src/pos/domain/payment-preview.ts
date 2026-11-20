import { toMoney, ZERO, type CashRoundingUnit, type Money } from '~/lib/kernel'
import {
  PaymentError,
  settlePayments,
  type PaymentErrorCode,
  type PaymentInput,
  type PaymentSettlement,
} from '~/lib/sales-calc'

export interface PaymentPreviewResult {
  readonly remaining: Money
  readonly totalPaid: Money
  readonly canFinalize: boolean
  readonly settlement?: PaymentSettlement
  readonly error?: PaymentErrorCode
}

/**
 * Pure multi-method payment preview wrapping `settlePayments` without duplicating
 * any money math (BR-PAY-001..005). Partial/underpaid totals show unrounded remaining.
 */
export function previewPayments(input: {
  grandTotal: Money
  cashRoundingUnit: CashRoundingUnit
  payments: readonly PaymentInput[]
}): PaymentPreviewResult {
  if (input.payments.length === 0) {
    return {
      remaining: input.grandTotal,
      totalPaid: ZERO,
      canFinalize: false,
      error: 'EMPTY',
    }
  }

  let rawSum = 0
  for (const p of input.payments) {
    rawSum += p.amount
  }

  try {
    const settlement = settlePayments(input)
    return {
      remaining: ZERO,
      totalPaid: toMoney(settlement.cashApplied + settlement.nonCashApplied),
      canFinalize: true,
      settlement,
    }
  } catch (err) {
    const code: PaymentErrorCode = err instanceof PaymentError ? err.code : 'INVALID_AMOUNT'
    const unroundedRemaining = toMoney(Math.max(0, input.grandTotal - rawSum))
    return {
      remaining: unroundedRemaining,
      totalPaid: toMoney(Math.max(0, rawSum)),
      canFinalize: false,
      error: code,
    }
  }
}
