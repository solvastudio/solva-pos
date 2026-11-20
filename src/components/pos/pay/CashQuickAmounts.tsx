import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { formatMoney, type Money } from '~/lib/kernel'
import { suggestCashAmounts } from '~/pos/domain/quick-amounts'

export interface CashQuickAmountsProps {
  remaining: Money
  disabled?: boolean
  onPickAmount: (amount: Money) => void
}

export function CashQuickAmounts({
  remaining,
  disabled = false,
  onPickAmount,
}: CashQuickAmountsProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const amounts = suggestCashAmounts(remaining)

  if (amounts.length === 0) {
    return null
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {amounts.map((amt, idx) => {
        const formatted = formatMoney(amt, locale)
        return (
          <Button
            key={amt}
            type="button"
            variant={idx === 0 ? 'primary' : 'secondary'}
            size="lg"
            disabled={disabled}
            onClick={() => onPickAmount(amt)}
            className="font-mono tabular-nums"
          >
            {idx === 0 ? t('pos.pay.exactCash', { amount: formatted }) : formatted}
          </Button>
        )
      })}
    </div>
  )
}
