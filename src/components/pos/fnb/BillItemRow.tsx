import { useTranslation } from 'react-i18next'
import { Minus, Percent, Plus, Trash2 } from '~/components/ui/icons'
import { formatMoney, toMoney, type Money } from '~/lib/kernel'

export interface BillPanelItemView {
  readonly id: string
  readonly lineNo: number
  readonly itemName: string
  readonly uomCode: string
  readonly qty: string
  readonly unitPrice: number
  readonly discountType: 'PERCENT' | 'NOMINAL' | null
  readonly discountPct: string | null
  readonly discountInput: number | null
  readonly note: string | null
  readonly status: 'ACTIVE' | 'VOIDED' | 'MOVED'
  readonly voidReasonText?: string | null
  readonly modifiers: readonly {
    readonly modifierId: string
    readonly name: string
    readonly priceDelta: number
    readonly qty: number
  }[]
}

export interface BillItemRowProps {
  item: BillPanelItemView
  lineNet: Money
  lineDiscount: Money
  editable: boolean
  onChangeQty: (itemId: string, nextQty: string) => void
  onEditModifiers?: (item: BillPanelItemView) => void
  onOpenDiscount: (item: BillPanelItemView) => void
  onRequestVoid: (item: BillPanelItemView) => void
}

export function BillItemRow({
  item,
  lineNet,
  lineDiscount,
  editable,
  onChangeQty,
  onEditModifiers,
  onOpenDiscount,
  onRequestVoid,
}: BillItemRowProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const numQty = Number(item.qty)

  return (
    <div
      role="listitem"
      className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-2.5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-semibold text-ink">{item.itemName}</div>
          {item.modifiers.length > 0 ? (
            <div className="mt-0.5 flex flex-wrap gap-1 text-caption text-ink-soft">
              {item.modifiers.map((m) => (
                <span key={m.modifierId} className="rounded bg-surface-sunken px-1.5 py-0.5">
                  {`+ ${m.name}`}
                </span>
              ))}
            </div>
          ) : null}
          {item.note ? <div className="mt-0.5 text-caption italic text-ink-soft">{item.note}</div> : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <span className="font-mono text-body font-semibold text-ink tabular-nums">
            {formatMoney(lineNet, locale)}
          </span>
          {editable ? (
            <button
              type="button"
              aria-label={`${t('pos.bill.voidItemButton')} ${item.itemName}`}
              onClick={() => onRequestVoid(item)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-card text-danger-ink hover:bg-danger-soft focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {editable ? (
            <>
              <button
                type="button"
                aria-label={`${item.itemName} -`}
                disabled={!Number.isFinite(numQty) || numQty <= 1}
                onClick={() => {
                  const next = Math.max(1, numQty - 1)
                  onChangeQty(item.id, String(next))
                }}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-card border border-line bg-surface-sunken text-ink disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-subtle"
              >
                <Minus className="size-4" aria-hidden="true" />
              </button>
              <span className="min-w-8 text-center font-mono text-label font-semibold text-ink tabular-nums">
                {item.qty}
              </span>
              <button
                type="button"
                aria-label={`${item.itemName} +`}
                onClick={() => {
                  const next = (Number.isFinite(numQty) ? numQty : 1) + 1
                  onChangeQty(item.id, String(next))
                }}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-card border border-line bg-surface-sunken text-ink"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </>
          ) : (
            <span className="font-mono text-caption text-ink-soft tabular-nums">
              {item.qty} {item.uomCode}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="font-mono text-caption text-ink-soft tabular-nums">
            {`@ ${formatMoney(toMoney(item.unitPrice), locale)}`}
          </span>
          {lineDiscount > 0 ? (
            <span className="rounded bg-warning-soft px-1.5 py-0.5 font-mono text-caption text-warning-ink">
              -{formatMoney(lineDiscount, locale)}
            </span>
          ) : null}
          {editable && onEditModifiers ? (
            <button
              type="button"
              onClick={() => onEditModifiers(item)}
              className="min-h-11 rounded-card border border-line px-2 text-caption font-medium text-ink hover:bg-surface-sunken"
            >
              {t('pos.bill.modifierShort')}
            </button>
          ) : null}
          {editable ? (
            <button
              type="button"
              aria-label={`Discount ${item.itemName}`}
              onClick={() => onOpenDiscount(item)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-card border border-line text-ink-soft hover:bg-surface-sunken"
            >
              <Percent className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
