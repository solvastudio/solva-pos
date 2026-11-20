import type { CashRoundingUnit } from '~/lib/kernel'
import { calcAndSettle } from './full-sale'
import { calcCreditNote } from './return'
import type {
  CreditNoteInput,
  FigureDiff,
  PaymentInput,
  SaleCalcInput,
  StoredCreditNoteFigures,
  StoredSaleFigures,
  VerifyResult,
} from './types'

function pushDiff(
  diffs: FigureDiff[],
  path: string,
  expected: number,
  actual: number,
): void {
  if (expected !== actual) {
    diffs.push({ path, expected, actual })
  }
}

/**
 * Server-side non-mutating verification of client-persisted sale figures (BR-MNY-007, EC-029).
 * Replays `calcAndSettle` from identical snapshots and records any field-level discrepancy
 * without mutating client amounts.
 */
export function verifySale(input: {
  input: SaleCalcInput
  payments: readonly PaymentInput[]
  cashRoundingUnit: CashRoundingUnit
  stored: StoredSaleFigures
}): VerifyResult {
  const { calc, settlement } = calcAndSettle(input.input, input.payments, input.cashRoundingUnit)
  const diffs: FigureDiff[] = []

  pushDiff(diffs, 'grossTotal', calc.grossTotal, input.stored.grossTotal)
  pushDiff(diffs, 'lineDiscountTotal', calc.lineDiscountTotal, input.stored.lineDiscountTotal)
  pushDiff(diffs, 'billDiscountTotal', calc.billDiscountTotal, input.stored.billDiscountTotal)
  pushDiff(diffs, 'netSubtotal', calc.netSubtotal, input.stored.netSubtotal)
  pushDiff(diffs, 'serviceCharge', calc.serviceCharge, input.stored.serviceCharge)
  pushDiff(diffs, 'taxBase', calc.taxBase, input.stored.taxBase)
  pushDiff(diffs, 'taxAmount', calc.taxAmount, input.stored.taxAmount)
  pushDiff(diffs, 'dpp', calc.dpp, input.stored.dpp)
  pushDiff(diffs, 'grandTotal', calc.grandTotal, input.stored.grandTotal)
  pushDiff(diffs, 'rounding', settlement.rounding, input.stored.rounding)
  pushDiff(diffs, 'totalDue', settlement.totalDue, input.stored.totalDue)

  pushDiff(diffs, 'lines.length', calc.lines.length, input.stored.lines.length)
  const commonLen = Math.min(calc.lines.length, input.stored.lines.length)
  for (let i = 0; i < commonLen; i += 1) {
    const exp = calc.lines[i]!
    const act = input.stored.lines[i]!
    pushDiff(diffs, `lines[${i}].lineNo`, exp.lineNo, act.lineNo)
    pushDiff(diffs, `lines[${i}].lineGross`, exp.lineGross, act.lineGross)
    pushDiff(diffs, `lines[${i}].lineDiscount`, exp.lineDiscount, act.lineDiscount)
    pushDiff(diffs, `lines[${i}].lineNet`, exp.lineNet, act.lineNet)
    pushDiff(diffs, `lines[${i}].billDiscountAlloc`, exp.billDiscountAlloc, act.billDiscountAlloc)
    pushDiff(diffs, `lines[${i}].serviceAlloc`, exp.serviceAlloc, act.serviceAlloc)
    pushDiff(diffs, `lines[${i}].taxAlloc`, exp.taxAlloc, act.taxAlloc)
    pushDiff(diffs, `lines[${i}].lineTotal`, exp.lineTotal, act.lineTotal)
  }

  return { ok: diffs.length === 0, diffs }
}

/**
 * Server-side non-mutating verification of client-persisted credit note figures (BR-RTR-006).
 */
export function verifyCreditNote(input: CreditNoteInput & { stored: StoredCreditNoteFigures }): VerifyResult {
  const expected = calcCreditNote({
    lines: input.lines,
    priceTaxMode: input.priceTaxMode,
    refund: input.refund,
  })
  const diffs: FigureDiff[] = []

  pushDiff(diffs, 'netTotal', expected.netTotal, input.stored.netTotal)
  pushDiff(diffs, 'scTotal', expected.scTotal, input.stored.scTotal)
  pushDiff(diffs, 'taxTotal', expected.taxTotal, input.stored.taxTotal)
  pushDiff(diffs, 'refundGross', expected.refundGross, input.stored.refundGross)
  pushDiff(
    diffs,
    'refundCashApplied',
    expected.refundCashApplied ?? -1,
    input.stored.refundCashApplied ?? -1,
  )
  pushDiff(diffs, 'rounding', expected.rounding, input.stored.rounding)

  pushDiff(diffs, 'lines.length', expected.lines.length, input.stored.lines.length)
  const commonLen = Math.min(expected.lines.length, input.stored.lines.length)
  for (let i = 0; i < commonLen; i += 1) {
    const exp = expected.lines[i]!
    const act = input.stored.lines[i]!
    pushDiff(diffs, `lines[${i}].net`, exp.net, act.net)
    pushDiff(diffs, `lines[${i}].sc`, exp.sc, act.sc)
    pushDiff(diffs, `lines[${i}].tax`, exp.tax, act.tax)
    pushDiff(diffs, `lines[${i}].isLast`, exp.isLast ? 1 : 0, act.isLast ? 1 : 0)
  }

  return { ok: diffs.length === 0, diffs }
}
