import { toMoney, type Money } from './money'
import { D, type KernelDecimal, qtyToDecimal, type Qty } from './qty'

const PERCENT_PATTERN = /^-?\d+(?:\.\d{1,4})?$/

/**
 * Symmetric half-up rounding (BR-MNY-004):
 * for x >= 0, exact `.5` rounds up; for x < 0, `R(-x) = -R(x)`.
 */
export function roundHalfUp(x: KernelDecimal): Money {
  const rounded = x.isNegative()
    ? x.abs().toDecimalPlaces(0, D.ROUND_HALF_UP).neg()
    : x.toDecimalPlaces(0, D.ROUND_HALF_UP)
  return toMoney(rounded.toNumber())
}

/** R(unit * q) per BR-MNY-004. */
export function mulRound(unit: Money, q: Qty): Money {
  return roundHalfUp(new D(unit).times(qtyToDecimal(q)))
}

/** R(base * percent / 100) with scale-4 percentage string e.g. `"11.0000"`. */
export function percentOf(base: Money, percent: string): Money {
  if (typeof percent !== 'string' || !PERCENT_PATTERN.test(percent)) {
    throw new RangeError(`Invalid percentage format: "${String(percent)}"`)
  }
  return roundHalfUp(new D(base).times(new D(percent)).div(100))
}

/**
 * Largest Remainder allocation (BR-MNY-006):
 * `total >= 0`, all `weights[i] >= 0` safe integers, `sum(weights) > 0`.
 * Fractional ties are broken in favor of smaller indices (stable).
 */
export function allocateLR(total: Money, weights: readonly number[]): Money[] {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError(`LR allocation total must be an integer >= 0: ${total}`)
  }
  if (weights.length === 0) {
    throw new RangeError('LR allocation weights list must not be empty')
  }

  const totalBig = BigInt(total)
  const weightBigs: bigint[] = []
  let sumWeights = 0n

  for (const w of weights) {
    if (typeof w !== 'number' || !Number.isSafeInteger(w) || w < 0) {
      throw new RangeError(`Each LR allocation weight must be a safe integer >= 0: ${w}`)
    }
    const wb = BigInt(w)
    weightBigs.push(wb)
    sumWeights += wb
  }

  if (sumWeights === 0n) {
    throw new RangeError('Sum of all LR allocation weights must be > 0')
  }

  const base: bigint[] = new Array(weights.length)
  const remainders: bigint[] = new Array(weights.length)
  let sumBase = 0n

  for (let i = 0; i < weightBigs.length; i += 1) {
    const numer = totalBig * weightBigs[i]!
    const q = numer / sumWeights
    base[i] = q
    remainders[i] = numer % sumWeights
    sumBase += q
  }

  const left = Number(totalBig - sumBase)
  if (left > 0) {
    const order = Array.from({ length: weights.length }, (_, idx) => idx)
    order.sort((a, b) => {
      const ra = remainders[a]!
      const rb = remainders[b]!
      if (rb > ra) return 1
      if (rb < ra) return -1
      return a - b
    })

    for (let k = 0; k < left; k += 1) {
      const targetIdx = order[k]!
      base[targetIdx] = base[targetIdx]! + 1n
    }
  }

  return base.map((v) => toMoney(Number(v)))
}

/** Largest Remainder allocation with `n` equal weights (V-02). */
export function allocateEqual(total: Money, n: number): Money[] {
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new RangeError(`allocateEqual parts count must be an integer > 0: ${n}`)
  }
  return allocateLR(
    total,
    Array.from({ length: n }, () => 1),
  )
}

const RATIO_DECIMAL_PATTERN = /^\d+(?:\.\d{1,6})?$/

/**
 * Computes `R(base * numerator / denominator)` half-up via Decimal (`base >= 0`, `denominator > 0`).
 * Used for inclusive tax extraction `R(B * r / (100 + r))`.
 */
export function ratioRound(base: Money, numerator: string, denominator: string): Money {
  if (typeof base !== 'number' || !Number.isSafeInteger(base) || base < 0) {
    throw new RangeError(`ratioRound base must be integer >= 0: ${base}`)
  }
  if (typeof numerator !== 'string' || !RATIO_DECIMAL_PATTERN.test(numerator)) {
    throw new RangeError(`ratioRound numerator must be non-negative decimal string: "${numerator}"`)
  }
  if (typeof denominator !== 'string' || !RATIO_DECIMAL_PATTERN.test(denominator)) {
    throw new RangeError(`ratioRound denominator must be positive decimal string: "${denominator}"`)
  }
  const denomDec = new D(denominator)
  if (!denomDec.gt(0)) {
    throw new RangeError(`ratioRound denominator must be > 0: "${denominator}"`)
  }
  return roundHalfUp(new D(base).times(new D(numerator)).div(denomDec))
}
