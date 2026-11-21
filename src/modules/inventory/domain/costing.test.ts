import { describe, expect, it } from 'vitest'
import { parseQty, toMoney, QtyError } from '~/lib/kernel'
import {
  applyAdjustment,
  applyIn,
  applyInAtReference,
  applyOut,
  averageCostForDisplay,
  emptyBalance,
  type StockBalance,
} from './costing'

const q = (s: string) => parseQty(s)
const m = (n: number) => toMoney(n)

function bal(qty: string, value: number, refValue?: number, refQty?: string): StockBalance {
  return {
    qty: q(qty),
    inventoryValue: m(value),
    refValue: m(refValue ?? value),
    refQty: q(refQty ?? qty),
    rev: 0,
  }
}

describe('inventory/costing V-12 (tabel BR-HPP-003 berurutan)', () => {
  it('GR 100@8000, jual 30 → HPP 240000; GR 50=425000; jual 7 → 57458; jual 113 → 927542 (habis)', () => {
    const r1 = applyIn(emptyBalance(), q('100'), m(800000), 'DECLARED')
    expect(r1.next.qty).toBe('100')
    expect(r1.next.inventoryValue).toBe(800000)

    const r2 = applyOut(r1.next, q('30'))
    expect(-r2.valueDelta).toBe(240000)
    expect(r2.next.qty).toBe('70')
    expect(r2.next.inventoryValue).toBe(560000)
    expect(r2.costBasis).toBe('AVERAGE')
    expect(averageCostForDisplay(r2.next)).toBe('8000.00')

    const r3 = applyIn(r2.next, q('50'), m(425000), 'DECLARED')
    expect(r3.next.qty).toBe('120')
    expect(r3.next.inventoryValue).toBe(985000)
    expect(averageCostForDisplay(r3.next)).toBe('8208.33')

    const r4 = applyOut(r3.next, q('7'))
    expect(-r4.valueDelta).toBe(57458)
    expect(r4.next.qty).toBe('113')
    expect(r4.next.inventoryValue).toBe(927542)
    expect(averageCostForDisplay(r4.next)).toBe('8208.34')

    const r5 = applyOut(r4.next, q('113'))
    expect(-r5.valueDelta).toBe(927542)
    expect(r5.next.qty).toBe('0')
    expect(r5.next.inventoryValue).toBe(0)
    expect(averageCostForDisplay(r5.next)).toBeNull()
  })
})

describe('inventory/costing V-13 (HPP telat, BR-HPP-004)', () => {
  it('saldo 70/560000 → GR 50=425000 → 120/985000 → jual 10 → HPP 82083 → 110/902917', () => {
    const b = bal('70', 560000)
    const g = applyIn(b, q('50'), m(425000), 'DECLARED')
    const s = applyOut(g.next, q('10'))
    expect(-s.valueDelta).toBe(82083)
    expect(s.next.qty).toBe('110')
    expect(s.next.inventoryValue).toBe(902917)
  })
})

describe('inventory/costing V-14 (stok minus, BR-HPP-005)', () => {
  it('saldo 3/24000 jual 5 → HPP 40000, saldo −2/−16000 MIXED negatif; GR 20@9000 → 18/164000', () => {
    const b = applyIn(emptyBalance(), q('3'), m(24000), 'DECLARED').next
    const s = applyOut(b, q('5'))
    expect(-s.valueDelta).toBe(40000)
    expect(s.next.qty).toBe('-2')
    expect(s.next.inventoryValue).toBe(-16000)
    expect(s.costBasis).toBe('MIXED')
    expect(s.isNegativeResult).toBe(true)
    expect(s.noReference).toBe(false)

    const g = applyIn(s.next, q('20'), m(180000), 'DECLARED')
    expect(g.next.qty).toBe('18')
    expect(g.next.inventoryValue).toBe(164000)
    expect(g.isNegativeResult).toBe(false)
  })
})

describe('inventory/costing V-15 (bagian costing transfer)', () => {
  it('kirim 40 dari 120/985000 → 80/656667; terima 38 di tujuan → 48/401916 (basis TRANSFER)', () => {
    const a = applyOut(bal('120', 985000), q('40'))
    expect(-a.valueDelta).toBe(328333)
    expect(a.next.qty).toBe('80')
    expect(a.next.inventoryValue).toBe(656667)

    const dest = applyIn(bal('10', 90000), q('38'), m(311916), 'TRANSFER')
    expect(dest.next.qty).toBe('48')
    expect(dest.next.inventoryValue).toBe(401916)
    expect(dest.costBasis).toBe('TRANSFER')
  })
})

describe('inventory/costing V-16 (penyesuaian opname, BR-STK-030/032)', () => {
  it('delta −3 dan +5 pada 80/656667; saldo −2/−16000 fisik 0 → +16000; fisik 5 → 5/40000', () => {
    const minus = applyAdjustment(bal('80', 656667), q('-3'))
    expect(-minus.valueDelta).toBe(24625)
    expect(minus.next.qty).toBe('77')
    expect(minus.next.inventoryValue).toBe(632042)

    const plus = applyAdjustment(bal('80', 656667), q('5'))
    expect(plus.valueDelta).toBe(41042)
    expect(plus.next.qty).toBe('85')
    expect(plus.next.inventoryValue).toBe(697709)

    const neg = bal('-2', -16000, 24000, '3')
    const toZero = applyAdjustment(neg, q('2'))
    expect(toZero.next.qty).toBe('0')
    expect(toZero.next.inventoryValue).toBe(0)
    expect(toZero.valueDelta).toBe(16000)

    const toFive = applyAdjustment(neg, q('7'))
    expect(toFive.next.qty).toBe('5')
    expect(toFive.next.inventoryValue).toBe(40000)
  })
})

describe('inventory/costing retur (BR-HPP-007) dan tepi', () => {
  it('retur 1 pada 113/927542 dengan snapshot 8208 → 114/935750 (basis SNAPSHOT)', () => {
    const r = applyIn(bal('113', 927542), q('1'), m(8208), 'SNAPSHOT')
    expect(r.next.qty).toBe('114')
    expect(r.next.inventoryValue).toBe(935750)
    expect(r.costBasis).toBe('SNAPSHOT')
  })

  it('keluar dari saldo 0 tanpa referensi: HPP 0, saldo negatif, noReference', () => {
    const r = applyOut(emptyBalance(), q('1'))
    expect(r.valueDelta).toBe(0)
    expect(r.next.qty).toBe('-1')
    expect(r.next.inventoryValue).toBe(0)
    expect(r.noReference).toBe(true)
    expect(r.isNegativeResult).toBe(true)
  })

  it('qtyOut harus > 0 dan penyebut nol ditolak', () => {
    expect(() => applyOut(bal('10', 1000), q('0'))).toThrow(QtyError)
    expect(() => applyInAtReference(emptyBalance(), q('0'))).toThrow(QtyError)
  })

  it('applyInAtReference memakai biaya referensi pada saldo negatif', () => {
    const r = applyInAtReference(bal('-2', -16000, 24000, '3'), q('2'))
    expect(r.next.qty).toBe('0')
    expect(r.next.inventoryValue).toBe(0)
    expect(r.valueDelta).toBe(16000)
  })

  it('skala kuantitas 4 desimal tetap utuh', () => {
    const r = applyIn(emptyBalance(), q('0.3333'), m(1000), 'DECLARED')
    expect(r.next.qty).toBe('0.3333')
    const s = applyOut(r.next, q('0.1111'))
    expect(s.next.qty).toBe('0.2222')
  })
})
