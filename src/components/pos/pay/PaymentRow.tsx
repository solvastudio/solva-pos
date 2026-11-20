import { useTranslation } from 'react-i18next'
import { Trash2 } from '~/components/ui/icons'
import { formatMoney } from '~/lib/kernel'
import type { DetailedPaymentEntry } from '~/pos/domain/build-finalize-payload'

export interface PaymentRowProps {
  entry: DetailedPaymentEntry
  onRemove: () => void
}

export function PaymentRow({ entry, onRemove }: PaymentRowProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'

  return (
    <div
      role="listitem"
      className="flex items-center justify-between gap-2 rounded-card border border-line bg-surface px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium text-ink">{entry.methodName}</div>
        {entry.reference ? (
          <div className="truncate text-caption text-ink-soft">{entry.reference}</div>
        ) : null}
      </div>

      <span className="font-mono text-body font-semibold text-ink tabular-nums">
        {formatMoney(entry.amount, locale)}
      </span>

      <button
        type="button"
        aria-label={t('pos.pay.removePayment')}
        onClick={onRemove}
        className="flex size-9 shrink-0 items-center justify-center rounded-input text-ink-soft hover:bg-danger-soft hover:text-danger-ink"
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}
