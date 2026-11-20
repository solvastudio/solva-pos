import { useTranslation } from 'react-i18next'
import { Check, Minus, Plus } from '~/components/ui'
import { formatMoney, toMoney } from '~/lib/kernel'

export interface ShiftVarianceCellProps {
  readonly variance: number | null
}

/**
 * Shift cash variance badge using DESIGN §2.1.7 divergent blue-orange palette
 * (never red/green) plus directional icon and explicit sign (`+` / `−`).
 */
export function ShiftVarianceCell({ variance }: ShiftVarianceCellProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'

  if (variance === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-control bg-surface-subtle px-2 py-0.5 text-caption font-medium text-ink-soft">
        {t('admin.report.variancePending')}
      </span>
    )
  }

  if (variance === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-control bg-surface-subtle px-2 py-0.5 font-mono text-caption font-medium tabular-nums text-ink">
        <Check className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{t('admin.report.varianceZero')}</span>
      </span>
    )
  }

  if (variance < 0) {
    const formatted = formatMoney(toMoney(Math.abs(variance)), locale)
    return (
      <span
        data-variance="negative"
        className="inline-flex items-center gap-1 rounded-control border border-warning-border bg-warning-soft px-2 py-0.5 font-mono text-caption font-semibold tabular-nums text-warning-ink"
      >
        <Minus className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{`−${formatted}`}</span>
      </span>
    )
  }

  const formatted = formatMoney(toMoney(variance), locale)
  return (
    <span
      data-variance="positive"
      className="inline-flex items-center gap-1 rounded-control border border-info-border bg-info-soft px-2 py-0.5 font-mono text-caption font-semibold tabular-nums text-info-ink"
    >
      <Plus className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{`+${formatted}`}</span>
    </span>
  )
}
