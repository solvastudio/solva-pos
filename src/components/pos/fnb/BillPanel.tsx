import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import {
  ChevronDown,
  ChevronUp,
  CreditCard,
  Percent,
  Send,
  User,
} from '~/components/ui/icons'
import { formatMoney, toMoney } from '~/lib/kernel'
import type { EditBillDeniedReason, HandoverCheck } from '~/pos/domain/bill-guards'
import type { BillTotalsView } from '~/pos/domain/bill-totals'
import { BillItemRow, type BillPanelItemView } from './BillItemRow'
import { PrebillButton } from './PrebillButton'
import { ReadOnlyBanner } from './ReadOnlyBanner'

export interface BillPanelProps {
  billRef: string
  tableLabel: string
  customerName: string | null
  isAwaitingPayment: boolean
  handoverStatus: 'NONE' | 'PENDING'
  handoverTargetLabel?: string | null
  editable: boolean
  itemsEditable?: boolean
  readOnlyReason: EditBillDeniedReason | null
  shareBadge?: string | null
  siblingListNode?: ReactNode
  updatedAt?: string | null
  canCancelHandover?: boolean
  canSplit?: boolean
  canMerge?: boolean
  items: readonly BillPanelItemView[]
  totals: BillTotalsView
  taxProfile: 'NONE' | 'PPN' | 'PB1'
  taxRate: string
  pendingOutboxCount: number
  isWaiter: boolean
  canPayBill: boolean
  handoverCheck: HandoverCheck
  busyAction?: boolean
  onOpenCustomer: () => void
  onOpenBillDiscount: () => void
  onOpenChangeTable: () => void
  onOpenSplit?: () => void
  onOpenMerge?: () => void
  onChangeQty: (itemId: string, nextQty: string) => void
  onEditModifiers?: (item: BillPanelItemView) => void
  onOpenLineDiscount: (item: BillPanelItemView) => void
  onRequestVoid: (item: BillPanelItemView) => void
  onPrintPrebill: () => void
  onOpenHandover: () => void
  onCancelHandover?: () => void
  onCancelBill: () => void
  onPayBill: () => void
}

