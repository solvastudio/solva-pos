import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Lock } from '~/components/ui/icons'
import type { EditBillDeniedReason } from '~/pos/domain/bill-guards'
import { formatTimeHhMm } from './TableCard'

export interface ReadOnlyBannerProps {
  reason: EditBillDeniedReason
  updatedAt?: string | null
  canCancelHandover?: boolean
  cancelingHandover?: boolean
  onCancelHandover?: () => void
}

export function ReadOnlyBanner({
  reason,
  updatedAt,
  canCancelHandover = false,
  cancelingHandover = false,
  onCancelHandover,
}: ReadOnlyBannerProps) {
  const { t } = useTranslation()
  const timeStr = formatTimeHhMm(updatedAt ?? null)

  let text = t('pos.bill.readOnlyClosed')
  if (reason === 'READ_ONLY_OTHER') {
    text = timeStr
      ? t('pos.bill.readOnlyOther', { time: timeStr })
      : t('pos.bill.readOnlyOtherNoTime')
  } else if (reason === 'READ_ONLY_PENDING') {
    text = t('pos.bill.readOnlyPending')
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-line bg-violet-soft px-3 py-2.5 text-body-sm font-medium text-violet-ink"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Lock className="size-4 shrink-0" aria-hidden="true" />
        <span>{text}</span>
      </div>
      {reason === 'READ_ONLY_PENDING' && canCancelHandover && onCancelHandover ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={cancelingHandover}
          onClick={onCancelHandover}
        >
          {t('pos.bill.cancelHandoverButton')}
        </Button>
      ) : null}
    </div>
  )
}
