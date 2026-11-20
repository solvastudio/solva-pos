import { useTranslation } from 'react-i18next'
import { SyncIndicator } from '~/components/layout/SyncIndicator'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { Chip, type ChipStatus } from '~/components/ui/Chip'
import { Check, Printer, TriangleAlert } from '~/components/ui/icons'
import { formatMoney, toMoney, type Money } from '~/lib/kernel'
import type { PrintJobRecord, SalePaymentRecord, SaleRecord } from '~/pos/db/types'
import { useSyncState } from '~/pos/hooks/use-sync-state'

export interface SaleDoneProps {
  sale: SaleRecord | null
  payments: readonly SalePaymentRecord[]
  printJob: PrintJobRecord | null
  onReprint?: () => void
  onNewSale: () => void
}

function mapPrintStatusToChip(status: PrintJobRecord['status']): ChipStatus {
  switch (status) {
    case 'DONE':
      return 'synced'
    case 'PRINTING':
      return 'syncing'
    case 'FAILED':
      return 'needs_attention'
    case 'QUEUED':
    default:
      return 'pending'
  }
}

export function SaleDone({
  sale,
  payments,
  printJob,
  onReprint,
  onNewSale,
}: SaleDoneProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const { indicator } = useSyncState()

  if (!sale) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 items-center justify-center p-4">
        <Card className="flex w-full flex-col items-center gap-4 p-6 text-center">
          <p className="text-body text-ink-soft">{t('pos.done.notFound')}</p>
          <Button type="button" variant="primary" size="xl" fullWidth onClick={onNewSale}>
            {t('pos.done.newSaleButton')}
          </Button>
        </Card>
      </div>
    )
  }

  let totalChange = 0
  for (const p of payments) {
    if (p.change_given && p.change_given > 0) {
      totalChange += p.change_given
    }
  }
  const changeMoney: Money = toMoney(totalChange)
  const printStatus = printJob?.status ?? sale.print_state ?? 'QUEUED'

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 items-center justify-center p-4">
      <Card className="flex w-full flex-col gap-5 p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success-ink">
            <Check className="size-6" aria-hidden="true" />
          </div>
          <h1 className="text-h1 font-semibold text-ink">{t('pos.done.title')}</h1>
          <div className="rounded-pill border border-line bg-surface-sunken px-3 py-1 font-mono text-label font-semibold text-ink">
            {sale.invoice_no}
          </div>
        </div>

        <dl className="flex flex-col gap-2 rounded-card border border-line bg-surface-sunken p-4">
          <div className="flex justify-between text-body text-ink-soft">
            <dt>{t('pos.done.totalLabel')}</dt>
            <dd className="font-mono font-semibold text-ink tabular-nums">
              {formatMoney(toMoney(sale.total_due), locale)}
            </dd>
          </div>

          {changeMoney > 0 ? (
            <div className="flex items-baseline justify-between border-t border-line pt-2">
              <dt className="text-h3 font-semibold text-ink">{t('pos.done.changeLabel')}</dt>
              <dd className="font-mono text-h1 font-bold text-action tabular-nums">
                {formatMoney(changeMoney, locale)}
              </dd>
            </div>
          ) : null}
        </dl>

        {printStatus === 'FAILED' ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-card border border-warning-line bg-warning-soft p-3 text-body text-warning-ink"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{t('pos.done.printFailedBanner')}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 text-caption">
          <div className="flex items-center gap-2">
            <span className="text-ink-soft">{t('pos.done.printStatusLabel')}</span>
            <Chip
              status={mapPrintStatusToChip(printStatus)}
              label={t(`pos.done.printStatuses.${printStatus}`)}
              size="sm"
            />
          </div>

          <SyncIndicator indicator={indicator} compact />
        </div>

        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="primary"
            size="xl"
            fullWidth
            autoFocus
            onClick={onNewSale}
          >
            {t('pos.done.newSaleButton')}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="lg"
            fullWidth
            disabled={!onReprint}
            onClick={onReprint}
          >
            <Printer className="size-4" aria-hidden="true" />
            <span>{t('pos.done.reprintButton')}</span>
          </Button>
        </div>
      </Card>
    </div>
  )
}
