// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeLocale } from '~/i18n'
import { roundToUnit, toMoney } from '~/lib/kernel'
import { calcSale } from '~/lib/sales-calc'
import {
  addItem,
  createEmptyCart,
  setLineDiscount,
  toCalcInput,
  type CartResult,
} from '~/pos/domain/cart'
import { CartPanel } from './CartPanel'

function unwrapCart(res: CartResult | { readonly ok: true; readonly cart: ReturnType<typeof createEmptyCart> } | { readonly ok: false; readonly error: string }) {
  if (!res.ok) throw new Error(`Expected ok cart result, got ${res.error}`)
  return res.cart
}

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
})

describe('CartPanel (SCR-P04)', () => {
  it('displays V-04 grand total (112,476) + cash rounding preview (112,500) and disables Pay when shift is closed', async () => {
    const user = userEvent.setup()
    let cart = createEmptyCart({
      finalizeId: 'f1',
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PPN',
        taxRate: '11',
        serviceChargeEnabled: false,
        serviceChargeRate: '0',
        serviceChargeTaxable: true,
      },
      cashRoundingUnit: 100,
      taxRateId: 't1',
      createdAt: '2026-11-20T01:00:00.000Z',
      shiftId: null,
    })

    cart = unwrapCart(
      addItem(
        cart,
        {
          skuId: 's1',
          productId: 'p1',
          uomId: 'u1',
          skuCode: 'KOP',
          itemName: 'Kopi',
          uomCode: 'pcs',
          conversionFactor: '1',
          taxable: true,
          allowFraction: false,
          price: { kind: 'PRICE', price: toMoney(18_500), source: 'OUTLET' },
        },
        { newId: 'l1', qtyInput: '2' },
      ),
    )

    cart = unwrapCart(
      addItem(
        cart,
        {
          skuId: 's2',
          productId: 'p2',
          uomId: 'u1',
          skuCode: 'GUL',
          itemName: 'Gula 1kg',
          uomCode: 'pcs',
          conversionFactor: '1',
          taxable: true,
          allowFraction: false,
          price: { kind: 'PRICE', price: toMoney(16_000), source: 'DEFAULT' },
        },
        { newId: 'l2' },
      ),
    )

    cart = unwrapCart(
      addItem(
        cart,
        {
          skuId: 's3',
          productId: 'p3',
          uomId: 'u1',
          skuCode: 'SUS',
          itemName: 'Susu UHT 1L',
          uomCode: 'pcs',
          conversionFactor: '1',
          taxable: true,
          allowFraction: false,
          price: { kind: 'PRICE', price: toMoney(17_900), source: 'OUTLET' },
        },
        { newId: 'l3', qtyInput: '3' },
      ),
    )

    cart = unwrapCart(setLineDiscount(cart, 'l3', { type: 'PERCENT', pct: '10' }))

    const calc = calcSale(toCalcInput(cart))
    const cashTotal = toMoney(roundToUnit(calc.grandTotal, cart.cashRoundingUnit))
    const totals = {
      calc,
      cashTotal,
      roundingDelta: cashTotal - calc.grandTotal,
      itemCount: cart.lines.length,
    }

    const onPay = vi.fn()
    const { container, rerender } = render(
      <CartPanel
        cart={cart}
        totals={totals}
        selectedLineId="l1"
        shiftOpen={false}
        uomOptionsBySku={new Map()}
        onSelectLine={vi.fn()}
        onIncrementLine={vi.fn()}
        onDecrementLine={vi.fn()}
        onSetQty={() => null}
        onChangeUom={() => null}
        onOpenPriceEdit={vi.fn()}
        onOpenLineDiscount={vi.fn()}
        onOpenBillDiscount={vi.fn()}
        onOpenCustomer={vi.fn()}
        onRemoveLine={vi.fn()}
        onPay={onPay}
      />,
    )

    expect(screen.getByText(/112[.,]476/)).toBeTruthy()
    expect(screen.getByText(/112[.,]500/)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: /Open a shift to pay/i }) as HTMLButtonElement).disabled,
    ).toBe(true)

    rerender(
      <CartPanel
        cart={{ ...cart, shiftId: 'shift-1' }}
        totals={totals}
        selectedLineId="l1"
        shiftOpen={true}
        uomOptionsBySku={new Map()}
        onSelectLine={vi.fn()}
        onIncrementLine={vi.fn()}
        onDecrementLine={vi.fn()}
        onSetQty={() => null}
        onChangeUom={() => null}
        onOpenPriceEdit={vi.fn()}
        onOpenLineDiscount={vi.fn()}
        onOpenBillDiscount={vi.fn()}
        onOpenCustomer={vi.fn()}
        onRemoveLine={vi.fn()}
        onPay={onPay}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Pay/i }))
    expect(onPay).toHaveBeenCalledOnce()

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])
  })
})
