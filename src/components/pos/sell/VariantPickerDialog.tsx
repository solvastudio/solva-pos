import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Dialog } from '~/components/ui/Dialog'
import { cn } from '~/lib/cn'
import { formatMoney } from '~/lib/kernel'
import type { PriceResolution } from '~/modules/catalog/shared'
import type { ProductRecord, SkuRecord } from '~/pos/db/types'

export interface VariantPickerOption {
  sku: SkuRecord
  price: PriceResolution
}

export interface VariantPickerDialogProps {
  open: boolean
  product: ProductRecord | null
  options: readonly VariantPickerOption[]
  onOpenChange: (open: boolean) => void
  onSelectSku: (option: VariantPickerOption) => void
}

export function VariantPickerDialog({
  open,
  product,
  options,
  onOpenChange,
  onSelectSku,
}: VariantPickerDialogProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'

  if (!product) return null

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('pos.sell.variantPickerTitle', { name: product.name })}
      size="md"
    >
      <div className={cn('grid gap-2.5', options.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')}>
        {options.map((opt) => {
          const disabled = opt.price.kind === 'NO_PRICE'
          const priceLabel =
            opt.price.kind === 'PRICE'
              ? formatMoney(opt.price.price, locale)
              : opt.price.kind === 'OPEN_PRICE'
                ? t('pos.sell.openPriceBadge')
                : t('pos.sell.noPriceBadge')

          return (
            <Button
              key={opt.sku.id}
              type="button"
              variant="secondary"
              size="md"
              disabled={disabled}
              onClick={() => {
                onSelectSku(opt)
                onOpenChange(false)
              }}
              className="w-full justify-between gap-2 px-3.5 text-left"
            >
              <span className="min-w-0 truncate font-medium text-ink">
                {opt.sku.variant_label ?? opt.sku.sku_code}
              </span>
              <span
                className={cn(
                  'shrink-0 font-mono text-body font-semibold tabular-nums',
                  disabled ? 'text-danger-ink' : 'text-ink-brand',
                )}
              >
                {priceLabel}
              </span>
            </Button>
          )
        })}
      </div>
    </Dialog>
  )
}
