import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseQty, toMoney } from '~/lib/kernel'
import { calcSale } from './calc-sale'
import { calcLineDiscount } from './line'
import type { CartLineInput, DiscountInput, SaleConfigSnapshot } from './types'

const pctStringArb = fc
  .integer({ min: 0, max: 10000 })
  .map((bp) => `${Math.floor(bp / 100)}.${String((bp % 100) * 100).padStart(4, '0')}`)

const discountArb: fc.Arbitrary<DiscountInput | undefined> = fc.option(
  fc.oneof(
    fc.record({ kind: fc.constant('PERCENT' as const), percent: pctStringArb }),
    fc.record({ kind: fc.constant('NOMINAL' as const), amount: fc.integer({ min: 0, max: 200_000 }).map(toMoney) }),
  ),
  { nil: undefined },
)

const qtyArb = fc
  .integer({ min: 1, max: 50_000 })
  .map((scaled) => {
    const whole = Math.floor(scaled / 10_000)
    const frac = scaled % 10_000
    return parseQty(frac === 0 ? `${whole}` : `${whole}.${String(frac).padStart(4, '0')}`)
  })

const rawLineArb = fc.record({
  skuId: fc.constantFrom('sku-1', 'sku-2', 'sku-3', 'sku-4'),
  uomId: fc.constant('uom-pcs'),
  qty: qtyArb,
  unitPrice: fc.integer({ min: 0, max: 1_000_000 }).map(toMoney),
  taxable: fc.boolean(),
  discount: discountArb,
})

const configArb: fc.Arbitrary<SaleConfigSnapshot> = fc.record({
  priceTaxMode: fc.constantFrom('INCLUSIVE' as const, 'EXCLUSIVE' as const),
  taxProfile: fc.constantFrom('NONE' as const, 'PPN' as const, 'PB1' as const),
  taxRate: fc.constantFrom('0.0000', '10.0000', '11.0000', '12.0000'),
  serviceChargeEnabled: fc.boolean(),
  serviceChargeRate: fc.constantFrom('0.0000', '5.0000', '7.5000'),
  serviceChargeTaxable: fc.boolean(),
})

function hasNoTieWeights(weights: readonly number[]): boolean {
  const positive = weights.filter((w) => w > 0)
  return new Set(positive).size === positive.length
}

function hasDistinctRemainders(total: number, weights: readonly number[]): boolean {
  const positive = weights.filter((w) => w > 0)
  let sumW = 0n
  for (const w of positive) sumW += BigInt(w)
  if (sumW === 0n) return true
  const seen = new Set<bigint>()
  for (const w of positive) {
    const rem = (BigInt(total) * BigInt(w)) % sumW
    if (seen.has(rem)) return false
    seen.add(rem)
  }
  return true
}

