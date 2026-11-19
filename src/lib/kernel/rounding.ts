import { toMoney, type Money } from './money'
import { D, type KernelDecimal, qtyToDecimal, type Qty } from './qty'

const PERCENT_PATTERN = /^-?\d+(?:\.\d{1,4})?$/

/**
 * Pembulatan half-up simetris (BR-MNY-004):
 * untuk x >= 0, tepat `.5` dibulatkan ke atas; untuk x < 0, `R(-x) = -R(x)`.
 */
export function roundHalfUp(x: KernelDecimal): Money {
  const rounded = x.isNegative()
    ? x.abs().toDecimalPlaces(0, D.ROUND_HALF_UP).neg()
    : x.toDecimalPlaces(0, D.ROUND_HALF_UP)
  return toMoney(rounded.toNumber())
}

/** R(unit * q) sesuai BR-MNY-004. */
export function mulRound(unit: Money, q: Qty): Money {
  return roundHalfUp(new D(unit).times(qtyToDecimal(q)))
}

/** R(base * percent / 100) dengan string persentase skala 4 mis. `"11.0000"`. */
export function percentOf(base: Money, percent: string): Money {
  if (typeof percent !== 'string' || !PERCENT_PATTERN.test(percent)) {
    throw new RangeError(`Format persentase tidak valid: "${String(percent)}"`)
  }
  return roundHalfUp(new D(base).times(new D(percent)).div(100))
}

/**
 * Alokasi Largest Remainder (BR-MNY-006):
 * `total >= 0`, semua `weights[i] >= 0` integer aman, `sum(weights) > 0`.
 * Seri pecahan dimenangkan oleh indeks lebih kecil (stabil).
 */
export function allocateLR(total: Money, weights: readonly number[]): Money[] {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError(`Total alokasi LR harus bilangan bulat >= 0: ${total}`)
  }
  if (weights.length === 0) {
    throw new RangeError('Daftar bobot alokasi LR tidak boleh kosong')
  }

  const totalBig = BigInt(total)
  const weightBigs: bigint[] = []
  let sumWeights = 0n

  for (const w of weights) {
    if (typeof w !== 'number' || !Number.isSafeInteger(w) || w < 0) {
      throw new RangeError(`Setiap bobot alokasi LR harus bilangan bulat aman >= 0: ${w}`)
    }
    const wb = BigInt(w)
    weightBigs.push(wb)
    sumWeights += wb
  }

  if (sumWeights === 0n) {
    throw new RangeError('Jumlah seluruh bobot alokasi LR harus > 0')
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

/** Alokasi Largest Remainder dengan `n` bobot sama (V-02). */
export function allocateEqual(total: Money, n: number): Money[] {
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new RangeError(`Jumlah bagian allocateEqual harus bilangan bulat > 0: ${n}`)
  }
  return allocateLR(
    total,
    Array.from({ length: n }, () => 1),
  )
}
