import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { addQty, cmpQty, parseQty, subQty, toMoney, type Money, type Qty } from '~/lib/kernel'
import {
  applyAdjustment,
  applyIn,
  applyOut,
  emptyBalance,
  type StockBalance,
} from '~/modules/inventory/domain/costing'

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? (process.env.CI ? 200 : 100))

type Op =
  | { kind: 'IN'; qtyUnits: number; value: number }
  | { kind: 'OUT'; qtyUnits: number }
  | { kind: 'ADJ'; deltaUnits: number }

/** Scale-4 quantity in units of 0.01 (e.g. 1234 → "12.34"). */
function unitsToQty(units: number): Qty {
  const whole = Math.floor(units / 100)
  const frac = String(units % 100).padStart(2, '0')
  return parseQty(`${whole}.${frac}`)
}

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('IN' as const), qtyUnits: fc.integer({ min: 1, max: 5000 }), value: fc.integer({ min: 0, max: 900_000 }) }),
  fc.record({ kind: fc.constant('OUT' as const), qtyUnits: fc.integer({ min: 1, max: 5000 }) }),
  fc.record({ kind: fc.constant('ADJ' as const), deltaUnits: fc.integer({ min: -5000, max: 5000 }).filter((n) => n !== 0) }),
)

/** Runs a sequence of operations and returns the balance trace and value deltas. */
function run(ops: readonly Op[]): { trail: StockBalance[]; deltas: Money[]; initial: StockBalance } {
  let b = emptyBalance()
  const initial = b
  const trail: StockBalance[] = [b]
  const deltas: Money[] = []
  for (const op of ops) {
    if (op.kind === 'IN') {
      const r = applyIn(b, unitsToQty(op.qtyUnits), toMoney(op.value), 'DECLARED')
      deltas.push(r.valueDelta)
      b = r.next
    } else if (op.kind === 'OUT') {
      const r = applyOut(b, unitsToQty(op.qtyUnits))
      deltas.push(r.valueDelta)
      b = r.next
    } else {
      const delta = unitsToQty(Math.abs(op.deltaUnits))
      const r = applyAdjustment(b, op.deltaUnits < 0 ? subQty(parseQty('0'), delta) : delta)
      deltas.push(r.valueDelta)
      b = r.next
    }
    trail.push(b)
  }
  return { trail, deltas, initial }
}

describe('inventory/costing properti (fast-check)', () => {
  it('(1) qty = 0 ⇒ nilai = 0 setelah deretan acak masuk/keluar/penyesuaian', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 40 }), (ops) => {
        const { trail } = run(ops)
        for (const s of trail) {
          if (cmpQty0(s.qty) === 0) expect(s.inventoryValue).toBe(0)
        }
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('(2) konservasi nilai: nilai akhir = nilai awal + Σ valueDelta', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 40 }), (ops) => {
        const { trail, deltas, initial } = run(ops)
        const sum = deltas.reduce((acc, d) => acc + d, 0)
        expect(trail[trail.length - 1]!.inventoryValue).toBe(initial.inventoryValue + sum)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('(3) konservasi kuantitas persis (desimal skala 4 tanpa drift)', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 40 }), (ops) => {
        let expected: Qty = parseQty('0')
        for (const op of ops) {
          if (op.kind === 'IN') expected = addQty(expected, unitsToQty(op.qtyUnits))
          else if (op.kind === 'OUT') expected = subQty(expected, unitsToQty(op.qtyUnits))
          else expected = op.deltaUnits < 0 ? subQty(expected, unitsToQty(-op.deltaUnits)) : addQty(expected, unitsToQty(op.deltaUnits))
        }
        const { trail } = run(ops)
        expect(trail[trail.length - 1]!.qty).toBe(expected)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('(4) keluar penuh dari saldo positif selalu menghasilkan nilai 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 0, max: 900_000 }),
        (qtyUnits, value) => {
          const b = applyIn(emptyBalance(), unitsToQty(qtyUnits), toMoney(value), 'DECLARED').next
          const r = applyOut(b, b.qty)
          expect(r.next.qty).toBe('0')
          expect(r.next.inventoryValue).toBe(0)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('(5) deterministik: dua eksekusi identik', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 30 }), (ops) => {
        expect(run(ops).trail).toEqual(run(ops).trail)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('(6) biaya referensi hanya berubah bila saldo baru > 0', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 40 }), (ops) => {
        const { trail } = run(ops)
        for (let i = 1; i < trail.length; i += 1) {
          const prev = trail[i - 1]!
          const cur = trail[i]!
          const changed = cur.refValue !== prev.refValue || cur.refQty !== prev.refQty
          if (changed) {
            expect(cmpQty0(cur.qty)).toBeGreaterThan(0)
          }
        }
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

function cmpQty0(q: Qty): number {
  return cmpQty(q, parseQty('0'))
}
