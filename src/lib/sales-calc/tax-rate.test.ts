import { describe, expect, it } from 'vitest'
import { selectTaxRate } from './tax-rate'
import type { TaxRateRow } from './types'

describe('sales-calc/tax-rate', () => {
  const history: TaxRateRow[] = [
    { id: 'r-ppn-old', taxCode: 'PPN', outletId: null, rate: '11.0000', effectiveFrom: '2024-01-01' },
    { id: 'r-ppn-new', taxCode: 'PPN', outletId: null, rate: '12.0000', effectiveFrom: '2026-01-01' },
    { id: 'r-ppn-del', taxCode: 'PPN', outletId: null, rate: '99.0000', effectiveFrom: '2026-01-01', deleted: true },
    { id: 'r-ppn-out1', taxCode: 'PPN', outletId: 'out-1', rate: '10.5000', effectiveFrom: '2025-06-01' },
    { id: 'r-pb1', taxCode: 'PB1', outletId: null, rate: '10.0000', effectiveFrom: '2024-01-01' },
  ]

  it('switches rate cleanly across effective_from date boundary (SCHEMA §4.1.4)', () => {
    expect(selectTaxRate(history, 'PPN', 'out-2', '2025-12-31')).toEqual({
      rate: '11.0000',
      rowId: 'r-ppn-old',
    })
    expect(selectTaxRate(history, 'PPN', 'out-2', '2026-01-01')).toEqual({
      rate: '12.0000',
      rowId: 'r-ppn-new',
    })
  })

  it('prefers active outlet-specific override over tenant default and returns null when none match', () => {
    expect(selectTaxRate(history, 'PPN', 'out-1', '2026-01-01')).toEqual({
      rate: '10.5000',
      rowId: 'r-ppn-out1',
    })
    expect(selectTaxRate(history, 'PB1', 'out-2', '2023-12-31')).toBeNull()
  })
})
