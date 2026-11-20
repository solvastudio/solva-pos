// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeLocale } from '~/i18n'
import { toMoney } from '~/lib/kernel'
import type { PaymentMethodRecord } from '~/pos/db/types'
import { addItem, createEmptyCart, setBillDiscount, type CartState } from '~/pos/domain/cart'
import { getSessionState } from '~/pos/session/session'
import { PaymentScreen } from './PaymentScreen'

function mustOk<T extends { readonly ok: true; readonly cart: CartState } | { readonly ok: false; readonly error: string }>(res: T): CartState {
  if (!res.ok) throw new Error(`Cart error: ${res.error}`)
  return res.cart
}

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
})

const METHODS: PaymentMethodRecord[] = [
  {
    id: 'm-cash',
    code: 'CASH',
    name: 'Tunai',
    kind: 'CASH',
    requires_reference: false,
    sort_order: 1,
    is_active: true,
    deleted_at: null,
  },
  {
    id: 'm-qris',
    code: 'QRIS',
    name: 'QRIS',
    kind: 'NON_CASH',
    requires_reference: false,
    sort_order: 2,
    is_active: true,
    deleted_at: null,
  },
]

function makeMixedCart() {
  let cart = createEmptyCart({
    finalizeId: 'fin-1',
    config: {
      priceTaxMode: 'EXCLUSIVE',
      taxProfile: 'PB1',
      taxRate: '10',
      serviceChargeEnabled: true,
      serviceChargeRate: '5',
      serviceChargeTaxable: true,
    },
    cashRoundingUnit: 100,
    taxRateId: 't1',
    createdAt: '2026-11-30T10:00:00.000Z',
    shiftId: 'shift-1',
  })
  cart = mustOk(addItem(
    cart,
    {
      skuId: 's1',
      productId: 'p1',
      uomId: 'u1',
      skuCode: 'NGR',
      itemName: 'Nasi Goreng',
      uomCode: 'pcs',
      conversionFactor: '1',
      taxable: true,
      allowFraction: false,
      price: { kind: 'PRICE', price: toMoney(45_000), source: 'OUTLET' },
    },
    { newId: 'l1', qtyInput: '2' },
  ))
  cart = mustOk(addItem(
    cart,
    {
      skuId: 's2',
      productId: 'p2',
      uomId: 'u1',
      skuCode: 'ETM',
      itemName: 'Es Teh',
      uomCode: 'pcs',
      conversionFactor: '1',
      taxable: true,
      allowFraction: false,
      price: { kind: 'PRICE', price: toMoney(12_000), source: 'DEFAULT' },
    },
    { newId: 'l2', qtyInput: '3' },
  ))
  cart = mustOk(addItem(
    cart,
    {
      skuId: 's3',
      productId: 'p3',
      uomId: 'u1',
      skuCode: 'AIR',
      itemName: 'Air Mineral',
      uomCode: 'pcs',
      conversionFactor: '1',
      taxable: false,
      allowFraction: false,
      price: { kind: 'PRICE', price: toMoney(8_000), source: 'DEFAULT' },
    },
    { newId: 'l3' },
  ))
  return mustOk(setBillDiscount(cart, { type: 'NOMINAL', input: toMoney(15_000) }))
}

describe('PaymentScreen (SCR-P08)', () => {
  it('supports mixed QRIS + Cash split, blocks overpaying non-cash, computes change, pauses idle lock, and passes axe', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    const cart = makeMixedCart() // grandTotal 136,735

    const { container, unmount } = render(
      <PaymentScreen
        cart={cart}
        paymentMethods={METHODS}
        onBack={vi.fn()}
        onComplete={onComplete}
      />,
    )

    expect(getSessionState().paymentInProgress).toBe(true)

    // Switch to QRIS and attempt > 136,735 -> blocked with message
    await user.click(screen.getByRole('button', { name: 'QRIS' }))
    const amtInput = screen.getByLabelText(/Payment amount/i) as HTMLInputElement
    await user.clear(amtInput)
    await user.type(amtInput, '200000')
    expect(screen.getByText(/cannot exceed remaining balance/i)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: /Add payment/i }) as HTMLButtonElement).disabled,
    ).toBe(true)

    // Add valid partial QRIS 100,000
    await user.clear(amtInput)
    await user.type(amtInput, '100000')
    await user.click(screen.getByRole('button', { name: /Add payment/i }))

    // Switch to Cash and pay 50,000 (rounding -35 -> applied 36,700 -> change 13,300)
    await user.click(screen.getByRole('button', { name: 'Tunai' }))
    const cashInput = screen.getByLabelText(/Cash received/i) as HTMLInputElement
    await user.clear(cashInput)
    await user.type(cashInput, '50000')
    await user.click(screen.getByRole('button', { name: /Add payment/i }))

    expect(screen.getByText(/13[.,]300/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Complete Sale/i }))
    expect(onComplete).toHaveBeenCalledOnce()

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])

    unmount()
    expect(getSessionState().paymentInProgress).toBe(false)
  })
})
