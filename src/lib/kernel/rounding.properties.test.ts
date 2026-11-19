import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { sumMoney, toMoney } from './money'
import { D, normalizeQty, parseQty } from './qty'
import { allocateLR, roundHalfUp } from './rounding'

const DISTINCT_PRIMES = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53]

function hasDistinctRemainders(total: number, weights: readonly number[]): boolean {
  let sumW = 0n
  for (const w of weights) sumW += BigInt(w)
  if (sumW === 0n) return false
  const totalBig = BigInt(total)
  const seen = new Set<bigint>()
  for (const w of weights) {
    const rem = (totalBig * BigInt(w)) % sumW
    if (seen.has(rem)) return false
    seen.add(rem)
  }
  return true
}

const VALID_QTY_STR_ARB = fc
  .tuple(
    fc.boolean(),
    fc.integer({ min: 0, max: 999_999 }),
    fc.oneof(
      fc.constant(''),
      fc.integer({ min: 0, max: 9999 }).map((n) => `.${String(n).padStart(4, '0')}`),
      fc.integer({ min: 1, max: 99 }).map((n) => `.${n}`),
    ),
  )
  .map(([neg, intPart, frac]) => `${neg ? '-' : ''}${intPart}${frac}`)

describe('kernel/rounding properties (fast-check)', () => {
  it('properti 1 & 2: sum(allocateLR) === total dan tiap elemen dalam {floor(e), floor(e)+1}', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc
          .array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 20 })
          .filter((ws) => ws.some((w) => w > 0)),
        (totalNum, weights) => {
          const total = toMoney(totalNum)
          const alloc = allocateLR(total, weights)

          expect(alloc).toHaveLength(weights.length)
          expect(sumMoney(alloc)).toBe(total)

          const sumW = weights.reduce((acc, w) => acc + BigInt(w), 0n)
          const totalBig = BigInt(totalNum)
          for (let i = 0; i < weights.length; i += 1) {
            const floorEi = Number((totalBig * BigInt(weights[i]!)) / sumW)
            const actual = alloc[i]!
            expect(actual === floorEi || actual === floorEi + 1).toBe(true)
          }
        },
      ),
      { numRuns: 200 },
    )
  })

  it('properti 3: permutasi bobot tanpa seri pecahan menghasilkan multiset hasil yang sama', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.shuffledSubarray(DISTINCT_PRIMES, { minLength: 2, maxLength: 6 }),
        (totalNum, weights) => {
          const total = toMoney(totalNum)
          const a1 = allocateLR(total, weights)
          expect(sumMoney(a1)).toBe(total)

          if (hasDistinctRemainders(totalNum, weights)) {
            const reversed = [...weights].reverse()
            const a2 = allocateLR(total, reversed)
            const sorted1 = [...a1].sort((x, y) => x - y)
            const sorted2 = [...a2].sort((x, y) => x - y)
            expect(sorted2).toEqual(sorted1)
          }
        },
      ),
      { numRuns: 200 },
    )
  })

  it('properti 4: roundHalfUp idempoten pada bilangan bulat', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (n) => {
        expect(roundHalfUp(new D(n))).toBe(n)
      }),
      { numRuns: 200 },
    )
  })

  it('properti 5: parseQty(normalizeQty(q)) === normalizeQty(q) dan normalizeQty idempoten', () => {
    fc.assert(
      fc.property(VALID_QTY_STR_ARB, (raw) => {
        const parsed = parseQty(raw)
        const n1 = normalizeQty(parsed)
        const n2 = normalizeQty(n1)
        expect(n2).toBe(n1)
        expect(parseQty(n1)).toBe(n1)
      }),
      { numRuns: 200 },
    )
  })
})
