import {
  addQty,
  parseQty,
  QtyError,
  qtyToBase,
  toMoney,
  type CashRoundingUnit,
  type Money,
  type Qty,
} from '~/lib/kernel'
import type { DiscountInput, SaleCalcInput, SaleConfigSnapshot } from '~/lib/sales-calc'
import type { PriceResolution } from '~/modules/catalog/shared'

export type CartPriceSource = 'OUTLET' | 'TENANT_DEFAULT' | 'OPEN_PRICE'

export interface CartDiscount {
  readonly type: 'PERCENT' | 'NOMINAL'
  readonly pct?: string
  readonly input?: Money
  readonly approvedBy?: string
  readonly reason?: string
}

export interface CartLine {
  readonly id: string
  readonly lineNo: number
  readonly skuId: string
  readonly productId: string
  readonly uomId: string
  readonly skuCode: string
  readonly itemName: string
  readonly variantLabel?: string
  readonly uomCode: string
  readonly qty: Qty
  readonly conversionFactor: Qty
  readonly qtyBase: Qty
  readonly unitPrice: Money
  readonly priceSource: CartPriceSource
  readonly isOpenPrice: boolean
  readonly taxable: boolean
  readonly allowFraction: boolean
  readonly discount?: CartDiscount
  readonly note?: string
  readonly sourceBillItemId?: string | null
  readonly modifiers?: readonly {
    readonly modifier_id: string | null
    readonly name: string
    readonly price_delta: Money
    readonly qty: number
  }[]
}

export interface CartCustomer {
  readonly name?: string
  readonly phone?: string
}

export interface CartState {
  readonly finalizeId: string
  readonly lines: readonly CartLine[]
  readonly billDiscount?: CartDiscount
  readonly customer?: CartCustomer
  readonly config: SaleConfigSnapshot
  readonly cashRoundingUnit: CashRoundingUnit
  readonly taxRateId: string | null
  readonly createdAt: string
  readonly shiftId: string | null
  readonly billId?: string | null
  readonly billRef?: string | null
}

export interface ResolvedCartItem {
  readonly skuId: string
  readonly productId: string
  readonly uomId: string
  readonly skuCode: string
  readonly itemName: string
  readonly variantLabel?: string
  readonly uomCode: string
  readonly conversionFactor: string | Qty
  readonly taxable: boolean
  readonly allowFraction: boolean
  readonly price: PriceResolution
}

export type CartMutationErrorCode =
  | 'NO_PRICE'
  | 'INVALID_FORMAT'
  | 'SCALE_EXCEEDED'
  | 'FRACTION_NOT_ALLOWED'
  | 'NOT_POSITIVE'
  | 'LINE_NOT_FOUND'
  | 'INVALID_PRICE'
  | 'INVALID_DISCOUNT'
  | 'INVALID_CUSTOMER'

export type CartResult =
  | { readonly ok: true; readonly cart: CartState }
  | { readonly ok: false; readonly error: CartMutationErrorCode }

function renumberLines(lines: readonly CartLine[]): CartLine[] {
  return lines.map((line, idx) => ({ ...line, lineNo: idx + 1 }))
}

function normalizeQtyText(raw: string): string {
  return raw.trim().replace(',', '.')
}

function toBaseResult(
  qtyStr: string,
  factor: Qty,
  allowFraction: boolean,
): { readonly ok: true; readonly qty: Qty; readonly qtyBase: Qty } | { readonly ok: false; readonly error: CartMutationErrorCode } {
  try {
    const qty = parseQty(normalizeQtyText(qtyStr))
    const qtyBase = qtyToBase({ qty, factor, allowFraction })
    return { ok: true, qty, qtyBase }
  } catch (err) {
    if (err instanceof QtyError) {
      return { ok: false, error: err.code }
    }
    return { ok: false, error: 'INVALID_FORMAT' }
  }
}

export function createEmptyCart(params: {
  finalizeId: string
  config: SaleConfigSnapshot
  cashRoundingUnit: CashRoundingUnit
  taxRateId: string | null
  createdAt: string
  shiftId: string | null
}): CartState {
  return {
    finalizeId: params.finalizeId,
    lines: [],
    config: params.config,
    cashRoundingUnit: params.cashRoundingUnit,
    taxRateId: params.taxRateId,
    createdAt: params.createdAt,
    shiftId: params.shiftId,
  }
}

/**
 * Adds a resolved catalog/scan item to the cart. Identical `(skuId, uomId)` non-open-price
 * lines without custom discount or note merge quantities monotonically (`BR-POS` / `FLOW-04`).
 * `NO_PRICE` items are rejected (`FR-PRC-002`).
 */
