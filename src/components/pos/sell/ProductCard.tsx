import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'
import { formatMoney, type Qty } from '~/lib/kernel'
import { StockChip } from '~/components/pos/StockChip'
import type { SellCatalogItem } from './types'

export interface ProductCardProps {
  item: SellCatalogItem
  onSelect: (item: SellCatalogItem) => void
}

export function ProductCard({ item, onSelect }: ProductCardProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const { product, price, stockQty } = item

  const disabled = price.kind === 'NO_PRICE'
  const numericStock = stockQty !== null ? Number(stockQty) : null
  const outOfStock = product.track_stock && numericStock !== null && numericStock <= 0

  let priceDisplay: string
  if (price.kind === 'PRICE') {
    priceDisplay = formatMoney(price.price, locale)
  } else if (price.kind === 'OPEN_PRICE') {
    priceDisplay = t('pos.sell.openPriceBadge')
  } else {
    priceDisplay = t('pos.sell.noPriceBadge')
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(item)}
      className={cn(
        'flex h-32 w-full flex-col justify-between rounded-card border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none',
        disabled
          ? 'cursor-not-allowed border-line bg-surface-sunken text-ink-soft opacity-60'
          : 'border-line bg-surface text-ink hover:border-action hover:bg-surface-sunken active:scale-[0.99]',
      )}
    >
      <div className="flex flex-col gap-1">
        <span className="line-clamp-2 text-body font-semibold text-ink">
          {product.name}
        </span>
      </div>

      <div className="flex items-end justify-between gap-2">
        <span
          className={cn(
            'font-mono text-label font-semibold tabular-nums',
            price.kind === 'NO_PRICE' ? 'text-danger-ink' : 'text-action',
          )}
        >
          {priceDisplay}
        </span>

        {product.track_stock && stockQty !== null ? (
          outOfStock ? (
            // Estimasi ≤ 0: chip non-blokir (tombol tetap bisa dipakai; FR-POS-011).
            <StockChip estimate={stockQty as Qty} className="shrink-0" />
          ) : (
            <span className="shrink-0 rounded-pill bg-surface-sunken px-2 py-0.5 text-caption font-medium tabular-nums text-ink-soft">
              {t('pos.sell.stockBadge', { qty: stockQty })}
            </span>
          )
        ) : null}
      </div>
    </button>
  )
}
