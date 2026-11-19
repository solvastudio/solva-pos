import { describe, expect, it } from 'vitest'
import { formatDateTime, formatMoney, formatPercent, formatQty, parseMoneyInput, parseQtyInput } from './format'
import { toMoney } from './money'
import { parseQty } from './qty'

describe('kernel/format (V-26)', () => {
  it('satisfies V-26 for formatting and parsing money/quantity per locale', () => {
    expect(formatMoney(toMoney(112476), 'id-ID')).toBe('Rp112.476')
    expect(formatMoney(toMoney(112476), 'en-US')).toBe('Rp112,476')
    expect(formatMoney(toMoney(-2100), 'id-ID')).toBe('\u2212Rp2.100')
    expect(formatMoney(toMoney(-2100), 'en-US')).toBe('\u2212Rp2,100')

    expect(parseMoneyInput('1.500', 'id-ID')).toBe(1500)
    expect(parseMoneyInput('Rp112.476', 'id-ID')).toBe(112476)
    expect(parseMoneyInput('1,500', 'en-US')).toBe(1500)
    expect(parseMoneyInput('1.500', 'en-US')).toBeNull()

    expect(parseQtyInput('1.500', 'id-ID')).toBe('1500')
    expect(parseQtyInput('1.500', 'en-US')).toBe('1.5')
    expect(parseQtyInput('1,5', 'id-ID')).toBe('1.5')
    expect(parseQtyInput('1.12345', 'en-US')).toBeNull()

    expect(formatQty(parseQty('1500.5'), 'id-ID')).toBe('1.500,5')
    expect(formatQty(parseQty('1500.5'), 'en-US')).toBe('1,500.5')
  })

  it('formats percentages and date-times according to outlet timezone', () => {
    expect(formatPercent('10.0000', 'id-ID')).toBe('10%')
    expect(formatPercent('10.0000', 'en-US')).toBe('10%')
    expect(formatPercent('5.5000', 'id-ID')).toBe('5,5%')
    expect(formatPercent('5.5000', 'en-US')).toBe('5.5%')

    const iso = '2026-11-17T07:05:00.000Z' // 14:05 WIB
    expect(formatDateTime(iso, 'Asia/Jakarta', 'id-ID')).toBe('17/11/2026 14.05')
    expect(formatDateTime(iso, 'Asia/Jakarta', 'en-US')).toBe('11/17/2026 2:05 PM')
  })
})
