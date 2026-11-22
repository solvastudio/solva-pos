import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProductCard } from './ProductCard'
import type { SellCatalogItem } from './types'
import { useWindowedGrid } from './useWindowedGrid'

export interface ProductGridProps {
  items: readonly SellCatalogItem[]
  searchQuery: string
  onSelectItem: (item: SellCatalogItem) => void
}

const CARD_ROW_HEIGHT = 128
const GRID_GAP = 12

function computeColumns(width: number): number {
  if (width >= 960) return 4
  if (width >= 600) return 3
  if (width >= 320) return 2
  return 1
}

export function ProductGrid({ items, searchQuery, onSelectItem }: ProductGridProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const [columns, setColumns] = useState(4)

  const setRefs = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node
    setScrollEl(node)
  }, [])

  useEffect(() => {
    if (!scrollEl) return
    const updateCols = () => {
      const w = scrollEl.clientWidth
      if (w > 0) {
        setColumns(computeColumns(w))
      }
    }
    updateCols()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(updateCols)
    ro.observe(scrollEl)
    return () => ro.disconnect()
  }, [scrollEl])

  const { startIndex, endIndex, totalHeight, paddingTop, onScroll } = useWindowedGrid(scrollRef, {
    totalItems: items.length,
    columns,
    rowHeight: CARD_ROW_HEIGHT,
    gap: GRID_GAP,
    overscanRows: 2,
  })

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-card border border-dashed border-line bg-surface p-8 text-center text-body text-ink-soft">
        {searchQuery.trim()
          ? t('pos.sell.emptySearch', { query: searchQuery.trim() })
          : t('pos.sell.emptyCatalog')}
      </div>
    )
  }

  const visibleSlice = items.slice(startIndex, endIndex)

  return (
    <div
      ref={setRefs}
      onScroll={onScroll}
      role="region"
      aria-label={t('pos.sell.gridAria')}
      className="min-h-0 flex-1 overflow-y-auto pr-1"
    >
      <div style={{ height: `${totalHeight}px`, paddingTop: `${paddingTop}px` }}>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {visibleSlice.map((item) => (
            <ProductCard
              key={item.product.id}
              item={item}
              onSelect={onSelectItem}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
