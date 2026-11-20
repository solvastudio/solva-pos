import { toMoney, type Money } from '~/lib/kernel'
import { expectedCash } from '~/lib/sales-calc'
import type {
  CashMovementRecord,
  CreditNoteRefundRecord,
  SalePaymentRecord,
  SaleRecord,
  ShiftRecord,
} from '../db/types'

export interface MethodRecapSummary {
  methodCode: string
  methodName: string
  kind: 'CASH' | 'NON_CASH'
  totalApplied: Money
  paymentCount: number
}

export interface LocalShiftRecap {
  openingCash: Money
  cashSalesTotal: Money
  cashInTotal: Money
  cashOutTotal: Money
  cashRefundsTotal: Money
  expectedCash: Money
  paidSaleCount: number
  voidSaleCount: number
  nonCashTotal: Money
  methods: MethodRecapSummary[]
}

/**
 * Pure local shift recap using the exact kernel `expectedCash` formula (BR-SHF-005, V-21):
 * `VOID` invoices are excluded; `NON_CASH` methods are tallied separately and never added to cash drawer.
 */
export function computeLocalShiftRecap(input: {
  shift: Pick<ShiftRecord, 'id' | 'opening_cash'>
  sales: readonly SaleRecord[]
  salePayments: readonly SalePaymentRecord[]
  cashMovements: readonly CashMovementRecord[]
  creditNoteRefunds: readonly CreditNoteRefundRecord[]
}): LocalShiftRecap {
  const paidSaleIds = new Set<string>()
  let voidSaleCount = 0

  for (const s of input.sales) {
    if (s.shift_id !== input.shift.id) continue
    if (s.status === 'VOID') {
      voidSaleCount += 1
    } else if (s.status === 'PAID') {
      paidSaleIds.add(s.id)
    }
  }

  const cashSalesApplied: Money[] = []
  let cashSalesNum = 0
  let nonCashNum = 0
  const byMethod = new Map<string, { methodCode: string; methodName: string; kind: 'CASH' | 'NON_CASH'; sum: number; count: number }>()

  for (const p of input.salePayments) {
    if (!paidSaleIds.has(p.sale_id)) continue
    const existing = byMethod.get(p.method_code)
    if (existing) {
      existing.sum += p.amount_applied
      existing.count += 1
    } else {
      byMethod.set(p.method_code, {
        methodCode: p.method_code,
        methodName: p.method_name,
        kind: p.method_kind,
        sum: p.amount_applied,
        count: 1,
      })
    }

    if (p.method_kind === 'CASH') {
      cashSalesApplied.push(toMoney(p.amount_applied))
      cashSalesNum += p.amount_applied
    } else {
      nonCashNum += p.amount_applied
    }
  }

  const cashIn: Money[] = []
  const cashOut: Money[] = []
  let cashInNum = 0
  let cashOutNum = 0

  for (const m of input.cashMovements) {
    if (m.shift_id !== input.shift.id) continue
    if (m.direction === 'IN') {
      cashIn.push(toMoney(m.amount))
      cashInNum += m.amount
    } else {
      cashOut.push(toMoney(m.amount))
      cashOutNum += m.amount
    }
  }

  const cashRefunds: Money[] = []
  let cashRefundNum = 0
  for (const r of input.creditNoteRefunds) {
    if (r.shift_id !== input.shift.id) continue
    if (r.method_kind === 'CASH') {
      cashRefunds.push(toMoney(r.amount_applied))
      cashRefundNum += r.amount_applied
    }
  }

  const exp = expectedCash({
    openingFloat: toMoney(input.shift.opening_cash),
    cashSalesApplied,
    cashIn,
    cashOut,
    cashRefunds,
  })

  return {
    openingCash: toMoney(input.shift.opening_cash),
    cashSalesTotal: toMoney(cashSalesNum),
    cashInTotal: toMoney(cashInNum),
    cashOutTotal: toMoney(cashOutNum),
    cashRefundsTotal: toMoney(cashRefundNum),
    expectedCash: exp,
    paidSaleCount: paidSaleIds.size,
    voidSaleCount,
    nonCashTotal: toMoney(nonCashNum),
    methods: [...byMethod.values()].map((m) => ({
      methodCode: m.methodCode,
      methodName: m.methodName,
      kind: m.kind,
      totalApplied: toMoney(m.sum),
      paymentCount: m.count,
    })),
  }
}
