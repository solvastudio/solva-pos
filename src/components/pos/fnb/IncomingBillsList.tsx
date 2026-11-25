import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Check, CircleAlert } from '~/components/ui/icons'
import { formatMoney, toMoney } from '~/lib/kernel'
import type { BillSnapshotRecord } from '~/pos/db/types'
import { formatTimeHhMm } from './TableCard'

export interface IncomingBillsListProps {
  bills: readonly BillSnapshotRecord[]
  tableCodeById: ReadonlyMap<string, string>
  canAcceptFn: (bill: BillSnapshotRecord) => boolean
  acceptingBillId: string | null
  errorMessage?: string | null
  onAccept: (billId: string) => void
  onView: (billId: string) => void
}

export function IncomingBillsList({
  bills,
  tableCodeById,
  canAcceptFn,
  acceptingBillId,
  errorMessage = null,
  onAccept,
  onView,
}: IncomingBillsListProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'

  return (
    <section aria-label={t('pos.bill.incomingHeading')} className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h2 className="text-h3 font-semibold text-ink">{t('pos.bill.incomingHeading')}</h2>
        <span className="rounded-pill bg-violet-soft px-2.5 py-0.5 text-caption font-semibold text-violet-ink tabular-nums">
          {bills.length}
        </span>
      </div>

      {errorMessage ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-card bg-danger-soft px-3 py-2 text-body-sm text-danger-ink"
        >
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      {bills.length === 0 ? (
        <p className="rounded-card border border-dashed border-line bg-surface-sunken p-4 text-body-sm text-ink-soft">
          {t('pos.bill.noIncoming')}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {bills.map((b) => {
            const activeItems = b.items.filter((i) => i.status === 'ACTIVE')
            const estGross = activeItems.reduce(
              (acc, it) => acc + Math.round(Number(it.qty) * it.unit_price),
              0,
            )
            const tableCode = tableCodeById.get(b.table_id) ?? b.table_id
            const acceptedAllowed = canAcceptFn(b)
            return (
              <div
                key={b.bill_id}
                className="flex items-center justify-between gap-3 rounded-card border-2 border-violet-line bg-violet-soft p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-label font-bold text-ink">{b.bill_ref}</span>
                    <span className="rounded bg-surface px-1.5 py-0.5 text-caption font-medium text-ink">
                      {tableCode}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-caption text-ink-soft">
                    <span className="font-mono font-semibold text-ink tabular-nums">
                      {formatMoney(toMoney(estGross), locale)}
                    </span>
                    {b.customer_name ? <span>· {b.customer_name}</span> : null}
                    {b.last_event_at ? (
                      <span>· {t('pos.table.updatedAt', { time: formatTimeHhMm(b.last_event_at) })}</span>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onView(b.bill_id)}
                  >
                    {t('pos.bill.openBillAction')}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    disabled={!acceptedAllowed}
                    loading={acceptingBillId === b.bill_id}
                    leadingIcon={<Check className="size-4" aria-hidden="true" />}
                    onClick={() => onAccept(b.bill_id)}
                  >
                    {t('pos.bill.acceptButton')}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
