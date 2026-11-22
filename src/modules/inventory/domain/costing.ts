import {
  addMoney,
  addQty,
  cmpQty,
  D,
  isPositiveQty,
  negMoney,
  parseQty,
  proRate,
  QtyError,
  qtyToDecimal,
  subMoney,
  subQty,
  toMoney,
  type Money,
  type Qty,
} from '~/lib/kernel'

/**
 * Moving-average costing engine (BR-HPP-001..005, BR-STK-030/032). Pure: no I/O, no clock.
 * The balance is stored as quantity + inventory value; the average cost is NOT stored (recomputed).
 * `rev` is not changed here — incrementing it belongs to the ledger applier (BR-STK-006).
 */

export type CostBasis = 'AVERAGE' | 'REFERENCE' | 'MIXED' | 'SNAPSHOT' | 'TRANSFER' | 'DECLARED'

export interface StockBalance {
  readonly qty: Qty
  readonly inventoryValue: Money
  /** Reference cost numerator: the value at the last time qty was > 0 (BR-HPP-005). */
  readonly refValue: Money
  /** Reference cost denominator: the qty at that same time. */
  readonly refQty: Qty
  readonly rev: number
}

export interface CostResult {
  /** Sign: outgoing → ≤ 0; incoming → ≥ 0 (except closing a negative balance). */
  readonly valueDelta: Money
  readonly next: StockBalance
  readonly costBasis: CostBasis
  readonly isNegativeResult: boolean
  readonly qtyAfter: Qty
  readonly valueAfter: Money
  /** True when the outgoing movement uses an empty reference (no positive balance has ever existed); COGS = 0. */
  readonly noReference: boolean
}

export const ZERO_QTY: Qty = parseQty('0')

export function emptyBalance(): StockBalance {
  return { qty: ZERO_QTY, inventoryValue: toMoney(0), refValue: toMoney(0), refQty: ZERO_QTY, rev: 0 }
}

function requirePositive(q: Qty, label: string): void {
  if (!isPositiveQty(q)) {
    throw new QtyError('NOT_POSITIVE', `${label} must be greater than 0: "${q}"`)
  }
}

/** After every movement: the reference is updated only when the new balance is > 0 (BR-HPP-005). */
function withReference(
  next: Pick<StockBalance, 'qty' | 'inventoryValue' | 'rev'>,
  prev: StockBalance,
): StockBalance {
  if (cmpQty(next.qty, ZERO_QTY) > 0) {
    return { ...next, refValue: next.inventoryValue, refQty: next.qty }
  }
  return { ...next, refValue: prev.refValue, refQty: prev.refQty }
}

function assertInvariant(next: StockBalance): void {
  if (cmpQty(next.qty, ZERO_QTY) === 0 && next.inventoryValue !== 0) {
    throw new Error(`costing invariant violated: qty 0 with value ${next.inventoryValue}`)
  }
}

/**
 * Outgoing `qtyOut` (> 0) under rules BR-HPP-003/005:
 * - balance > 0 and sufficient ⇒ AVERAGE (fully used ⇒ the whole value);
 * - balance > 0 but insufficient ⇒ MIXED (the shortfall is costed at the reference cost);
 * - balance ≤ 0 ⇒ REFERENCE.
 */
export function applyOut(b: StockBalance, qtyOut: Qty): CostResult {
  requirePositive(qtyOut, 'qtyOut')

  let hpp: Money
  let basis: CostBasis
  let noReference = false

  if (cmpQty(b.qty, ZERO_QTY) > 0 && cmpQty(qtyOut, b.qty) <= 0) {
    hpp = cmpQty(qtyOut, b.qty) === 0 ? b.inventoryValue : proRate(b.inventoryValue, qtyOut, b.qty)
    basis = 'AVERAGE'
  } else if (cmpQty(b.qty, ZERO_QTY) > 0) {
    // MIXED: the whole positive balance is consumed; the shortfall uses the reference cost.
    const short = subQty(qtyOut, b.qty)
    let hpp2: Money = toMoney(0)
    if (cmpQty(b.refQty, ZERO_QTY) > 0) {
      hpp2 = proRate(b.refValue, short, b.refQty)
    } else {
      noReference = true
    }
    hpp = addMoney(b.inventoryValue, hpp2)
    basis = 'MIXED'
  } else {
    // REFERENCE: zero or negative balance; the whole outgoing quantity uses the reference cost.
    hpp = cmpQty(b.refQty, ZERO_QTY) > 0 ? proRate(b.refValue, qtyOut, b.refQty) : toMoney(0)
    if (cmpQty(b.refQty, ZERO_QTY) === 0) noReference = true
    basis = 'REFERENCE'
  }

  const qtyAfter = subQty(b.qty, qtyOut)
  const valueAfter = cmpQty(qtyAfter, ZERO_QTY) === 0 ? toMoney(0) : subMoney(b.inventoryValue, hpp)
  const next = withReference(
    { qty: qtyAfter, inventoryValue: valueAfter, rev: b.rev },
    b,
  )
  assertInvariant(next)

  return {
    valueDelta: negMoney(hpp),
    next,
    costBasis: basis,
    isNegativeResult: cmpQty(qtyAfter, ZERO_QTY) < 0,
    qtyAfter,
    valueAfter,
    noReference,
  }
}

