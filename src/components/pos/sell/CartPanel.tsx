import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Percent, ShoppingCart, User } from '~/components/ui/icons'
import { formatMoney, toMoney } from '~/lib/kernel'
import type { CartLine, CartMutationErrorCode, CartState } from '~/pos/domain/cart'
import type { CartTotalsView } from '~/pos/hooks/use-cart-totals'
import { CartLineRow } from './CartLineRow'
import type { SellSkuUomOption } from './types'

export interface CartPanelProps {
  cart: CartState
  totals: CartTotalsView
  selectedLineId: string | null
  shiftOpen: boolean
  configBlocked?: boolean
  uomOptionsBySku: ReadonlyMap<string, readonly SellSkuUomOption[]>
  onSelectLine: (lineId: string) => void
  onIncrementLine: (lineId: string) => void
  onDecrementLine: (lineId: string) => void
  onSetQty: (lineId: string, qtyInput: string) => CartMutationErrorCode | null
  onChangeUom: (lineId: string, option: SellSkuUomOption) => CartMutationErrorCode | null
  onOpenPriceEdit: (line: CartLine) => void
  onOpenLineDiscount: (line: CartLine) => void
  onOpenBillDiscount: () => void
  onOpenCustomer: () => void
  onRemoveLine: (lineId: string) => void
  onPay: () => void
}

export function CartPanel({
  cart,
  totals,
  selectedLineId,
  shiftOpen,
  configBlocked = false,
  uomOptionsBySku,
  onSelectLine,
  onIncrementLine,
  onDecrementLine,
  onSetQty,
  onChangeUom,
  onOpenPriceEdit,
  onOpenLineDiscount,
  onOpenBillDiscount,
  onOpenCustomer,
  onRemoveLine,
  onPay,
}: CartPanelProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const { calc, cashTotal, roundingDelta, itemCount } = totals
  const canPay = shiftOpen && !configBlocked && cart.lines.length > 0
  const totalDiscount = calc.lineDiscountTotal + calc.billDiscountTotal

  return (
    <aside
      aria-label={t('pos.cart.title')}
      className="flex w-full min-w-0 shrink-0 flex-col border-t border-line bg-surface md:w-80 lg:w-96 md:border-t-0 md:border-l"
    >
      <div className="flex flex-col gap-2.5 border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <ShoppingCart className="size-4 shrink-0 text-ink-soft" aria-hidden="true" />
            <h2 className="truncate text-h3 font-semibold text-ink">{t('pos.cart.title')}</h2>
          </div>
          <span className="shrink-0 whitespace-nowrap rounded-pill bg-surface-sunken px-2.5 py-0.5 text-caption font-medium text-ink-soft tabular-nums">
            {t('pos.cart.itemsCount', { count: itemCount })}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpenCustomer}
            className="min-w-0 flex-1 justify-start"
          >
            <User className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {cart.customer?.name
                ? cart.customer.name
                : cart.customer?.phone ?? t('pos.cart.customerButton')}
            </span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={cart.lines.length === 0}
            onClick={onOpenBillDiscount}
            className="shrink-0"
          >
            <Percent className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{t('pos.cart.billDiscountButton')}</span>
          </Button>
        </div>
      </div>

      <div role="list" className="flex min-h-48 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {cart.lines.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-card border border-dashed border-line bg-surface-sunken p-6 text-center text-body text-ink-soft">
            {t('pos.cart.empty')}
          </div>
        ) : (
          cart.lines.map((line, index) => {
            const lineCalc = calc.lines[index]
            return (
              <CartLineRow
                key={line.id}
                line={line}
                lineNet={lineCalc?.lineNet ?? line.unitPrice}
                lineDiscount={toMoney(lineCalc?.lineDiscount ?? 0)}
                selected={line.id === selectedLineId}
                uomOptions={uomOptionsBySku.get(line.skuId) ?? []}
                onSelect={() => onSelectLine(line.id)}
                onIncrement={() => onIncrementLine(line.id)}
                onDecrement={() => onDecrementLine(line.id)}
                onSetQty={(q) => onSetQty(line.id, q)}
                onChangeUom={(opt) => onChangeUom(line.id, opt)}
                onOpenPriceEdit={() => onOpenPriceEdit(line)}
                onOpenDiscount={() => onOpenLineDiscount(line)}
                onRemove={() => onRemoveLine(line.id)}
              />
            )
          })
        )}
      </div>

      <div className="border-t border-line bg-surface-sunken p-4">
        <dl className="flex flex-col gap-1.5 text-label">
          <div className="flex justify-between text-ink-soft">
            <dt>{t('pos.cart.subtotal')}</dt>
            <dd className="font-mono tabular-nums">{formatMoney(calc.grossTotal, locale)}</dd>
          </div>

          {totalDiscount > 0 ? (
            <div className="flex justify-between text-warning-ink">
              <dt>{t('pos.cart.discountTotal')}</dt>
              <dd className="font-mono tabular-nums">-{formatMoney(toMoney(totalDiscount), locale)}</dd>
            </div>
          ) : null}

          {calc.serviceCharge > 0 ? (
            <div className="flex justify-between text-ink-soft">
              <dt>{t('pos.cart.serviceCharge')}</dt>
              <dd className="font-mono tabular-nums">{formatMoney(calc.serviceCharge, locale)}</dd>
            </div>
          ) : null}

          {cart.config.taxProfile !== 'NONE' && calc.taxAmount > 0 ? (
            <div className="flex justify-between text-ink-soft">
              <dt>{t('pos.cart.taxLabel', { profile: cart.config.taxProfile })}</dt>
              <dd className="font-mono tabular-nums">{formatMoney(calc.taxAmount, locale)}</dd>
            </div>
          ) : null}

          {roundingDelta !== 0 ? (
            <div className="flex justify-between text-ink-soft">
              <dt>{t('pos.cart.roundingLabel')}</dt>
              <dd className="font-mono tabular-nums">
                {roundingDelta > 0
                  ? `+${formatMoney(toMoney(roundingDelta), locale)}`
                  : `-${formatMoney(toMoney(Math.abs(roundingDelta)), locale)}`}
              </dd>
            </div>
          ) : null}

          <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2 text-h3 font-bold text-ink">
            <dt>{t('pos.cart.grandTotal')}</dt>
            <dd className="font-mono tabular-nums">{formatMoney(calc.grandTotal, locale)}</dd>
          </div>

          {roundingDelta !== 0 ? (
            <div className="flex justify-between text-caption text-ink-soft">
              <dt>{t('pos.cart.cashTotalLabel')}</dt>
              <dd className="font-mono font-semibold tabular-nums">
                {formatMoney(cashTotal, locale)}
              </dd>
            </div>
          ) : null}
        </dl>

        <Button
          type="button"
          variant="primary"
          size="xl"
          fullWidth
          disabled={!canPay}
          onClick={onPay}
          className="mt-4 justify-between border border-transparent disabled:border-line"
        >
          <span>{shiftOpen ? t('pos.cart.payButton') : t('pos.cart.shiftClosedDisabled')}</span>
          {shiftOpen ? (
            <span className="rounded bg-surface/20 px-2 py-0.5 font-mono text-caption">
              {t('pos.cart.payShortcutHint')}
            </span>
          ) : null}
        </Button>
      </div>
    </aside>
  )
}
