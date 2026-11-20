import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'
import { formatMoney, type Money } from '~/lib/kernel'
import { Minus, PencilLine, Percent, Plus, Trash2 } from '~/components/ui/icons'
import type { CartLine, CartMutationErrorCode } from '~/pos/domain/cart'
import type { SellSkuUomOption } from './types'
import { UomChip } from './UomChip'

export interface CartLineRowProps {
  line: CartLine
  lineNet: Money
  lineDiscount: Money
  selected: boolean
  uomOptions: readonly SellSkuUomOption[]
  onSelect: () => void
  onIncrement: () => void
  onDecrement: () => void
  onSetQty: (qtyInput: string) => CartMutationErrorCode | null
  onChangeUom: (option: SellSkuUomOption) => CartMutationErrorCode | null
  onOpenPriceEdit: () => void
  onOpenDiscount: () => void
  onRemove: () => void
}

export function CartLineRow({
  line,
  lineNet,
  lineDiscount,
  selected,
  uomOptions,
  onSelect,
  onIncrement,
  onDecrement,
  onSetQty,
  onChangeUom,
  onOpenPriceEdit,
  onOpenDiscount,
  onRemove,
}: CartLineRowProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const [qtyDraft, setQtyDraft] = useState<string>(line.qty)
  const [qtyError, setQtyError] = useState<string | null>(null)

  useEffect(() => {
    setQtyDraft(line.qty)
    setQtyError(null)
  }, [line.qty])

  function commitQty() {
    const trimmed = qtyDraft.trim()
    if (trimmed === line.qty) return
    const err = onSetQty(trimmed)
    if (err) {
      setQtyError(
        err === 'FRACTION_NOT_ALLOWED'
          ? t('pos.cart.qtyErrorFraction')
          : t('pos.cart.qtyErrorInvalid'),
      )
      setQtyDraft(line.qty)
    } else {
      setQtyError(null)
    }
  }

  return (
    <div
      role="listitem"
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-2 rounded-card border p-3 transition-colors',
        selected
          ? 'border-action bg-surface'
          : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-semibold text-ink">{line.itemName}</div>
          {line.variantLabel ? (
            <div className="truncate text-caption text-ink-soft">{line.variantLabel}</div>
          ) : null}
        </div>

        <button
          type="button"
          aria-label={t('pos.cart.removeLine')}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="flex size-8 shrink-0 items-center justify-center rounded-input text-ink-soft hover:bg-danger-soft hover:text-danger-ink"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <UomChip
            currentUomId={line.uomId}
            currentUomCode={line.uomCode}
            options={uomOptions}
            onSelectUom={(opt) => {
              const err = onChangeUom(opt)
              if (err === 'FRACTION_NOT_ALLOWED') {
                setQtyError(t('pos.cart.qtyErrorFraction'))
              } else {
                setQtyError(null)
              }
            }}
          />

          {line.isOpenPrice ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenPriceEdit()
              }}
              className="inline-flex items-center gap-1 rounded-pill border border-action bg-surface-sunken px-2 py-0.5 font-mono text-caption font-medium text-action tabular-nums hover:bg-surface"
            >
              <PencilLine className="size-3" aria-hidden="true" />
              <span>{formatMoney(line.unitPrice, locale)}</span>
            </button>
          ) : (
            <span className="font-mono text-caption text-ink-soft tabular-nums">
              {formatMoney(line.unitPrice, locale)}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpenDiscount()
          }}
          className={cn(
            'inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-caption font-medium',
            lineDiscount > 0
              ? 'border-warning-line bg-warning-soft text-warning-ink'
              : 'border-line bg-surface-sunken text-ink-soft hover:text-ink',
          )}
        >
          <Percent className="size-3" aria-hidden="true" />
          <span>
            {lineDiscount > 0
              ? `-${formatMoney(lineDiscount, locale)}`
              : t('pos.cart.discountButton')}
          </span>
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            aria-label={t('pos.cart.qtyDecrease')}
            onClick={onDecrement}
            className="flex min-h-touch w-11 items-center justify-center rounded-input border border-line bg-surface-sunken text-ink hover:bg-surface"
          >
            <Minus className="size-4" aria-hidden="true" />
          </button>

          <input
            type="text"
            aria-label={t('pos.cart.qtyLabel')}
            value={qtyDraft}
            onChange={(e) => setQtyDraft(e.target.value)}
            onBlur={commitQty}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitQty()
              }
            }}
            className="min-h-touch w-14 rounded-input border border-line bg-surface text-center font-mono text-body font-semibold text-ink tabular-nums focus:border-action focus:ring-2 focus:ring-focus-ring focus:outline-none"
          />

          <button
            type="button"
            aria-label={t('pos.cart.qtyIncrease')}
            onClick={onIncrement}
            className="flex min-h-touch w-11 items-center justify-center rounded-input border border-line bg-surface-sunken text-ink hover:bg-surface"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </div>

        <span className="font-mono text-body font-semibold text-ink tabular-nums">
          {formatMoney(lineNet, locale)}
        </span>
      </div>

      {qtyError ? (
        <div role="alert" className="text-caption text-danger-ink">
          {qtyError}
        </div>
      ) : null}
    </div>
  )
}
