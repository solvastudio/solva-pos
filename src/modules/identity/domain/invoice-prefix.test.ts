import { describe, expect, it } from 'vitest'
import { validateInvoicePrefix } from '~/lib/kernel'
import {
  currentMonthFirstDay,
  formatPeriodMmYy,
  nextMonthFirstDay,
  previewInvoiceNumbers,
  suggestPrefix,
} from './invoice-prefix'

describe('domain/invoice-prefix (V-29 suggestion & preview)', () => {
  it('suggests normalized uppercase prefix bounded to 16 characters', () => {
    expect(suggestPrefix('out01', 'pos02')).toBe('OUT01-POS02')
    expect(suggestPrefix('LONGOUTLET', 'REGISTER99')).toBe('LONGOUTLET-REGIS')
    expect(suggestPrefix('0123456789ABCDEF', 'POS')).toBe('0123456789ABCDEF')
  })

  it('previews invoice and credit note numbers with MMYY period', () => {
    expect(previewInvoiceNumbers('OUT01-POS02', '2026-11-20')).toEqual({
      invoice: 'OUT01-POS02-1126-000001',
      creditNote: 'OUT01-POS02-NK-1126-000001',
    })
  })

  it('computes month boundaries across normal and December rollovers', () => {
    expect(currentMonthFirstDay('2026-11-20')).toBe('2026-11-01')
    expect(nextMonthFirstDay('2026-11-20')).toBe('2026-12-01')
    expect(nextMonthFirstDay('2026-12-31')).toBe('2027-01-01')
    expect(formatPeriodMmYy('2026-12-01')).toBe('1226')
  })

  it('rejects invalid prefix forms including trailing NK, hyphens, and lowercase', () => {
    expect(validateInvoicePrefix('OUT01-NK').ok).toBe(false)
    expect(validateInvoicePrefix('-AB').ok).toBe(false)
    expect(validateInvoicePrefix('A--B').ok).toBe(false)
    expect(validateInvoicePrefix('a').ok).toBe(false)
    expect(() => previewInvoiceNumbers('OUT01-NK', '2026-11-20')).toThrow()
  })
})
