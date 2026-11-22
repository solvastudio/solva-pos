// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { changeLocale } from '~/i18n'
import { parseQty } from '~/lib/kernel'
import { StockChip } from './StockChip'

describe('StockChip (FR-POS-011, DESIGN §5.2 #11)', () => {
  beforeEach(async () => {
    await changeLocale('id-ID')
  })
  afterEach(() => {
    cleanup()
  })

  it('shown for estimate ≤ 0 as a non-blocking status with icon and text', async () => {
    const { container } = render(<StockChip estimate={parseQty('-2')} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Stok estimasi ≤ 0')
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations).toEqual([])
  })

  it('not shown when the estimate is positive or unknown', () => {
    const { container, rerender } = render(<StockChip estimate={parseQty('3')} />)
    expect(container.textContent).toBe('')
    rerender(<StockChip estimate={null} />)
    expect(container.textContent).toBe('')
  })
})