export function addItem(
  cart: CartState,
  item: ResolvedCartItem,
  opts: {
    newId: string
    qtyInput?: string
    openPriceOverride?: number
  },
): { readonly ok: true; readonly cart: CartState; readonly touchedLineId: string } | { readonly ok: false; readonly error: CartMutationErrorCode } {
  if (item.price.kind === 'NO_PRICE') {
    return { ok: false, error: 'NO_PRICE' }
  }

  let unitPrice: Money
  let priceSource: CartPriceSource
  const isOpenPrice = item.price.kind === 'OPEN_PRICE'

  if (item.price.kind === 'OPEN_PRICE') {
    const chosen = opts.openPriceOverride
    if (chosen === undefined || !Number.isSafeInteger(chosen) || chosen <= 0) {
      return { ok: false, error: 'INVALID_PRICE' }
    }
    unitPrice = toMoney(chosen)
    priceSource = 'OPEN_PRICE'
  } else {
    unitPrice = item.price.price
    priceSource = item.price.source === 'OUTLET' ? 'OUTLET' : 'TENANT_DEFAULT'
  }

  const factor = parseQty(String(item.conversionFactor))
  const addQtyRes = toBaseResult(opts.qtyInput ?? '1', factor, item.allowFraction)
  if (!addQtyRes.ok) {
    return addQtyRes
  }

  // Merge non-open-price lines sharing (skuId, uomId) with no distinct discount/note
  if (!isOpenPrice) {
    const mergeIdx = cart.lines.findIndex(
      (l) =>
        !l.isOpenPrice &&
        l.skuId === item.skuId &&
        l.uomId === item.uomId &&
        l.discount === undefined &&
        l.note === undefined,
    )
    if (mergeIdx >= 0) {
      const existing = cart.lines[mergeIdx]!
      const combinedQty = addQty(existing.qty, addQtyRes.qty)
      const combinedRes = toBaseResult(combinedQty, factor, item.allowFraction)
      if (!combinedRes.ok) {
        return combinedRes
      }
      const nextLines = cart.lines.map((l, idx) =>
        idx === mergeIdx ? { ...l, qty: combinedRes.qty, qtyBase: combinedRes.qtyBase } : l,
      )
      return {
        ok: true,
        cart: { ...cart, lines: nextLines },
        touchedLineId: existing.id,
      }
    }
  }

  const nextLine: CartLine = {
    id: opts.newId,
    lineNo: cart.lines.length + 1,
    skuId: item.skuId,
    productId: item.productId,
    uomId: item.uomId,
    skuCode: item.skuCode,
    itemName: item.itemName,
    ...(item.variantLabel ? { variantLabel: item.variantLabel } : {}),
    uomCode: item.uomCode,
    qty: addQtyRes.qty,
    conversionFactor: factor,
    qtyBase: addQtyRes.qtyBase,
    unitPrice,
    priceSource,
    isOpenPrice,
    taxable: item.taxable,
    allowFraction: item.allowFraction,
  }

  return {
    ok: true,
    cart: { ...cart, lines: [...cart.lines, nextLine] },
    touchedLineId: nextLine.id,
  }
}

export function setQty(
  cart: CartState,
  lineId: string,
  qtyInput: string,
  allowFractionOverride?: boolean,
): CartResult {
  const idx = cart.lines.findIndex((l) => l.id === lineId)
  if (idx < 0) {
    return { ok: false, error: 'LINE_NOT_FOUND' }
  }
  const line = cart.lines[idx]!
  const allowFrac = allowFractionOverride ?? line.allowFraction
  const res = toBaseResult(qtyInput, line.conversionFactor, allowFrac)
  if (!res.ok) {
    return res
  }

  const nextLines = cart.lines.map((l, i) =>
    i === idx ? { ...l, qty: res.qty, qtyBase: res.qtyBase } : l,
  )
  return { ok: true, cart: { ...cart, lines: nextLines } }
}

export function changeUom(
  cart: CartState,
  lineId: string,
  newUom: {
    uomId: string
    code: string
    factor: string | Qty
    allowFraction?: boolean
    price: PriceResolution
  },
): CartResult {
  const idx = cart.lines.findIndex((l) => l.id === lineId)
  if (idx < 0) {
    return { ok: false, error: 'LINE_NOT_FOUND' }
  }
  if (newUom.price.kind === 'NO_PRICE') {
    return { ok: false, error: 'NO_PRICE' }
  }

  const line = cart.lines[idx]!
  const nextFactor = parseQty(String(newUom.factor))
  const allowFrac = newUom.allowFraction ?? line.allowFraction
  const baseRes = toBaseResult(line.qty, nextFactor, allowFrac)
  if (!baseRes.ok) {
    return baseRes
  }

  const unitPrice: Money =
    newUom.price.kind === 'OPEN_PRICE' ? line.unitPrice : newUom.price.price
  const priceSource: CartPriceSource =
    newUom.price.kind === 'OPEN_PRICE'
      ? 'OPEN_PRICE'
      : newUom.price.source === 'OUTLET'
        ? 'OUTLET'
        : 'TENANT_DEFAULT'

  const nextLines = cart.lines.map((l, i) =>
    i === idx
      ? {
          ...l,
          uomId: newUom.uomId,
          uomCode: newUom.code,
          conversionFactor: nextFactor,
          qtyBase: baseRes.qtyBase,
          unitPrice,
          priceSource,
          isOpenPrice: newUom.price.kind === 'OPEN_PRICE',
        }
      : l,
  )
  return { ok: true, cart: { ...cart, lines: nextLines } }
}

