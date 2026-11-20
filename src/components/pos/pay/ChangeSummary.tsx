import { useTranslation } from 'react-i18next'
import { formatMoney, toMoney, ZERO, type Money } from '~/lib/kernel'
import type { PaymentPreviewResult } from '~/pos/domain/payment-preview'

export interface ChangeSummaryProps {
  grandTotal: Money
  preview: PaymentPreviewResult
}

export function ChangeSummary({ grandTotal, preview }: ChangeSummaryProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'

  const paid = preview.totalPaid
  const rounding = preview.settlement?.rounding ?? ZERO
  const change = preview.settlement?.changeTotal ?? ZERO

  return (
    <dl className="flex flex-col gap-2 rounded-card border border-line bg-surface-sunken p-4 text-body">
      <div className="flex justify-between text-ink-soft">
        <dt>{t('pos.pay.billLabel')}</dt>
        <dd className="font-mono font-medium tabular-nums">{formatMoney(grandTotal, locale)}</dd>
      </div>

      <div className="flex justify-between text-ink-soft">
        <dt>{t('pos.pay.paidLabel')}</dt>
        <dd className="font-mono font-medium tabular-nums">{formatMoney(paid, locale)}</dd>
      </div>

      <div className="flex justify-between text-ink">
        <dt className="font-medium">{t('pos.pay.remainingLabel')}</dt>
        <dd className="font-mono font-semibold tabular-nums">
          {formatMoney(preview.remaining, locale)}
        </dd>
      </div>

      {rounding !== 0 ? (
        <div className="flex justify-between text-ink-soft">
          <dt>{t('pos.pay.roundingLabel')}</dt>
          <dd className="font-mono tabular-nums">
            {rounding > 0
              ? `+${formatMoney(rounding, locale)}`
              : `\u2212${formatMoney(toMoney(Math.abs(rounding)), locale)}`}
          </dd>
        </div>
      ) : null}

      <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2">
        <dt className="text-h3 font-semibold text-ink">{t('pos.pay.changeLabel')}</dt>
        <dd className="font-mono text-h2 font-bold text-action tabular-nums">
          {formatMoney(change, locale)}
        </dd>
      </div>
    </dl>
  )
}
