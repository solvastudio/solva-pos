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
 * Mesin costing moving average (BR-HPP-001..005, BR-STK-030/032). Murni: tanpa I/O, tanpa waktu.
 * Saldo disimpan sebagai kuantitas + nilai persediaan; biaya rata-rata TIDAK disimpan (dihitung ulang).
 * `rev` tidak diubah di sini — penaikannya milik penerap ledger (BR-STK-006).
 */

export type CostBasis = 'AVERAGE' | 'REFERENCE' | 'MIXED' | 'SNAPSHOT' | 'TRANSFER' | 'DECLARED'

export interface StockBalance {
  readonly qty: Qty
  readonly inventoryValue: Money
  /** Biaya referensi pembilang: nilai pada saat terakhir qty > 0 (BR-HPP-005). */
  readonly refValue: Money
  /** Biaya referensi penyebut: qty pada saat yang sama. */
  readonly refQty: Qty
  readonly rev: number
}

export interface CostResult {
  /** Bertanda: keluar → ≤ 0; masuk → ≥ 0 (kecuali penutupan saldo negatif). */
  readonly valueDelta: Money
  readonly next: StockBalance
  readonly costBasis: CostBasis
  readonly isNegativeResult: boolean
  readonly qtyAfter: Qty
  readonly valueAfter: Money
  /** Benar bila keluar memakai referensi kosong (saldo positif belum pernah ada); HPP = 0. */
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

/** Setelah setiap movement: referensi diperbarui hanya bila saldo baru > 0 (BR-HPP-005). */
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
 * Keluar `qtyOut` (> 0) dengan aturan BR-HPP-003/005:
 * - saldo > 0 dan cukup ⇒ AVERAGE (habis ⇒ seluruh nilai);
 * - saldo > 0 tetapi kurang ⇒ MIXED (sisa kekurangan dengan biaya referensi);
 * - saldo ≤ 0 ⇒ REFERENCE.
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
    // MIXED: seluruh saldo positif tertutup, sisa kekurangan memakai biaya referensi.
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
    // REFERENCE: saldo nol/negatif, seluruh keluar pada biaya referensi.
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

/** Penambahan dengan nilai eksplisit (dipakai applyIn dan penyesuaian). Saldo nol ⇒ nilai dipaksa 0. */
function addWithValue(b: StockBalance, qtyIn: Qty, valueIn: Money, basis: CostBasis): CostResult {
  const qtyAfter = addQty(b.qty, qtyIn)
  let valueDelta: Money = valueIn
  let valueAfter: Money
  if (cmpQty(qtyAfter, ZERO_QTY) === 0) {
    // Saldo tepat nol: nilai yang membawa saldo ke 0 (BR-STK-032).
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

/** Masuk dengan nilai yang diberikan pemanggil (GR, transfer, retur). Berlaku juga saat saldo negatif. */
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
 * Masuk pada saldo ≤ 0 dengan nilai biaya referensi (BR-HPP-005): `R(refValue × qtyIn / refQty)`,
 * nol bila referensi kosong.
 */
/**
 * Keluar dengan nilai yang sudah ditetapkan (pembalikan GR, BR-STK-022): qty berkurang `qtyOut`,
 * nilai berkurang persis `valueOut` (bukan rata-rata). Saldo boleh negatif (tidak ditolak). Bila saldo
 * menjadi 0, nilai dipaksa 0 dan `valueDelta` membawa sisa nilai ke 0 (selisih tercatat di movement).
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
 * Penyesuaian (opname, BR-STK-030/032). `delta < 0` ⇒ keluar `|delta|` (AVERAGE/MIXED/REFERENCE).
 * `delta > 0` ⇒ nilai `R(value × delta / qty)` bila saldo > 0, atau `delta × biaya referensi` bila ≤ 0.
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

/** Biaya referensi terakhir (ref_value / ref_qty) untuk perhitungan; tidak disimpan sebagai pecahan. */
export function referenceUnit(b: StockBalance): { value: Money; qty: Qty } {
  return { value: b.refValue, qty: b.refQty }
}

/** Biaya rata-rata untuk TAMPILAN saja: nilai ÷ qty dengan 2 desimal (half-up). `null` bila saldo ≤ 0. */
export function averageCostForDisplay(b: StockBalance): string | null {
  if (cmpQty(b.qty, ZERO_QTY) <= 0) return null
  return new D(b.inventoryValue).div(qtyToDecimal(b.qty)).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2)
}