export function setLineDiscount(
  cart: CartState,
  lineId: string,
  discount: CartDiscount | null,
): CartResult {
  const idx = cart.lines.findIndex((l) => l.id === lineId)
  if (idx < 0) {
    return { ok: false, error: 'LINE_NOT_FOUND' }
  }
  if (discount !== null) {
    if (discount.type === 'PERCENT' && (!discount.pct || Number(discount.pct) < 0 || Number(discount.pct) > 100)) {
      return { ok: false, error: 'INVALID_DISCOUNT' }
    }
    if (discount.type === 'NOMINAL' && (discount.input === undefined || !Number.isSafeInteger(discount.input) || discount.input < 0)) {
      return { ok: false, error: 'INVALID_DISCOUNT' }
    }
  }

  const nextLines = cart.lines.map((l, i) => {
    if (i !== idx) return l
    if (discount === null) {
      const rest = { ...l }
      delete (rest as { discount?: CartDiscount }).discount
      return rest
    }
    return { ...l, discount }
  })
  return { ok: true, cart: { ...cart, lines: nextLines } }
}

export function setBillDiscount(
  cart: CartState,
  discount: CartDiscount | null,
): CartResult {
  if (discount === null) {
    const rest = { ...cart }
    delete (rest as { billDiscount?: CartDiscount }).billDiscount
    return { ok: true, cart: rest }
  }
  if (discount.type === 'PERCENT' && (!discount.pct || Number(discount.pct) < 0 || Number(discount.pct) > 100)) {
    return { ok: false, error: 'INVALID_DISCOUNT' }
  }
  if (discount.type === 'NOMINAL' && (discount.input === undefined || !Number.isSafeInteger(discount.input) || discount.input < 0)) {
    return { ok: false, error: 'INVALID_DISCOUNT' }
  }
  return { ok: true, cart: { ...cart, billDiscount: discount } }
}

/**
 * Updates unit price on an `isOpenPrice` line (`unitPrice > 0` integer IDR; BR-PRC-007, EC-055).
 * Fixed-price catalog items can never be overwritten directly.
 */
export function setOpenPrice(cart: CartState, lineId: string, price: number): CartResult {
  const idx = cart.lines.findIndex((l) => l.id === lineId)
  if (idx < 0) {
    return { ok: false, error: 'LINE_NOT_FOUND' }
  }
  const line = cart.lines[idx]!
  if (!line.isOpenPrice || !Number.isSafeInteger(price) || price <= 0) {
    return { ok: false, error: 'INVALID_PRICE' }
  }
  const nextLines = cart.lines.map((l, i) =>
    i === idx ? { ...l, unitPrice: toMoney(price), priceSource: 'OPEN_PRICE' as const } : l,
  )
  return { ok: true, cart: { ...cart, lines: nextLines } }
}

export function setCustomer(cart: CartState, customer: CartCustomer | null): CartResult {
  if (customer === null) {
    const rest = { ...cart }
    delete (rest as { customer?: CartCustomer }).customer
    return { ok: true, cart: rest }
  }
  const name = customer.name?.trim()
  const phone = customer.phone?.trim()
  if ((name && name.length > 80) || (phone && phone.length > 20)) {
    return { ok: false, error: 'INVALID_CUSTOMER' }
  }
  if (!name && !phone) {
    const rest = { ...cart }
    delete (rest as { customer?: CartCustomer }).customer
    return { ok: true, cart: rest }
  }
  return {
    ok: true,
    cart: {
      ...cart,
      customer: {
        ...(name ? { name } : {}),
        ...(phone ? { phone } : {}),
      },
    },
  }
}

export function removeLine(cart: CartState, lineId: string): CartState {
  const remaining = cart.lines.filter((l) => l.id !== lineId)
  return {
    ...cart,
    lines: renumberLines(remaining),
  }
}

function mapDiscountInput(d: CartDiscount | undefined): DiscountInput | undefined {
  if (!d) return undefined
  if (d.type === 'PERCENT' && d.pct !== undefined) {
    return { kind: 'PERCENT', percent: d.pct }
  }
  if (d.type === 'NOMINAL' && d.input !== undefined) {
    return { kind: 'NOMINAL', amount: d.input }
  }
  return undefined
}

export function toCalcInput(cart: CartState): SaleCalcInput {
  const lines: SaleCalcInput['lines'] = cart.lines.map((l) => ({
    lineNo: l.lineNo,
    skuId: l.skuId,
    uomId: l.uomId,
    qty: l.qty,
    unitPrice: l.unitPrice,
    taxable: l.taxable,
    isOpenPrice: l.isOpenPrice,
    discount: mapDiscountInput(l.discount),
  }))

  return {
    lines,
    billDiscount: mapDiscountInput(cart.billDiscount),
    config: cart.config,
  }
}
