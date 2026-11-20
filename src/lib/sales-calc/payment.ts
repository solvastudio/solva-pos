import { roundToUnit, toMoney, ZERO, type CashRoundingUnit, type Money } from '~/lib/kernel'
import { PaymentError, type AppliedPayment, type PaymentInput, type PaymentSettlement } from './types'

export interface SettlePaymentsInput {
  grandTotal: Money
  cashRoundingUnit: CashRoundingUnit
  payments: readonly PaymentInput[]
}

/**
 * Resolves multi-method tender order (BR-PAY-001..005, BR-TAX-009):
 * non-last cash and non-cash never round; only a terminal settling cash payment
 * applies `cashRoundingUnit` to remaining balance and computes change cleanly.
 */
export function settlePayments(input: SettlePaymentsInput): PaymentSettlement {
  if (!Number.isSafeInteger(input.grandTotal) || input.grandTotal < 0) {
    throw new PaymentError('INVALID_AMOUNT', `grandTotal must be integer >= 0: ${input.grandTotal}`)
  }
  if (input.payments.length === 0) {
    throw new PaymentError('EMPTY', 'At least one payment entry is required')
  }

  let remaining = input.grandTotal as number
  let rounding = ZERO
  let cashAppliedNum = 0
  let nonCashAppliedNum = 0
  let changeTotalNum = 0
  const appliedList: AppliedPayment[] = []

  for (let i = 0; i < input.payments.length; i += 1) {
    const p = input.payments[i]!
    const isLast = i === input.payments.length - 1

    if (typeof p.amount !== 'number' || !Number.isSafeInteger(p.amount) || p.amount < 0) {
      throw new PaymentError('INVALID_AMOUNT', `Payment amount must be integer >= 0: ${p.amount}`)
    }

    if (p.kind === 'NON_CASH') {
      if (p.amount <= 0) {
        throw new PaymentError('INVALID_AMOUNT', 'Non-cash payment amount must be > 0')
      }
      if (p.amount > remaining) {
        throw new PaymentError(
          'NONCASH_EXCEEDS_REMAINING',
          `Non-cash amount ${p.amount} exceeds remaining ${remaining}`,
        )
      }
      appliedList.push({
        methodCode: p.methodCode,
        kind: 'NON_CASH',
        tendered: p.amount,
        applied: p.amount,
        change: ZERO,
        reference: p.reference ?? null,
      })
      nonCashAppliedNum += p.amount
      remaining -= p.amount
      continue
    }

    // CASH
    if (!isLast) {
      if (p.amount <= 0) {
        throw new PaymentError('INVALID_AMOUNT', 'Partial cash payment amount must be > 0')
      }
      if (p.amount > remaining) {
        throw new PaymentError(
          'INVALID_ORDER',
          'Cash payment with excess/change must be the final settling payment',
        )
      }
      appliedList.push({
        methodCode: p.methodCode,
        kind: 'CASH',
        tendered: p.amount,
        applied: p.amount,
        change: ZERO,
        reference: p.reference ?? null,
      })
      cashAppliedNum += p.amount
      remaining -= p.amount
      continue
    }

    // Terminal settling CASH payment
    const due = roundToUnit(toMoney(remaining), input.cashRoundingUnit)
    if (p.amount < due) {
      throw new PaymentError(
        'UNDERPAID',
        `Cash tendered ${p.amount} is less than rounded due ${due}`,
      )
    }
    const change = toMoney(p.amount - due)
    rounding = toMoney(due - remaining)
    appliedList.push({
      methodCode: p.methodCode,
      kind: 'CASH',
      tendered: p.amount,
      applied: due,
      change,
      reference: p.reference ?? null,
    })
    cashAppliedNum += due
    changeTotalNum += change
    remaining = 0
  }

  if (remaining > 0) {
    throw new PaymentError('UNDERPAID', `Payments left ${remaining} unpaid`)
  }

  return {
    payments: appliedList,
    rounding,
    totalDue: toMoney(input.grandTotal + rounding),
    cashApplied: toMoney(cashAppliedNum),
    nonCashApplied: toMoney(nonCashAppliedNum),
    changeTotal: toMoney(changeTotalNum),
    settled: true,
  }
}
