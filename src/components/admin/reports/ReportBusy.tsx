import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, CircleAlert } from '~/components/ui'

export interface ReportBusyProps {
  readonly onRetry: () => void | Promise<void>
  readonly cooldownMs?: number
  readonly loading?: boolean
}

/**
 * Renders the DESIGN-standardized "Laporan lain sedang diproses…" banner
 * (`admin.report.busy`) without any error code, enabling "Coba lagi" after ±5s.
 */
export function ReportBusy({
  onRetry,
  cooldownMs = 5000,
  loading = false,
}: ReportBusyProps) {
  const { t } = useTranslation()
  const [canRetry, setCanRetry] = useState(cooldownMs <= 0)

  useEffect(() => {
    if (cooldownMs <= 0) {
      setCanRetry(true)
      return
    }
    setCanRetry(false)
    const timer = setTimeout(() => {
      setCanRetry(true)
    }, cooldownMs)
    return () => clearTimeout(timer)
  }, [cooldownMs])

  return (
    <Card
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-3 border-warning-border bg-warning-soft p-4 text-body-sm text-warning-ink"
    >
      <div className="flex items-center gap-2">
        <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
        <span>{t('admin.report.busy')}</span>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={loading}
        disabled={!canRetry || loading}
        onClick={() => void onRetry()}
      >
        {t('admin.report.retryButton')}
      </Button>
    </Card>
  )
}
