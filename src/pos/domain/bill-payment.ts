import { parseQty, qtyToBase, toMoney, ZERO, type CashRoundingUnit } from '~/lib/kernel'
import type { SaleConfigSnapshot } from '~/lib/sales-calc'
import type { LocalBillWithItems } from '../data/bill.repo'
import type { CartDiscount, CartLine, CartState } from './cart'

/**
 * Converts an active local F&B open bill + items into a `CartState` for the Fase 45 payment flow
 * without touching the retail `cart_draft` store.
 */
export function buildCartFromBill(input: {
  billWithItems: LocalBillWithItems
  shiftId: string | null
  finalizeId: string
  config: SaleConfigSnapshot
  cashRoundingUnit: CashRoundingUnit
  taxRateId: string | null
  nowIso: string
}): CartState {
  const { bill, items } = input.billWithItems
  const activeItems = items.filter((it) => it.status === 'ACTIVE')

  const lines: CartLine[] = activeItems.map((it, idx) => {
    const qty = parseQty(it.qty)
    const factor = parseQty(it.conversion_factor)
    const qtyBase = qtyToBase({ qty, factor, allowFraction: true })
    const discount: CartDiscount | undefined =
      it.discount_type === 'PERCENT' && it.discount_pct
        ? {
            type: 'PERCENT',
            pct: it.discount_pct,
            approvedBy: it.discount_approved_by ?? undefined,
          }
        : it.discount_type === 'NOMINAL' && it.discount_input !== null
          ? {
              type: 'NOMINAL',
              input: toMoney(it.discount_input),
              approvedBy: it.discount_approved_by ?? undefined,
            }
          : undefined

    return {
      id: it.id,
      lineNo: idx + 1,
      skuId: it.sku_id,
      productId: it.product_id ?? it.sku_id,
      uomId: it.uom_id,
      skuCode: it.sku_code,
      itemName: it.item_name,
      uomCode: it.uom_code,
      qty,
      conversionFactor: factor,
      qtyBase,
      unitPrice: toMoney(it.unit_price),
      priceSource: it.price_source,
      isOpenPrice: it.is_open_price,
      taxable: it.taxable,
      allowFraction: true,
      ...(discount ? { discount } : {}),
      ...(it.note ? { note: it.note } : {}),
      sourceBillItemId: it.id,
      modifiers: it.modifiers.map((m) => ({
        modifier_id: m.modifier_id,
        name: m.name,
        price_delta: toMoney(m.price_delta),
        qty: m.qty,
      })),
    }
  })

  const billDiscount: CartDiscount | undefined =
    bill.bill_discount_type === 'PERCENT' && bill.bill_discount_pct
      ? {
          type: 'PERCENT',
          pct: bill.bill_discount_pct,
          approvedBy: bill.bill_discount_approved_by ?? undefined,
        }
      : bill.bill_discount_type === 'NOMINAL' && bill.bill_discount_input !== null
        ? {
            type: 'NOMINAL',
            input: toMoney(bill.bill_discount_input),
            approvedBy: bill.bill_discount_approved_by ?? undefined,
          }
        : undefined

  return {
    finalizeId: input.finalizeId,
    lines,
    ...(billDiscount ? { billDiscount } : {}),
    ...(bill.customer_name || bill.customer_phone
      ? {
          customer: {
            ...(bill.customer_name ? { name: bill.customer_name } : {}),
            ...(bill.customer_phone ? { phone: bill.customer_phone } : {}),
          },
        }
      : {}),
    config: input.config,
    cashRoundingUnit: input.cashRoundingUnit,
    taxRateId: input.taxRateId,
    createdAt: input.nowIso,
    shiftId: input.shiftId,
    billId: bill.id,
    billRef: bill.bill_ref,
  }
}

export function extractZeroMoney() {
  return ZERO
}
