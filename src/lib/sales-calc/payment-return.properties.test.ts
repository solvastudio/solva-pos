import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { addQty, parseQty, toMoney, type CashRoundingUnit, type Qty } from '~/lib/kernel'
import { calcAndSettle } from './full-sale'
import { settlePayments } from './payment'
import { calcCreditNote } from './return'
import { expectedCash } from './shift-cash'
import type { PaymentInput, SaleCalcInput } from './types'
import { verifySale } from './verify'

describe('sales-calc payment, return, shift cash, and verifySale properties (>= 300 runs)', () => {
  it('holds payment rounding & settlement invariants across random non-cash + cash splits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1_000_000 }),
        fc.constantFrom<CashRoundingUnit>(0, 100, 500, 1000),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 50_000 }),
        (grandRaw, unit, nonCashPct, extraCash) => {
          const grandTotal = toMoney(grandRaw)
          const nonCashAmt = Math.min(grandRaw, Math.floor((grandRaw * nonCashPct) / 100))
          const payments: PaymentInput[] = []
          if (nonCashAmt > 0 && nonCashAmt < grandRaw) {
            payments.push({ methodCode: 'QRIS', kind: 'NON_CASH', amount: toMoney(nonCashAmt) })
            const remaining = grandRaw - nonCashAmt
            const cashDue =
              unit === 0 ? remaining : Math.floor((remaining + unit / 2) / unit) * unit
            payments.push({
              methodCode: 'CASH',
              kind: 'CASH',
              amount: toMoney(cashDue + extraCash),
            })
          } else if (nonCashAmt === grandRaw) {
            payments.push({ methodCode: 'QRIS', kind: 'NON_CASH', amount: grandTotal })
          } else {
            const cashDue =
              unit === 0 ? grandRaw : Math.floor((grandRaw + unit / 2) / unit) * unit
            payments.push({
              methodCode: 'CASH',
              kind: 'CASH',
              amount: toMoney(cashDue + extraCash),
            })
          }

          const res = settlePayments({ grandTotal, cashRoundingUnit: unit, payments })
          const sumApplied = res.payments.reduce((acc, p) => acc + p.applied, 0)
          expect(sumApplied).toBe(grandTotal + res.rounding)
          expect(res.totalDue).toBe(grandTotal + res.rounding)
          expect(res.changeTotal).toBeGreaterThanOrEqual(0)
          if (unit > 0) {
            expect(Math.abs(res.rounding)).toBeLessThanOrEqual(unit / 2)
          } else {
            expect(res.rounding).toBe(0)
          }
        },
      ),
      { numRuns: 400 },
    )
  })

  it('guarantees cumulative staged return splits always sum exactly to original components', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 20 }),
        fc.integer({ min: 0, max: 500_000 }),
        fc.integer({ min: 0, max: 50_000 }),
        fc.integer({ min: 0, max: 60_000 }),
        (totalUnits, origNetRaw, origScRaw, origTaxRaw) => {
          const qtySold = parseQty(String(totalUnits))
          const originalNet = toMoney(origNetRaw)
          const originalScAlloc = toMoney(origScRaw)
          const originalTaxAlloc = toMoney(origTaxRaw)

          let already: Qty = parseQty('0')
          let returnedNet = 0
          let returnedSc = 0
          let returnedTax = 0

          // Return 1 unit per step until all units returned
          for (let i = 0; i < totalUnits; i += 1) {
            const cn = calcCreditNote({
              lines: [
                {
                  qtySold,
                  qtyAlreadyReturned: already,
                  qtyReturn: parseQty('1'),
                  originalNet,
                  originalScAlloc,
                  originalTaxAlloc,
                  returnedSoFar: {
                    net: toMoney(returnedNet),
                    sc: toMoney(returnedSc),
                    tax: toMoney(returnedTax),
                  },
                },
              ],
              priceTaxMode: 'EXCLUSIVE',
              refund: { method: 'ORIGINAL', cashRoundingUnit: 100 },
            })
            returnedNet += cn.netTotal
            returnedSc += cn.scTotal
            returnedTax += cn.taxTotal
            already = addQty(already, parseQty('1'))
            expect(cn.lines[0]!.isLast).toBe(i === totalUnits - 1)
          }

          expect(returnedNet).toBe(originalNet)
          expect(returnedSc).toBe(originalScAlloc)
          expect(returnedTax).toBe(originalTaxAlloc)
        },
      ),
      { numRuns: 350 },
    )
  })

  it('guarantees verifySale passes for every calcAndSettle output and expectedCash is strictly linear', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 500_000 }),
        fc.constantFrom<'INCLUSIVE' | 'EXCLUSIVE'>('INCLUSIVE', 'EXCLUSIVE'),
        fc.constantFrom<CashRoundingUnit>(0, 100, 500, 1000),
        (priceRaw, mode, unit) => {
          const input: SaleCalcInput = {
            lines: [
              {
                lineNo: 1,
                skuId: 's1',
                uomId: 'u1',
                qty: parseQty('2'),
                unitPrice: toMoney(priceRaw),
                taxable: true,
              },
            ],
            config: {
              priceTaxMode: mode,
              taxProfile: 'PPN',
              taxRate: '11.0000',
              serviceChargeEnabled: false,
              serviceChargeRate: '0.0000',
              serviceChargeTaxable: true,
            },
          }
          const payments: PaymentInput[] = [
            { methodCode: 'CASH', kind: 'CASH', amount: toMoney(priceRaw * 3 + 5000) },
          ]
          const { calc, settlement } = calcAndSettle(input, payments, unit)
          const verified = verifySale({
            input,
            payments,
            cashRoundingUnit: unit,
            stored: {
              ...calc,
              rounding: settlement.rounding,
              totalDue: settlement.totalDue,
            },
          })
          expect(verified).toEqual({ ok: true, diffs: [] })

          const baseExp = expectedCash({
            openingFloat: toMoney(500_000),
            cashSalesApplied: [toMoney(100_000)],
            cashIn: [],
            cashOut: [],
            cashRefunds: [],
          })
          const withExtra = expectedCash({
            openingFloat: toMoney(500_000),
            cashSalesApplied: [toMoney(100_000), settlement.cashApplied],
            cashIn: [],
            cashOut: [],
            cashRefunds: [],
          })
          expect(withExtra - baseExp).toBe(settlement.cashApplied)
        },
      ),
      { numRuns: 350 },
    )
  })
})
