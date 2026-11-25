import { roundCashDue, toMoney, ZERO, type CashRoundingUnit, type Money } from '~/lib/kernel'
import {
  calcSale,
  type DiscountInput,
  type SaleCalc,
  type SaleCalcInput,
  type SaleConfigSnapshot,
  type CartLineInput,
} from '~/lib/sales-calc'
import type { BillItemRecord, BillRecord, BillSnapshotItemRecord, BillSnapshotRecord } from '../db/types'

export type BillDiscountFields = Pick<
  BillRecord | BillSnapshotRecord,
  'bill_discount_type' | 'bill_discount_pct' | 'bill_discount_input'
>

export type BillItemTotalFields = Pick<
  BillItemRecord | BillSnapshotItemRecord,
  'qty' | 'unit_price' | 'taxable' | 'discount_type' | 'discount_pct' | 'discount_input' | 'status'
>

export interface BillTotalsView {
  readonly calc: SaleCalc
  readonly cashTotal: Money
  readonly roundingDelta: Money
  readonly activeItemCount: number
}

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

function toDiscountInput(
  type: 'PERCENT' | 'NOMINAL' | null,
  pct: string | null,
  input: number | null,
): DiscountInput | undefined {
  if (type === 'PERCENT' && pct) {
    return { kind: 'PERCENT', percent: pct }
  }
  if (type === 'NOMINAL' && input !== null && input >= 0) {
    return { kind: 'NOMINAL', amount: toMoney(input) }
  }
  return undefined
}

/**
 * Computes live bill subtotal, discounts, service charge, tax, grand total, and cash rounding
 * exclusively by delegating to shared `@pos/sales-calc` (`calcSale`) and kernel `roundCashDue`.
 */
export function computeBillTotals(input: {
  bill: BillDiscountFields
  items: readonly BillItemTotalFields[]
  config: SaleConfigSnapshot
  cashRoundingUnit: CashRoundingUnit
}): BillTotalsView {
  const activeItems = input.items.filter((it) => it.status === 'ACTIVE')
  if (activeItems.length === 0) {
    return {
      calc: EMPTY_CALC,
      cashTotal: ZERO,
      roundingDelta: ZERO,
      activeItemCount: 0,
    }
  }

  const lineInputs: CartLineInput[] = activeItems.map((it, idx) => ({
    lineNo: idx + 1,
    skuId: '00000000-0000-0000-0000-000000000001',
    uomId: '00000000-0000-0000-0000-000000000001',
    qty: it.qty as CartLineInput['qty'],
    unitPrice: toMoney(it.unit_price),
    taxable: it.taxable,
    discount: toDiscountInput(it.discount_type, it.discount_pct, it.discount_input),
  }))

  const saleInput: SaleCalcInput = {
    lines: lineInputs,
    billDiscount: toDiscountInput(
      input.bill.bill_discount_type,
      input.bill.bill_discount_pct,
      input.bill.bill_discount_input,
    ),
    config: input.config,
  }

  const calc = calcSale(saleInput)
  const cashTotal = toMoney(roundCashDue(calc.grandTotal, input.cashRoundingUnit))
  const roundingDelta = toMoney(cashTotal - calc.grandTotal)

  return {
    calc,
    cashTotal,
    roundingDelta,
    activeItemCount: activeItems.length,
  }
}
