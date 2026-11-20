import { describe, expect, it } from 'vitest'
import { rowLeftRight, separatorLine, wrapText } from './layout'

describe('pos/printing/layout', () => {
  it('wraps, separates, and aligns left/right columns cleanly at 32 and 48 cols', () => {
    expect(separatorLine(32)).toBe('--------------------------------')
    expect(rowLeftRight('TOTAL', '112.500', 32)).toEqual([
      'TOTAL                    112.500',
    ])
    expect(wrapText('TOKO SOLVA JAYA ABADI SELAMANYA', 16)).toEqual([
      'TOKO SOLVA JAYA',
      'ABADI SELAMANYA',
    ])
    expect(rowLeftRight('Kopi Arabika Gayo Roasted Very Long Name', '250.000', 32).length).toBeGreaterThan(1)
    expect(rowLeftRight('TOTAL', '112.500', 48)[0]!.length).toBe(48)
  })
})
