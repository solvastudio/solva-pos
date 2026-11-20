import {
  addQty,
  cmpQty,
  parseQty,
  ratioRound,
  returnWindowEnd,
  roundToUnit,
  toMoney,
  ZERO,
  type Money,
} from '~/lib/kernel'
import {
  ReturnError,
  type CreditNoteCalc,
  type CreditNoteInput,
  type ReturnLineCalc,
  type ReturnLineInput,
} from './types'

const ZERO_QTY = parseQty('0')

function assertNonNegMoneyInt(val: number, label: string): void {
  if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 0) {
    throw new ReturnError('INVALID_AMOUNT', `${label} must be integer >= 0: ${val}`)
  }
}

/**
 * Checks the 3-calendar-month POS return eligibility window (BR-RTR-003, V-23).
 */
export function isWithinReturnWindow(
  invoiceBusinessDate: string,
  todayBusinessDate: string,
): boolean {
  const windowEnd = returnWindowEnd(invoiceBusinessDate, 3)
  return todayBusinessDate >= invoiceBusinessDate && todayBusinessDate <= windowEnd
}

/**
 * Computes proportional return amounts from stored original line components,
 * giving exact residual remainder on the final returning quantity (BR-RTR-006, V-18).
 */
export function calcReturnLine(input: ReturnLineInput): ReturnLineCalc {
  if (
    cmpQty(input.qtySold, ZERO_QTY) <= 0 ||
    cmpQty(input.qtyAlreadyReturned, ZERO_QTY) < 0 ||
    cmpQty(input.qtyReturn, ZERO_QTY) <= 0
  ) {
    throw new ReturnError('INVALID_QTY', 'Return quantities must satisfy qtySold > 0, qtyReturn > 0, alreadyReturned >= 0')
  }

  assertNonNegMoneyInt(input.originalNet, 'originalNet')
  assertNonNegMoneyInt(input.originalScAlloc, 'originalScAlloc')
  assertNonNegMoneyInt(input.originalTaxAlloc, 'originalTaxAlloc')
  assertNonNegMoneyInt(input.returnedSoFar.net, 'returnedSoFar.net')
  assertNonNegMoneyInt(input.returnedSoFar.sc, 'returnedSoFar.sc')
  assertNonNegMoneyInt(input.returnedSoFar.tax, 'returnedSoFar.tax')

  if (
    input.returnedSoFar.net > input.originalNet ||
    input.returnedSoFar.sc > input.originalScAlloc ||
    input.returnedSoFar.tax > input.originalTaxAlloc
  ) {
    throw new ReturnError('INVALID_AMOUNT', 'Returned-so-far totals exceed original line amounts')
  }

  const newTotalReturned = addQty(input.qtyAlreadyReturned, input.qtyReturn)
  const cmp = cmpQty(newTotalReturned, input.qtySold)
  if (cmp > 0) {
    throw new ReturnError(
      'EXCEEDS_QTY',
      `Cumulative return qty ${newTotalReturned} exceeds sold qty ${input.qtySold}`,
    )
  }

  const isLast = cmp === 0
  if (isLast) {
    const net = toMoney(input.originalNet - input.returnedSoFar.net)
    const sc = toMoney(input.originalScAlloc - input.returnedSoFar.sc)
    const tax = toMoney(input.originalTaxAlloc - input.returnedSoFar.tax)
    return { net, sc, tax, isLast: true }
  }

  // Clamp intermediate ratio-rounded slices to remaining balance so repeated small
  // partial returns that round HALF_UP cannot overshoot the original line component.
  const net = toMoney(
    Math.min(
      ratioRound(input.originalNet, input.qtyReturn, input.qtySold),
      input.originalNet - input.returnedSoFar.net,
    ),
  )
  const sc = toMoney(
    Math.min(
      ratioRound(input.originalScAlloc, input.qtyReturn, input.qtySold),
      input.originalScAlloc - input.returnedSoFar.sc,
    ),
  )
  const tax = toMoney(
    Math.min(
      ratioRound(input.originalTaxAlloc, input.qtyReturn, input.qtySold),
      input.originalTaxAlloc - input.returnedSoFar.tax,
    ),
  )
  return { net, sc, tax, isLast: false }
}

/**
 * Computes full credit note totals and optional cash refund rounding from stored invoice line splits.
 */
export function calcCreditNote(input: CreditNoteInput): CreditNoteCalc {
  if (input.lines.length === 0) {
    throw new ReturnError('EMPTY', 'Credit note must include at least one return line')
  }

  const lines = input.lines.map(calcReturnLine)
  let netTotalNum = 0
  let scTotalNum = 0
  let taxTotalNum = 0

  for (const l of lines) {
    netTotalNum += l.net
    scTotalNum += l.sc
    taxTotalNum += l.tax
  }

  const netTotal = toMoney(netTotalNum)
  const scTotal = toMoney(scTotalNum)
  const taxTotal = toMoney(taxTotalNum)

  const refundGross: Money =
    input.priceTaxMode === 'EXCLUSIVE'
      ? toMoney(netTotal + scTotal + taxTotal)
      : toMoney(netTotal + scTotal)

  if (input.refund.method === 'CASH') {
    const refundCashApplied = roundToUnit(refundGross, input.refund.cashRoundingUnit)
    const rounding = toMoney(refundCashApplied - refundGross)
    return {
      lines,
      netTotal,
      scTotal,
      taxTotal,
      refundGross,
      refundCashApplied,
      rounding,
    }
  }

  return {
    lines,
    netTotal,
    scTotal,
    taxTotal,
    refundGross,
    refundCashApplied: null,
    rounding: ZERO,
  }
}