export function BillPanel({
  billRef,
  tableLabel,
  customerName,
  isAwaitingPayment,
  handoverStatus,
  handoverTargetLabel,
  editable,
  itemsEditable = editable,
  readOnlyReason,
  shareBadge = null,
  siblingListNode = null,
  updatedAt,
  canCancelHandover = false,
  canSplit = false,
  canMerge = false,
  items,
  totals,
  taxProfile,
  taxRate,
  pendingOutboxCount,
  isWaiter,
  canPayBill,
  handoverCheck,
  busyAction = false,
  onOpenCustomer,
  onOpenBillDiscount,
  onOpenChangeTable,
  onOpenSplit,
  onOpenMerge,
  onChangeQty,
  onEditModifiers,
  onOpenLineDiscount,
  onRequestVoid,
  onPrintPrebill,
  onOpenHandover,
  onCancelHandover,
  onCancelBill,
  onPayBill,
}: BillPanelProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const [voidExpanded, setVoidExpanded] = useState(false)

  const activeItems = items.filter((it) => it.status === 'ACTIVE')
  const voidedItems = items.filter((it) => it.status === 'VOIDED')

  let handoverDisabledReason: string | null = null
  if (!handoverCheck.ok) {
    if (handoverCheck.reason === 'OFFLINE') handoverDisabledReason = t('pos.handover.disabledOffline')
    else if (handoverCheck.reason === 'EVENTS_PENDING') handoverDisabledReason = t('pos.handover.disabledPending')
    else if (handoverCheck.reason === 'NO_TARGET_REGISTER') handoverDisabledReason = t('pos.handover.disabledNoTarget')
  }

  return (
    <aside
      aria-label={billRef}
      className="flex min-h-0 w-full min-w-0 shrink-0 flex-col border-t border-line bg-surface md:h-full md:w-88 lg:w-96 md:border-t-0 md:border-l"
    >
      {!editable && readOnlyReason ? (
        <ReadOnlyBanner
          reason={readOnlyReason}
          updatedAt={updatedAt}
          canCancelHandover={canCancelHandover}
          cancelingHandover={busyAction}
          onCancelHandover={onCancelHandover}
        />
      ) : null}

      <div className="flex shrink-0 flex-col gap-2 border-b border-line px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-h3 font-bold text-ink">{billRef}</span>
              <span className="rounded bg-surface-sunken px-2 py-0.5 text-caption font-medium text-ink-soft">
                {tableLabel}
              </span>
            </div>
            {isAwaitingPayment ? (
              <span className="mt-1 inline-block rounded-pill bg-warning-soft px-2 py-0.5 text-caption font-semibold text-warning-ink">
                {t('pos.bill.statusAwaitingPaymentBadge')}
              </span>
            ) : null}
            {shareBadge ? (
              <span className="mt-1 ml-1 inline-block rounded-pill bg-info-soft px-2 py-0.5 text-caption font-semibold text-info-ink">
                {shareBadge}
              </span>
            ) : null}
          </div>

          <div
            aria-live="polite"
            className="text-right text-caption font-medium text-ink-soft"
          >
            {handoverStatus === 'PENDING' && handoverTargetLabel ? (
              <span className="text-violet-ink">
                {t('pos.handover.pendingStatus', { register: handoverTargetLabel })}
              </span>
            ) : pendingOutboxCount > 0 ? (
              <span className="text-warning-ink">
                {t('pos.bill.pendingSyncBadge', { count: pendingOutboxCount })}
              </span>
            ) : (
              <span>{t('pos.bill.syncedBadge')}</span>
            )}
          </div>
        </div>

        {itemsEditable ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" variant="secondary" size="sm" onClick={onOpenCustomer}>
              <User className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="max-w-28 truncate">
                {customerName ?? t('pos.cart.customerButton')}
              </span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={activeItems.length === 0}
              onClick={onOpenBillDiscount}
            >
              <Percent className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{t('pos.cart.billDiscountButton')}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onOpenChangeTable}>
              {t('pos.bill.changeTableButton')}
            </Button>
            {canSplit && onOpenSplit ? (
              <Button type="button" variant="ghost" size="sm" onClick={onOpenSplit}>
                {t('pos.bill.splitButton')}
              </Button>
            ) : null}
            {canMerge && onOpenMerge ? (
              <Button type="button" variant="ghost" size="sm" onClick={onOpenMerge}>
                {t('pos.bill.mergeButton')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {siblingListNode}

      <div role="list" className="flex min-h-40 flex-1 flex-col gap-1.5 overflow-y-auto p-2.5">
        {activeItems.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-card border border-dashed border-line bg-surface-sunken p-5 text-center text-body-sm text-ink-soft">
            {t('pos.bill.emptyItems')}
          </div>
        ) : (
          activeItems.map((item, idx) => {
            const lc = totals.calc.lines[idx]
            return (
              <BillItemRow
                key={item.id}
                item={item}
                lineNet={lc?.lineNet ?? toMoney(item.unitPrice)}
                lineDiscount={toMoney(lc?.lineDiscount ?? 0)}
                editable={itemsEditable}
                onChangeQty={onChangeQty}
                onEditModifiers={onEditModifiers}
                onOpenDiscount={onOpenLineDiscount}
                onRequestVoid={onRequestVoid}
              />
            )
          })
        )}

        {voidedItems.length > 0 ? (
          <div className="mt-2 rounded-card border border-line bg-surface-sunken p-2">
            <button
              type="button"
              onClick={() => setVoidExpanded((v) => !v)}
              className="flex min-h-11 w-full items-center justify-between text-caption font-semibold text-ink-soft"
            >
              <span>{t('pos.bill.voidedSection', { count: voidedItems.length })}</span>
              {voidExpanded ? (
                <ChevronUp className="size-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-4" aria-hidden="true" />
              )}
            </button>
            {voidExpanded ? (
              <ul className="mt-1.5 flex flex-col gap-1 border-t border-line pt-1.5 text-caption text-ink-soft">
                {voidedItems.map((v) => (
                  <li key={v.id} className="flex justify-between gap-2 line-through">
                    <span className="truncate">
                      {`${v.qty}x ${v.itemName}`}
                    </span>
                    {v.voidReasonText ? <span className="shrink-0">{v.voidReasonText}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-2.5 border-t border-line bg-surface px-3.5 py-3">
        <div className="flex flex-col gap-1 text-body-sm">
          <div className="flex justify-between text-ink-soft">
            <span>{t('receipt.subtotal')}</span>
            <span className="font-mono tabular-nums">
              {formatMoney(totals.calc.netSubtotal, locale)}
            </span>
          </div>
          {totals.calc.billDiscountTotal > 0 ? (
            <div className="flex justify-between text-warning-ink">
              <span>{t('receipt.billDiscount')}</span>
              <span className="font-mono tabular-nums">
                -{formatMoney(totals.calc.billDiscountTotal, locale)}
              </span>
            </div>
          ) : null}
          {totals.calc.serviceCharge > 0 ? (
            <div className="flex justify-between text-ink-soft">
              <span>{t('receipt.serviceCharge')}</span>
              <span className="font-mono tabular-nums">
                {formatMoney(totals.calc.serviceCharge, locale)}
              </span>
            </div>
          ) : null}
          {taxProfile !== 'NONE' && totals.calc.taxAmount > 0 ? (
            <div className="flex justify-between text-ink-soft">
              <span>
                {t('receipt.taxLine', {
                  profile: taxProfile,
                  rate: taxRate.replace(/\.?0+$/, ''),
                })}
              </span>
              <span className="font-mono tabular-nums">
                {formatMoney(totals.calc.taxAmount, locale)}
              </span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-line pt-1.5 text-h3 font-bold text-ink">
            <span>{t('receipt.total')}</span>
            <span className="font-mono tabular-nums">
              {formatMoney(totals.calc.grandTotal, locale)}
            </span>
          </div>
        </div>

        {editable ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <PrebillButton
                disabled={(activeItems.length === 0 && !shareBadge) || busyAction}
                onClick={onPrintPrebill}
              />

              {activeItems.length === 0 && !shareBadge ? (
                <Button
                  type="button"
                  variant="danger-outline"
                  size="md"
                  disabled={busyAction}
                  onClick={onCancelBill}
                >
                  {t('pos.bill.cancelBillButton')}
                </Button>
              ) : null}

              {isWaiter || !canPayBill ? (
                <Button
                  type="button"
                  variant={isWaiter ? 'primary' : 'secondary'}
                  size="md"
                  disabled={!handoverCheck.ok || activeItems.length === 0 || busyAction}
                  leadingIcon={<Send className="size-4" aria-hidden="true" />}
                  onClick={onOpenHandover}
                  className="flex-1"
                >
                  {t('pos.bill.handoverButton')}
                </Button>
              ) : null}
            </div>

            {handoverDisabledReason ? (
              <p role="note" className="text-caption text-ink-soft">
                {handoverDisabledReason}
              </p>
            ) : null}

            {!isWaiter ? (
              <div className="flex gap-2">
                {handoverCheck.ok && activeItems.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    disabled={busyAction}
                    onClick={onOpenHandover}
                  >
                    <Send className="size-4" aria-hidden="true" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  disabled={!canPayBill || busyAction}
                  leadingIcon={<CreditCard className="size-4" aria-hidden="true" />}
                  onClick={onPayBill}
                  className="flex-1"
                >
                  {t('pos.bill.payButton')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  )
}
