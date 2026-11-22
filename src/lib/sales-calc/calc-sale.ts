import { percentOf, ratioRound, toMoney, ZERO, type Money } from '~/lib/kernel'
import { allocateComponentLR } from './allocate'
import { calcLineDiscount, calcLineGross, parsePercentScaled4 } from './line'
import {
  SalesCalcError,
  type LineCalc,
  type SaleCalc,
  type SaleCalcInput,
} from './types'

function addHundredDecimalString(ratePct: string): string {
  const scaled = parsePercentScaled4(ratePct)
  if (scaled === null) {
    throw new SalesCalcError('INVALID_CONFIG', `Invalid tax rate: "${ratePct}"`)
  }
  const totalScaled = 1_000_000n + scaled // (100 + rate) * 10^4
  const whole = totalScaled / 10_000n
  const frac = totalScaled % 10_000n
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(4, '0')}`
}

function assertNonNegMoney(val: number, label: string): void {
  if (!Number.isSafeInteger(val) || val < 0) {
    throw new SalesCalcError('INVARIANT', `Negative or unsafe ${label}: ${val}`)
  }
}

function assertInvariants(res: SaleCalc, priceTaxMode: 'INCLUSIVE' | 'EXCLUSIVE'): void {
  assertNonNegMoney(res.grossTotal, 'grossTotal')
  assertNonNegMoney(res.lineDiscountTotal, 'lineDiscountTotal')
  assertNonNegMoney(res.billDiscountTotal, 'billDiscountTotal')
  assertNonNegMoney(res.netSubtotal, 'netSubtotal')
  assertNonNegMoney(res.serviceCharge, 'serviceCharge')
  assertNonNegMoney(res.taxBase, 'taxBase')
  assertNonNegMoney(res.taxAmount, 'taxAmount')
  assertNonNegMoney(res.dpp, 'dpp')
  assertNonNegMoney(res.grandTotal, 'grandTotal')

  let sumGross = 0
  let sumLineDisc = 0
  let sumNet = 0
  let sumBillAlloc = 0
  let sumServiceAlloc = 0
  let sumTaxAlloc = 0
  let sumLineTotal = 0

  for (const l of res.lines) {
    assertNonNegMoney(l.lineGross, 'lineGross')
    assertNonNegMoney(l.lineDiscount, 'lineDiscount')
    assertNonNegMoney(l.lineNet, 'lineNet')
    assertNonNegMoney(l.billDiscountAlloc, 'billDiscountAlloc')
    assertNonNegMoney(l.serviceAlloc, 'serviceAlloc')
    assertNonNegMoney(l.taxAlloc, 'taxAlloc')
    assertNonNegMoney(l.lineTotal, 'lineTotal')
    sumGross += l.lineGross
    sumLineDisc += l.lineDiscount
    sumNet += l.lineNet
    sumBillAlloc += l.billDiscountAlloc
    sumServiceAlloc += l.serviceAlloc
    sumTaxAlloc += l.taxAlloc
    sumLineTotal += l.lineTotal
  }

  if (sumGross !== res.grossTotal || sumLineDisc !== res.lineDiscountTotal) {
    throw new SalesCalcError('INVARIANT', 'Line gross/discount sums mismatch header totals')
  }
  if (sumNet - res.billDiscountTotal !== res.netSubtotal) {
    throw new SalesCalcError('INVARIANT', 'S2 != S1 - D')
  }
  if (sumBillAlloc !== res.billDiscountTotal) {
    throw new SalesCalcError('INVARIANT', 'Sum of billDiscountAlloc != billDiscountTotal')
  }
  if (sumServiceAlloc !== res.serviceCharge) {
    throw new SalesCalcError('INVARIANT', 'Sum of serviceAlloc != serviceCharge')
  }
  if (sumTaxAlloc !== res.taxAmount) {
    throw new SalesCalcError('INVARIANT', 'Sum of taxAlloc != taxAmount')
  }
  if (sumLineTotal !== res.grandTotal) {
    throw new SalesCalcError('INVARIANT', 'Sum of lineTotal != grandTotal')
  }
  const expectedGrand =
    priceTaxMode === 'EXCLUSIVE'
      ? res.netSubtotal + res.serviceCharge + res.taxAmount
      : res.netSubtotal + res.serviceCharge
  if (res.grandTotal !== expectedGrand) {
    throw new SalesCalcError('INVARIANT', 'grandTotal inconsistent with S2/SC/tax')
  }
  if (priceTaxMode === 'INCLUSIVE' && res.dpp + res.taxAmount !== res.taxBase) {
    throw new SalesCalcError('INVARIANT', 'Inclusive dpp + taxAmount != taxBase')
  }
}

/**
 * Pure canonical bill calculation implementing BR-DSC-001..005 and BR-TAX-001..008:
 * line gross -> line discount -> bill discount & LR allocation -> service charge & LR allocation
 * -> tax base -> exclusive/inclusive tax & DPP -> tax LR allocation -> lineTotal & grandTotal.
 */
export function calcSale(input: SaleCalcInput): SaleCalc {
  if (input.lines.length === 0) {
    throw new SalesCalcError('EMPTY_CART', 'Cart must contain at least one line')
  }

  const { config } = input
  if (parsePercentScaled4(config.taxRate) === null) {
    throw new SalesCalcError('INVALID_CONFIG', `Invalid taxRate: "${config.taxRate}"`)
  }
  if (parsePercentScaled4(config.serviceChargeRate) === null) {
    throw new SalesCalcError('INVALID_CONFIG', `Invalid serviceChargeRate: "${config.serviceChargeRate}"`)
  }

  const seenLineNos = new Set<number>()
  const lineGrosses: Money[] = []
  const lineDiscounts: Money[] = []
  const lineNets: Money[] = []

  let grossTotalNum = 0
  let lineDiscountTotalNum = 0
  let s1Num = 0

  for (const line of input.lines) {
    if (!Number.isInteger(line.lineNo) || line.lineNo <= 0 || seenLineNos.has(line.lineNo)) {
      throw new SalesCalcError('INVALID_LINE', `Duplicate or invalid lineNo: ${line.lineNo}`)
    }
    seenLineNos.add(line.lineNo)

    const lg = calcLineGross(line.unitPrice, line.qty)
    const ld = calcLineDiscount(lg, line.discount)
    const ln = toMoney(lg - ld)

    lineGrosses.push(lg)
    lineDiscounts.push(ld)
    lineNets.push(ln)
    grossTotalNum += lg
    lineDiscountTotalNum += ld
    s1Num += ln
  }

  const grossTotal = toMoney(grossTotalNum)
  const lineDiscountTotal = toMoney(lineDiscountTotalNum)
  const s1 = toMoney(s1Num)

  const billDiscountTotal = calcLineDiscount(s1, input.billDiscount)
  const netSubtotal = toMoney(s1 - billDiscountTotal)
  // LR ties are decided by line number (BR-MNY-006), not array position: the result does not depend on presentation order.
  const tieRank = input.lines.map((l) => l.lineNo)
  const billDiscountAlloc = allocateComponentLR(billDiscountTotal, lineNets, tieRank)

  const weightsS2 = lineNets.map((ln, idx) => ln - billDiscountAlloc[idx]!)
  const serviceCharge = config.serviceChargeEnabled
    ? percentOf(netSubtotal, config.serviceChargeRate)
    : ZERO
  const serviceAlloc = allocateComponentLR(serviceCharge, weightsS2, tieRank)

  // Tax base & allocation weights (non-taxable lines ALWAYS receive weight 0)
  let productTaxBaseNum = 0
  const taxWeights: number[] = []
  let sumTaxWeights = 0

  for (let i = 0; i < input.lines.length; i += 1) {
    if (input.lines[i]!.taxable) {
      productTaxBaseNum += weightsS2[i]!
      const w = weightsS2[i]! + (config.serviceChargeTaxable ? serviceAlloc[i]! : 0)
      taxWeights.push(w)
      sumTaxWeights += w
    } else {
      taxWeights.push(0)
    }
  }

  let taxBase = ZERO
  let taxAmount = ZERO
  let dpp = ZERO

  if (sumTaxWeights > 0) {
    taxBase = toMoney(productTaxBaseNum + (config.serviceChargeTaxable ? serviceCharge : 0))
    if (config.taxProfile === 'NONE') {
      taxAmount = ZERO
      dpp = taxBase
    } else if (config.priceTaxMode === 'EXCLUSIVE') {
      taxAmount = percentOf(taxBase, config.taxRate)
      dpp = taxBase
    } else {
      const denom = addHundredDecimalString(config.taxRate)
      taxAmount = ratioRound(taxBase, config.taxRate, denom)
      dpp = toMoney(taxBase - taxAmount)
    }
  }

  const taxAlloc =
    sumTaxWeights > 0 ? allocateComponentLR(taxAmount, taxWeights, tieRank) : input.lines.map(() => ZERO)

  const grandTotal =
    config.priceTaxMode === 'EXCLUSIVE'
      ? toMoney(netSubtotal + serviceCharge + taxAmount)
      : toMoney(netSubtotal + serviceCharge)

  const lines: LineCalc[] = input.lines.map((line, i) => ({
    lineNo: line.lineNo,
    lineGross: lineGrosses[i]!,
    lineDiscount: lineDiscounts[i]!,
    lineNet: lineNets[i]!,
    billDiscountAlloc: billDiscountAlloc[i]!,
    serviceAlloc: serviceAlloc[i]!,
    taxAlloc: taxAlloc[i]!,
    lineTotal: toMoney(
      weightsS2[i]! + serviceAlloc[i]! + (config.priceTaxMode === 'EXCLUSIVE' ? taxAlloc[i]! : 0),
    ),
  }))

  const result: SaleCalc = {
    lines,
    grossTotal,
    lineDiscountTotal,
    billDiscountTotal,
    netSubtotal,
    serviceCharge,
    taxBase,
    taxAmount,
    dpp,
    grandTotal,
  }

  assertInvariants(result, config.priceTaxMode)
  return result
}