describe('sales-calc/calcSale property-based invariants', () => {
  it('holds all accounting, non-negativity, permutation, and idempotence invariants (>= 300 runs)', () => {
    fc.assert(
      fc.property(
        fc.array(rawLineArb, { minLength: 1, maxLength: 8 }),
        discountArb,
        configArb,
        (rawLines, billDiscount, config) => {
          const lines: CartLineInput[] = rawLines.map((r, i) => ({ ...r, lineNo: i + 1 }))
          const input = { lines, billDiscount, config }

          const a = calcSale(input)
          const b = calcSale(input)

          // (6) Determinism / idempotence
          expect(a).toEqual(b)

          // (7) calcLineDiscount bounded cleanly by lineGross
          for (let i = 0; i < a.lines.length; i += 1) {
            const lc = a.lines[i]!
            const ld = calcLineDiscount(lc.lineGross, lines[i]!.discount)
            expect(ld).toBe(lc.lineDiscount)
            expect(ld).toBeLessThanOrEqual(lc.lineGross)
            expect(lc.lineGross).toBeGreaterThanOrEqual(0)
            expect(lc.lineNet).toBeGreaterThanOrEqual(0)
            expect(lc.billDiscountAlloc).toBeGreaterThanOrEqual(0)
            expect(lc.serviceAlloc).toBeGreaterThanOrEqual(0)
            expect(lc.taxAlloc).toBeGreaterThanOrEqual(0)
            expect(lc.lineTotal).toBeGreaterThanOrEqual(0)
          }

          // (1) Sum of lineNet = S1 = grossTotal - lineDiscountTotal
          const sumLineNet = a.lines.reduce((acc, l) => acc + l.lineNet, 0)
          expect(sumLineNet).toBe(a.grossTotal - a.lineDiscountTotal)

          // (2) Sum of LR allocations equals totals
          expect(a.lines.reduce((acc, l) => acc + l.billDiscountAlloc, 0)).toBe(a.billDiscountTotal)
          expect(a.lines.reduce((acc, l) => acc + l.serviceAlloc, 0)).toBe(a.serviceCharge)
          expect(a.lines.reduce((acc, l) => acc + l.taxAlloc, 0)).toBe(a.taxAmount)

          // (3) Non-negativity
          expect(a.netSubtotal).toBeGreaterThanOrEqual(0)
          expect(a.serviceCharge).toBeGreaterThanOrEqual(0)
          expect(a.taxBase).toBeGreaterThanOrEqual(0)
          expect(a.taxAmount).toBeGreaterThanOrEqual(0)
          expect(a.dpp).toBeGreaterThanOrEqual(0)
          expect(a.grandTotal).toBeGreaterThanOrEqual(0)

          // (4) Mode totals consistency
          if (config.priceTaxMode === 'EXCLUSIVE') {
            expect(a.grandTotal).toBe(a.netSubtotal + a.serviceCharge + a.taxAmount)
            expect(a.dpp).toBe(a.taxBase)
          } else {
            expect(a.grandTotal).toBe(a.netSubtotal + a.serviceCharge)
            expect(a.dpp + a.taxAmount).toBe(a.taxBase)
          }

          // (5) Permutation invariance
          const reversedLines: CartLineInput[] = [...lines].reverse()
          const rev = calcSale({ lines: reversedLines, billDiscount, config })
          expect(rev.grossTotal).toBe(a.grossTotal)
          expect(rev.lineDiscountTotal).toBe(a.lineDiscountTotal)
          expect(rev.billDiscountTotal).toBe(a.billDiscountTotal)
          expect(rev.netSubtotal).toBe(a.netSubtotal)
          expect(rev.serviceCharge).toBe(a.serviceCharge)
          expect(rev.taxBase).toBe(a.taxBase)
          expect(rev.taxAmount).toBe(a.taxAmount)
          expect(rev.dpp).toBe(a.dpp)
          expect(rev.grandTotal).toBe(a.grandTotal)

          // When no remainder ties occur, per-line allocations are order-independent
          const billWeights = a.lines.map((l) => l.lineNet)
          const scWeights = a.lines.map((l) => l.lineNet - l.billDiscountAlloc)
          const taxWeights = a.lines.map((l, idx) =>
            lines[idx]!.taxable
              ? l.lineNet - l.billDiscountAlloc + (config.serviceChargeTaxable ? l.serviceAlloc : 0)
              : 0,
          )
          if (
            hasNoTieWeights(billWeights) &&
            hasDistinctRemainders(a.billDiscountTotal, billWeights) &&
            hasDistinctRemainders(a.serviceCharge, scWeights) &&
            hasDistinctRemainders(a.taxAmount, taxWeights)
          ) {
            const byLineNoA = new Map(a.lines.map((l) => [l.lineNo, l]))
            for (const lRev of rev.lines) {
              expect(lRev).toEqual(byLineNoA.get(lRev.lineNo))
            }
          }
        },
      ),
      { numRuns: 400 },
    )
  })
})
