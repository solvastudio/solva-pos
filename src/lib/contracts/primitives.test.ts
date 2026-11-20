import { describe, expect, it } from 'vitest'
import {
  zBusinessDate,
  zCashRoundingUnit,
  zCurrencyIdr,
  zIso,
  zMoney,
  zMoneyNonNeg,
  zMoneyPositive,
  zPercent,
  zPeriod,
  zQty,
  zQtyPositive,
  zReceiptLocale,
  zUuid,
} from './primitives'

describe('contracts/primitives', () => {
  it('validates zMoney variants strictly as safe integers', () => {
    expect(zMoney.parse(0)).toBe(0)
    expect(zMoney.parse(-45)).toBe(-45)
    expect(zMoney.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
    expect(() => zMoney.parse(1.5)).toThrow()
    expect(() => zMoney.parse(Number.NaN)).toThrow()
    expect(() => zMoney.parse(Number.POSITIVE_INFINITY)).toThrow()
    expect(() => zMoney.parse(Number.MAX_SAFE_INTEGER + 1)).toThrow()

    expect(zMoneyNonNeg.parse(0)).toBe(0)
    expect(() => zMoneyNonNeg.parse(-1)).toThrow()

    expect(zMoneyPositive.parse(1)).toBe(1)
    expect(() => zMoneyPositive.parse(0)).toThrow()
  })

  it('validates fixed-scale quantities and percentages', () => {
    expect(zQty.parse('0')).toBe('0')
    expect(zQty.parse('-2.5')).toBe('-2.5')
    expect(zQty.parse('1.2345')).toBe('1.2345')
    expect(() => zQty.parse('1.23456')).toThrow()
    expect(() => zQty.parse('.5')).toThrow()

    expect(zQtyPositive.parse('0.0001')).toBe('0.0001')
    expect(() => zQtyPositive.parse('0')).toThrow()
    expect(() => zQtyPositive.parse('-1')).toThrow()

    expect(zPercent.parse('0')).toBe('0')
    expect(zPercent.parse('11.5')).toBe('11.5')
    expect(zPercent.parse('100.0000')).toBe('100.0000')
    expect(() => zPercent.parse('101')).toThrow()
    expect(() => zPercent.parse('100.0001')).toThrow()
    expect(() => zPercent.parse('-1')).toThrow()
  })

  it('validates dates, periods, UTC ISO timestamps, lowercase UUIDs, and discrete enums', () => {
    expect(zIso.parse('2026-11-20T12:00:00.000Z')).toBe('2026-11-20T12:00:00.000Z')
    expect(() => zIso.parse('2026-11-20T12:00:00+07:00')).toThrow()

    expect(zBusinessDate.parse('2024-02-29')).toBe('2024-02-29')
    expect(() => zBusinessDate.parse('2026-02-29')).toThrow()
    expect(() => zBusinessDate.parse('20-11-2026')).toThrow()

    expect(zPeriod.parse('1126')).toBe('1126')
    expect(() => zPeriod.parse('0026')).toThrow()
    expect(() => zPeriod.parse('1326')).toThrow()

    const lowerUuid = '01950000-0000-7000-8000-0000000000ab'
    expect(zUuid.parse(lowerUuid)).toBe(lowerUuid)
    expect(() => zUuid.parse(lowerUuid.toUpperCase())).toThrow()

    expect(zCashRoundingUnit.parse(100)).toBe(100)
    expect(() => zCashRoundingUnit.parse(50)).toThrow()

    expect(zReceiptLocale.parse('id-ID')).toBe('id-ID')
    expect(() => zReceiptLocale.parse('fr-FR')).toThrow()

    expect(zCurrencyIdr.parse('IDR')).toBe('IDR')
    expect(() => zCurrencyIdr.parse('USD')).toThrow()
  })
})
