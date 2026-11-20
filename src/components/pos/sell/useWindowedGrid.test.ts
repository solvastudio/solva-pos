import { describe, expect, it } from 'vitest'
import { computeWindowedRange } from './useWindowedGrid'

describe('components/pos/sell/useWindowedGrid', () => {
  it('renders <= 60 visible items for a 5,000-item catalog and updates slice smoothly on scroll', () => {
    const top = computeWindowedRange({
      totalItems: 5000,
      columns: 4,
      rowHeight: 132,
      gap: 12,
      scrollTop: 0,
      viewportHeight: 680,
      overscanRows: 2,
    })

    expect(top.startIndex).toBe(0)
    expect(top.endIndex - top.startIndex).toBeLessThanOrEqual(40)
    expect(top.paddingTop).toBe(0)
    expect(top.totalHeight).toBeGreaterThan(100_000)

    const scrolled = computeWindowedRange({
      totalItems: 5000,
      columns: 4,
      rowHeight: 132,
      gap: 12,
      scrollTop: 14_400, // row 100
      viewportHeight: 680,
      overscanRows: 2,
    })

    expect(scrolled.startIndex).toBe(98 * 4)
    expect(scrolled.endIndex - scrolled.startIndex).toBeLessThanOrEqual(48)
    expect(scrolled.paddingTop).toBe(98 * 144)
  })
})
