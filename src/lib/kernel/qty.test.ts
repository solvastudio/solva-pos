import { describe, expect, it } from 'vitest'
import {
  addQty,
  cmpQty,
  isIntegerQty,
  isPositiveQty,
  mulQty,
  normalizeQty,
  parseQty,
  QTY_PATTERN,
  QtyError,
  qtyToBase,
  subQty,
} from './qty'

const V24_CASES = [
  {
    label: '0.5 dus x 12 = 6 pcs (allowFraction=false)',
    qty: '0.5',
    factor: '12',
    allowFraction: false,
    expected: '6',
  },
  {
    label: '0.35 kg x 1 = 0.35 kg (allowFraction=true)',
    qty: '0.35',
    factor: '1',
    allowFraction: true,
    expected: '0.35',
  },
] as const

describe('kernel/qty', () => {
  it('mengurai dan menormalisasi string desimal skala 4 kanonik', () => {
    expect(QTY_PATTERN.test('1.5000')).toBe(true)
    expect(parseQty('0')).toBe('0')
    expect(parseQty('-0')).toBe('0')
    expect(parseQty('-0.0000')).toBe('0')
    expect(parseQty('1.5000')).toBe('1.5')
    expect(parseQty('12.3456')).toBe('12.3456')
    expect(normalizeQty(parseQty('2.500'))).toBe('2.5')
  })

  it('menolak format invalid dan skala > 4 tanpa membulatkan (BR-UOM-005)', () => {
    const invalidInputs = ['', '+1', '1e3', '1,5', '.5', '1.', '01', '-01', 'abc']
    for (const s of invalidInputs) {
      expect(() => parseQty(s)).toThrowError(expect.objectContaining({ code: 'INVALID_FORMAT' }))
    }

    expect(() => parseQty('1.12345')).toThrowError(QtyError)
    expect(() => parseQty('1.12345')).toThrowError(
      expect.objectContaining({ code: 'SCALE_EXCEEDED' }),
    )
  })

  it('melakukan aritmetika desimal eksak dan menolak perkalian yang melebihi skala 4', () => {
    expect(addQty(parseQty('0.1'), parseQty('0.2'))).toBe('0.3')
    expect(subQty(parseQty('1'), parseQty('0.3333'))).toBe('0.6667')
    expect(mulQty(parseQty('0.5'), parseQty('12'))).toBe('6')
    expect(() => mulQty(parseQty('0.125'), parseQty('0.125'))).toThrowError(
      expect.objectContaining({ code: 'SCALE_EXCEEDED' }),
    )

    expect(cmpQty(parseQty('1.5'), parseQty('1.50'))).toBe(0)
    expect(cmpQty(parseQty('0.35'), parseQty('0.5'))).toBe(-1)
    expect(cmpQty(parseQty('2'), parseQty('1.9999'))).toBe(1)
    expect(isPositiveQty(parseQty('0.0001'))).toBe(true)
    expect(isPositiveQty(parseQty('0'))).toBe(false)
    expect(isIntegerQty(parseQty('6.0000'))).toBe(true)
    expect(isIntegerQty(parseQty('4.2'))).toBe(false)
  })

  it('memenuhi vektor uji V-24 untuk konversi UOM (BR-UOM-004/005)', () => {
    for (const c of V24_CASES) {
      expect(
        qtyToBase({
          qty: parseQty(c.qty),
          factor: parseQty(c.factor),
          allowFraction: c.allowFraction,
        }),
        c.label,
      ).toBe(c.expected)
    }

    expect(() =>
      qtyToBase({
        qty: parseQty('0.35'),
        factor: parseQty('12'),
        allowFraction: false,
      }),
    ).toThrowError(expect.objectContaining({ code: 'FRACTION_NOT_ALLOWED' }))

    expect(() =>
      qtyToBase({
        qty: parseQty('0'),
        factor: parseQty('12'),
        allowFraction: false,
      }),
    ).toThrowError(expect.objectContaining({ code: 'NOT_POSITIVE' }))

    expect(() =>
      qtyToBase({
        qty: parseQty('0.125'),
        factor: parseQty('0.125'),
        allowFraction: true,
      }),
    ).toThrowError(expect.objectContaining({ code: 'SCALE_EXCEEDED' }))
  })
})
