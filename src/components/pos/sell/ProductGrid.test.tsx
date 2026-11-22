// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeLocale } from '~/i18n'
import { toMoney } from '~/lib/kernel'
import { ProductGrid } from './ProductGrid'
import type { SellCatalogItem } from './types'

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
})

function makeCatalog(count: number): SellCatalogItem[] {
  return Array.from({ length: count }, (_, idx) => {
    const prodId = `prod-${idx + 1}`
    const skuId = `sku-${idx + 1}`
    return {
      product: {
        id: prodId,
        category_id: 'cat-1',
        code: `P-${idx + 1}`,
        name: `Item ${idx + 1}`,
        product_type: 'RETAIL',
        has_variants: false,
        base_uom_id: 'uom-pcs',
        track_stock: false,
        taxable: true,
        is_active: true,
        is_open_price: false,
        sort_order: idx + 1,
        search_tokens: [`item`, `${idx + 1}`],
        deleted_at: null,
      },
      defaultSku: {
        id: skuId,
        product_id: prodId,
        sku_code: `SKU-${idx + 1}`,
        variant_label: null,
        is_default: true,
        is_active: true,
        sort_order: 1,
        deleted_at: null,
      },
      skus: [
        {
          id: skuId,
          product_id: prodId,
          sku_code: `SKU-${idx + 1}`,
          variant_label: null,
          is_default: true,
          is_active: true,
          sort_order: 1,
          deleted_at: null,
        },
      ],
      baseUom: {
        id: 'uom-pcs',
        code: 'pcs',
        name: 'Piece',
        allow_fraction: false,
        deleted_at: null,
      },
      price:
        idx === 1
          ? { kind: 'NO_PRICE' }
          : { kind: 'PRICE', price: toMoney(15_000), source: 'DEFAULT' },
      stockQty: null,
    }
  })
}

describe('ProductGrid (SCR-P04)', () => {
  it('windows 5,000 products to <= 60 DOM cards, disables NO_PRICE items, and passes axe', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const items = makeCatalog(5000)

    const { container } = render(
      <ProductGrid items={items} searchQuery="" onSelectItem={onSelect} />,
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeLessThanOrEqual(60)
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true)

    await user.click(buttons[0]!)
    expect(onSelect).toHaveBeenCalledWith(items[0])

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])
  })

  it('recomputes column count when transitioning from empty state to populated items', () => {
    const items = makeCatalog(2)
    const { rerender } = render(
      <ProductGrid items={[]} searchQuery="" onSelectItem={vi.fn()} />,
    )

    const protoSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(280)

    try {
      rerender(<ProductGrid items={items} searchQuery="" onSelectItem={vi.fn()} />)
      const region = screen.getByRole('region')
      const grid = region.querySelector('.grid') as HTMLElement | null
      expect(grid?.style.gridTemplateColumns).toMatch(/^repeat\(1, minmax\(0(?:px)?, 1fr\)\)$/)
    } finally {
      protoSpy.mockRestore()
    }
  })
})
