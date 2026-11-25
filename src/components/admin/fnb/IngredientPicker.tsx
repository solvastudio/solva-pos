import { useTranslation } from 'react-i18next'
import { Select } from '~/components/ui'
import type { IngredientOptionView } from '~/modules/catalog/shared'

export interface IngredientPickerProps {
  id?: string
  ariaLabel?: string
  options: readonly IngredientOptionView[]
  value: string
  onValueChange: (skuId: string) => void
  disabled?: boolean
}

export function IngredientPicker({
  id,
  ariaLabel,
  options,
  value,
  onValueChange,
  disabled = false,
}: IngredientPickerProps) {
  const { t } = useTranslation()

  return (
    <Select
      id={id}
      size="md"
      ariaLabel={ariaLabel ?? t('admin.recipe.selectIngredient')}
      placeholder={t('admin.recipe.selectIngredient')}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      options={options.map((o) => ({
        value: o.skuId,
        label: o.trackStock
          ? `${o.productName} (${o.skuCode}) — ${o.uomCode}`
          : `${o.productName} (${o.skuCode}) — ${o.uomCode} [${t('admin.recipe.notTrackedBadge')}]`,
      }))}
    />
  )
}