/** Addition with an explicit value (used by applyIn and adjustments). Zero balance ⇒ value forced to 0. */
function addWithValue(b: StockBalance, qtyIn: Qty, valueIn: Money, basis: CostBasis): CostResult {
  const qtyAfter = addQty(b.qty, qtyIn)
  let valueDelta: Money = valueIn
  let valueAfter: Money
  if (cmpQty(qtyAfter, ZERO_QTY) === 0) {
    // Balance exactly zero: the value that brings the balance to 0 (BR-STK-032).
    valueDelta = negMoney(b.inventoryValue)
    valueAfter = toMoney(0)
  } else {
    valueAfter = addMoney(b.inventoryValue, valueIn)
  }
  const next = withReference({ qty: qtyAfter, inventoryValue: valueAfter, rev: b.rev }, b)
  assertInvariant(next)
  return {
    valueDelta,
    next,
    costBasis: basis,
    isNegativeResult: cmpQty(qtyAfter, ZERO_QTY) < 0,
    qtyAfter,
    valueAfter,
    noReference: false,
  }
}

/** Incoming with a value supplied by the caller (GR, transfer, return). Also applies when the balance is negative. */
export function applyIn(
  b: StockBalance,
  qtyIn: Qty,
  valueIn: Money,
  basis: 'DECLARED' | 'TRANSFER' | 'SNAPSHOT',
): CostResult {
  requirePositive(qtyIn, 'qtyIn')
  return addWithValue(b, qtyIn, valueIn, basis)
}

/**
 * Incoming on a balance ≤ 0 valued at the reference cost (BR-HPP-005): `R(refValue × qtyIn / refQty)`,
 * zero when the reference is empty.
 */
/**
 * Outgoing with a predetermined value (GR reversal, BR-STK-022): qty decreases by `qtyOut`,
 * value decreases by exactly `valueOut` (not the average). The balance may go negative (not rejected). When the balance
 * becomes 0, the value is forced to 0 and `valueDelta` carries the remaining value to 0 (the difference is recorded on the movement).
 */
export function applyReversalAtValue(b: StockBalance, qtyOut: Qty, valueOut: Money): CostResult {
  requirePositive(qtyOut, 'qtyOut')
  if (valueOut < 0) {
    throw new QtyError('NOT_POSITIVE', 'valueOut must not be negative')
  }
  const qtyAfter = subQty(b.qty, qtyOut)
  let valueDelta: Money = negMoney(valueOut)
  let valueAfter: Money = subMoney(b.inventoryValue, valueOut)
  if (cmpQty(qtyAfter, ZERO_QTY) === 0) {
    valueDelta = negMoney(b.inventoryValue)
    valueAfter = toMoney(0)
  }
  const next = withReference({ qty: qtyAfter, inventoryValue: valueAfter, rev: b.rev }, b)
  assertInvariant(next)
  return {
    valueDelta,
    next,
    costBasis: 'DECLARED',
    isNegativeResult: cmpQty(qtyAfter, ZERO_QTY) < 0,
    qtyAfter,
    valueAfter,
    noReference: false,
  }
}

export function applyInAtReference(b: StockBalance, qtyIn: Qty): CostResult {
  requirePositive(qtyIn, 'qtyIn')
  const valueIn = cmpQty(b.refQty, ZERO_QTY) > 0 ? proRate(b.refValue, qtyIn, b.refQty) : toMoney(0)
  return addWithValue(b, qtyIn, valueIn, 'REFERENCE')
}

/**
 * Adjustment (stocktake, BR-STK-030/032). `delta < 0` ⇒ outgoing `|delta|` (AVERAGE/MIXED/REFERENCE).
 * `delta > 0` ⇒ value `R(value × delta / qty)` when the balance > 0, or `delta × reference cost` when ≤ 0.
 */
export function applyAdjustment(b: StockBalance, delta: Qty): CostResult {
  if (qtyToDecimal(delta).isZero()) {
    throw new QtyError('NOT_POSITIVE', 'adjustment delta must not be zero')
  }
  if (qtyToDecimal(delta).isNegative()) {
    return applyOut(b, parseQty(qtyToDecimal(delta).negated().toFixed()))
  }
  if (cmpQty(b.qty, ZERO_QTY) > 0) {
    const valueIn = proRate(b.inventoryValue, delta, b.qty)
    return addWithValue(b, delta, valueIn, 'DECLARED')
  }
  const valueIn = cmpQty(b.refQty, ZERO_QTY) > 0 ? proRate(b.refValue, delta, b.refQty) : toMoney(0)
  return addWithValue(b, delta, valueIn, 'REFERENCE')
}

/** Last reference cost (ref_value / ref_qty) used for calculation; not stored as a fraction. */
export function referenceUnit(b: StockBalance): { value: Money; qty: Qty } {
  return { value: b.refValue, qty: b.refQty }
}

/** Average cost for DISPLAY only: value ÷ qty to 2 decimals (half-up). `null` when balance ≤ 0. */
export function averageCostForDisplay(b: StockBalance): string | null {
  if (cmpQty(b.qty, ZERO_QTY) <= 0) return null
  return new D(b.inventoryValue).div(qtyToDecimal(b.qty)).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2)
}
