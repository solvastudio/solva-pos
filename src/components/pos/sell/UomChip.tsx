import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'
import { formatMoney } from '~/lib/kernel'
import type { SellSkuUomOption } from './types'

export interface UomChipProps {
  currentUomId: string
  currentUomCode: string
  options: readonly SellSkuUomOption[]
  onSelectUom: (option: SellSkuUomOption) => void
}

export function UomChip({
  currentUomId,
  currentUomCode,
  options,
  onSelectUom,
}: UomChipProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const selectable = options.filter((o) => o.price.kind !== 'NO_PRICE')

  if (selectable.length <= 1) {
    return (
      <span className="inline-flex items-center rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-caption font-medium text-ink-soft">
        {currentUomCode}
      </span>
    )
  }

  return (
    <select
      aria-label={t('pos.cart.uomLabel')}
      value={currentUomId}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const picked = selectable.find((o) => o.uom.id === e.target.value)
        if (picked) {
          onSelectUom(picked)
        }
      }}
      className={cn(
        'h-7 rounded-full border border-line bg-surface-sunken px-2 text-caption font-medium text-ink',
        'focus:border-action focus:ring-2 focus:ring-focus-ring focus:outline-none',
      )}
    >
      {selectable.map((opt) => (
        <option key={opt.uom.id} value={opt.uom.id}>
          {opt.price.kind === 'PRICE'
            ? `${opt.uom.code} (${formatMoney(opt.price.price, locale)})`
            : opt.uom.code}
        </option>
      ))}
    </select>
  )
}
