import { describe, expect, it } from 'vitest'
import { effectivePrefix } from './invoice-prefix'

describe('pos/domain/invoice-prefix', () => {
  const rows = [
    {
      id: 'p1',
      register_id: 'reg-1',
      effective_month: '2026-10-01',
      invoice_prefix: 'OUT01-POS02',
      deleted_at: null,
    },
    {
      id: 'p2',
      register_id: 'reg-1',
      effective_month: '2026-12-01',
      invoice_prefix: 'OUT01-P02B',
      deleted_at: null,
    },
  ]

  it('picks greatest effective_month <= YYYY-MM-01 of businessDate (V-29)', () => {
    expect(effectivePrefix(rows, '2026-11-30')?.invoice_prefix).toBe('OUT01-POS02')
    expect(effectivePrefix(rows, '2026-12-01')?.invoice_prefix).toBe('OUT01-P02B')
    expect(effectivePrefix(rows, '2026-09-15')).toBeNull()
  })
})
