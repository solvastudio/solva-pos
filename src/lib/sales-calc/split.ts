import { addMoney, toMoney, ZERO, type Money } from '~/lib/kernel'
import { allocateComponentLR } from './allocate'
import { calcSale } from './calc-sale'
import { SalesCalcError, type CartLineInput, type DiscountInput, type SaleCalc, type SaleCalcInput } from './types'

export interface EqualSplitShare {
  readonly shareIndex: number
  readonly shareCount: number
  readonly calc: Omit<SaleCalc, 'lines'>
}

export interface EqualSplitResult {
  readonly parent: SaleCalc
  readonly shareCount: number
  readonly shares: readonly EqualSplitShare[]
}

export interface GroupSplitResult {
  readonly parent: SaleCalc
  readonly children: readonly SaleCalc[]
}

function rotatedTieRank(count: number, offset: number): number[] {
  const normOffset = ((offset % count) + count) % count
  return Array.from({ length: count }, (_, idx) => (idx - normOffset + count) % count)
}

/**
 * Splits a bill equally into `shareCount` (>= 2) shares using Largest Remainder allocation.
 * Rotates tie-breaking offsets across additive components so every share keeps
 * `abs(grandTotal_i - grandTotal_j) <= 1`, exact component invariants, and zero rounding leakage.
 */
export function calcEqualSplit(parentInput: SaleCalcInput, shareCount: number): EqualSplitResult {
  if (!Number.isSafeInteger(shareCount) || shareCount < 2) {
    throw new SalesCalcError('INVALID_CONFIG', `shareCount must be an integer >= 2, got ${shareCount}`)
  }

  const parent = calcSale(parentInput)
  const weights = Array.from({ length: shareCount }, () => 1)
  const isExclusive = parentInput.config.priceTaxMode === 'EXCLUSIVE'
  const scTaxable = parentInput.config.serviceChargeTaxable

  const netAllocs = allocateComponentLR(parent.netSubtotal, weights, rotatedTieRank(shareCount, 0))
  const scOffset = parent.netSubtotal % shareCount
  const scAllocs = allocateComponentLR(parent.serviceCharge, weights, rotatedTieRank(shareCount, scOffset))

  const taxOffset = isExclusive ? (parent.netSubtotal + parent.serviceCharge) % shareCount : 0
  const taxAllocs = allocateComponentLR(parent.taxAmount, weights, rotatedTieRank(shareCount, taxOffset))

  const lineDiscAllocs = allocateComponentLR(parent.lineDiscountTotal, weights)
  const billDiscAllocs = allocateComponentLR(parent.billDiscountTotal, weights)

  const shares: EqualSplitShare[] = []
  for (let i = 0; i < shareCount; i += 1) {
    const netSubtotal = netAllocs[i]!
    const serviceCharge = scAllocs[i]!
    const taxAmount = taxAllocs[i]!
    const lineDiscountTotal = lineDiscAllocs[i]!
    const billDiscountTotal = billDiscAllocs[i]!
    const grossTotal = addMoney(netSubtotal, addMoney(lineDiscountTotal, billDiscountTotal))
    const taxBase = scTaxable ? addMoney(netSubtotal, serviceCharge) : netSubtotal
    const dpp = isExclusive ? taxBase : toMoney(taxBase - taxAmount)
    const grandTotal = isExclusive
      ? addMoney(addMoney(netSubtotal, serviceCharge), taxAmount)
      : addMoney(netSubtotal, serviceCharge)

    shares.push({
      shareIndex: i + 1,
      shareCount,
      calc: {
        grossTotal,
        lineDiscountTotal,
        billDiscountTotal,
        netSubtotal,
        serviceCharge,
        taxBase,
        taxAmount,
        dpp,
        grandTotal,
      },
    })
  }

  return {
    parent,
    shareCount,
    shares,
  }
}

/**
 * Computes child bill totals for ITEM or QTY splits using canonical `calcSale` per group.
 * Percent bill discounts apply at the same rate per child; nominal bill discounts are
 * allocated proportionally by each child's pre-bill-discount net total via LR.
 */
export function calcGroupSplit(
  parentInput: SaleCalcInput,
  groups: readonly (readonly CartLineInput[])[],
): GroupSplitResult {
  if (groups.length < 2) {
    throw new SalesCalcError('INVALID_CONFIG', 'Split requires at least 2 child groups')
  }
  for (const g of groups) {
    if (g.length === 0) {
      throw new SalesCalcError('EMPTY_CART', 'Each split child group must contain at least 1 line')
    }
  }

  const parent = calcSale(parentInput)
  const billDisc = parentInput.billDiscount

  let perGroupDiscount: readonly (DiscountInput | undefined)[]
  if (!billDisc) {
    perGroupDiscount = groups.map(() => undefined)
  } else if (billDisc.kind === 'PERCENT') {
    perGroupDiscount = groups.map(() => billDisc)
  } else {
    const preNets = groups.map((lines) => calcSale({ lines, config: parentInput.config }).netSubtotal)
    const totalPreNet = preNets.reduce((a, b) => a + b, 0)
    const cappedNominal: Money = toMoney(Math.min(billDisc.amount, totalPreNet))
    const allocs =
      totalPreNet > 0
        ? allocateComponentLR(cappedNominal, preNets)
        : groups.map(() => ZERO)
    perGroupDiscount = allocs.map((amount) => (amount > 0 ? { kind: 'NOMINAL', amount } : undefined))
  }

  const children = groups.map((lines, idx) =>
    calcSale({
      lines,
      billDiscount: perGroupDiscount[idx],
      config: parentInput.config,
    }),
  )

  return { parent, children }
}
