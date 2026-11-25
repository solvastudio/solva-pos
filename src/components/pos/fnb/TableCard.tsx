import { useTranslation } from 'react-i18next'
import { Check, Lock, ReceiptText, Users, Utensils } from '~/components/ui/icons'
import { cn } from '~/lib/cn'
import { formatMoney, toMoney } from '~/lib/kernel'
import type { FnbTableRecord } from '~/pos/db/types'
import type { DerivedTableStatus } from '~/pos/domain/table-status'

export function formatTimeHhMm(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}.${mm}`
}

export interface TableCardProps {
  table: FnbTableRecord
  derived: DerivedTableStatus
  summaryTotal?: number | null
  onSelect: (table: FnbTableRecord, derived: DerivedTableStatus) => void
}

export function TableCard({ table, derived, summaryTotal, onSelect }: TableCardProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const primaryBill = derived.bills[0] ?? null
  const updatedTime = formatTimeHhMm(derived.updatedAt)

  const statusMeta = {
    EMPTY: {
      label: t('pos.table.statusEmpty'),
      Icon: Check,
      cardClass: 'border-line bg-surface hover:border-action',
      badgeClass: 'bg-surface-sunken text-ink-soft',
    },
    OCCUPIED: {
      label: t('pos.table.statusOccupied'),
      Icon: Utensils,
      cardClass: 'border-2 border-primary-600 bg-primary-50 hover:border-primary-700',
      badgeClass: 'bg-primary-100 text-primary-800',
    },
    AWAITING_PAYMENT: {
      label: t('pos.table.statusAwaitingPayment'),
      Icon: ReceiptText,
      cardClass: 'border-2 border-warning-line bg-warning-soft',
      badgeClass: 'bg-surface text-warning-ink',
    },
    LOCKED_OTHER: {
      label: t('pos.table.statusLockedOther'),
      Icon: Lock,
      cardClass: 'border-2 border-dashed border-violet-line bg-violet-soft',
      badgeClass: 'bg-surface text-violet-ink',
    },
  }[derived.status]

  const StatusIcon = statusMeta.Icon

  return (
    <button
      type="button"
      onClick={() => onSelect(table, derived)}
      className={cn(
        'flex min-h-32 w-full min-w-0 flex-col justify-between gap-2 rounded-card p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none',
        statusMeta.cardClass,
      )}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-h3 font-bold text-ink">{table.code}</div>
          {table.area ? <div className="truncate text-caption text-ink-soft">{table.area}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {derived.billCount >= 2 ? (
            <span className="rounded-pill bg-ink px-2 py-0.5 text-caption font-semibold text-surface tabular-nums">
              {t('pos.table.billCountBadge', { count: derived.billCount })}
            </span>
          ) : null}
          {table.capacity !== null && table.capacity !== undefined ? (
            <span className="inline-flex items-center gap-1 text-caption text-ink-soft tabular-nums">
              <Users className="size-3.5" aria-hidden="true" />
              <span>{table.capacity}</span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {primaryBill ? (
          <div className="flex items-center justify-between gap-2 text-caption font-medium text-ink">
            <span className="truncate font-mono">{primaryBill.billRef}</span>
            {summaryTotal !== null && summaryTotal !== undefined ? (
              <span className="shrink-0 font-mono font-semibold tabular-nums">
                {formatMoney(toMoney(summaryTotal), locale)}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-caption font-semibold',
              statusMeta.badgeClass,
            )}
          >
            <StatusIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{statusMeta.label}</span>
          </span>

          {derived.status === 'LOCKED_OTHER' && updatedTime ? (
            <span className="text-caption text-violet-ink">
              {t('pos.table.updatedAt', { time: updatedTime })}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  )
}
