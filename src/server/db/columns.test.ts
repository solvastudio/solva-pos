import { pgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  isoTimestamptz,
  moneyBigint,
  parseSafeBigint,
  percentNumeric,
  qtyNumeric,
  uuidId,
} from './columns'

const t = pgTable('test_columns', {
  amount: moneyBigint('amount'),
  qty: qtyNumeric('qty'),
  rate: percentNumeric('rate'),
  createdAt: isoTimestamptz('created_at'),
  id: uuidId('id'),
})

describe('server/db/columns', () => {
  it('converts moneyBigint and rejects integers outside safe range', () => {
    expect(t.amount.mapFromDriverValue('125000')).toBe(125000)
    expect(t.amount.mapFromDriverValue('-0')).toBe(0)
    expect(t.amount.mapToDriverValue(45000)).toBe('45000')

    expect(() => t.amount.mapFromDriverValue('9007199254740993')).toThrowError(RangeError)
    expect(() => parseSafeBigint('9007199254740992')).toThrowError(RangeError)
    expect(() => t.amount.mapToDriverValue(12.5)).toThrowError(RangeError)
  })

  it('validates qtyNumeric and percentNumeric scales without rounding', () => {
    expect(t.qty.mapFromDriverValue('3.0000')).toBe('3.0000')
    expect(t.qty.mapToDriverValue('12.3456')).toBe('12.3456')
    expect(() => t.qty.mapToDriverValue('1.23456')).toThrowError(RangeError)

    expect(t.rate.mapToDriverValue('11.0000')).toBe('11.0000')
    expect(() => t.rate.mapToDriverValue('100.0001')).toThrowError(RangeError)
    expect(() => t.rate.mapToDriverValue('-1')).toThrowError(RangeError)
  })

  it('converts UTC Postgres timestamptz strings to 3-digit millisecond ISO Z', () => {
    expect(t.createdAt.mapFromDriverValue('2026-11-17 07:05:12.345678+00')).toBe(
      '2026-11-17T07:05:12.345Z',
    )
    expect(t.createdAt.mapFromDriverValue('2026-11-17 07:05:12+00:00')).toBe(
      '2026-11-17T07:05:12.000Z',
    )
    expect(() => t.createdAt.mapFromDriverValue('2026-11-17 07:05:12+07:00')).toThrowError(
      RangeError,
    )
    expect(t.createdAt.mapToDriverValue('2026-11-17T07:05:12.345Z')).toBe(
      '2026-11-17T07:05:12.345Z',
    )
  })

  it('validates lowercase uuidId', () => {
    expect(t.id.mapFromDriverValue('019A0000-0000-7000-8000-000000000001')).toBe(
      '019a0000-0000-7000-8000-000000000001',
    )
    expect(t.id.mapToDriverValue('019a0000-0000-7000-8000-000000000001')).toBe(
      '019a0000-0000-7000-8000-000000000001',
    )
    expect(() => t.id.mapToDriverValue('019A0000-0000-7000-8000-000000000001')).toThrowError(
      RangeError,
    )
  })
})
