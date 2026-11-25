import { parseQty, qtyToBase, toMoney, ZERO, type CashRoundingUnit } from '~/lib/kernel'
import { calcEqualSplit, type SaleConfigSnapshot } from '~/lib/sales-calc'
import type { BillRecord } from '../db/types'
import type { LocalBillWithItems } from '../data/bill.repo'
import { toCalcInput, type CartDiscount, type CartLine, type CartState } from './cart'

function mapBillItemDiscount(it: LocalBillWithItems['items'][number]): CartDiscount | undefined {
  if (it.discount_type === 'PERCENT' && it.discount_pct) {
    return {
      type: 'PERCENT',
      pct: it.discount_pct,
      approvedBy: it.discount_approved_by ?? undefined,
    }
  }
  if (it.discount_type === 'NOMINAL' && it.discount_input !== null) {
    return {
      type: 'NOMINAL',
      input: toMoney(it.discount_input),
      approvedBy: it.discount_approved_by ?? undefined,
    }
  }
  return undefined
}

function mapBillDiscount(bill: BillRecord): CartDiscount | undefined {
  if (bill.bill_discount_type === 'PERCENT' && bill.bill_discount_pct) {
    return {
      type: 'PERCENT',
      pct: bill.bill_discount_pct,
      approvedBy: bill.bill_discount_approved_by ?? undefined,
    }
  }
  if (bill.bill_discount_type === 'NOMINAL' && bill.bill_discount_input !== null) {
    return {
      type: 'NOMINAL',
      input: toMoney(bill.bill_discount_input),
      approvedBy: bill.bill_discount_approved_by ?? undefined,
    }
  }
  return undefined
}

function mapActiveBillItemsToCartLines(
  items: LocalBillWithItems['items'],
  lineKind: 'ITEM' | 'STOCK_BASIS',
  startLineNo = 1,
): CartLine[] {
  return items
    .filter((it) => it.status === 'ACTIVE')
    .map((it, idx) => {
      const qty = parseQty(it.qty)
      const factor = parseQty(it.conversion_factor)
      const qtyBase = qtyToBase({ qty, factor, allowFraction: true })
      const discount = lineKind === 'ITEM' ? mapBillItemDiscount(it) : undefined

      return {
        id: lineKind === 'STOCK_BASIS' ? `${it.id}:stock` : it.id,
        lineNo: startLineNo + idx,
        lineKind,
        skuId: it.sku_id,
        productId: it.product_id ?? it.sku_id,
        uomId: it.uom_id,
        skuCode: it.sku_code,
        itemName: it.item_name,
        uomCode: it.uom_code,
        qty,
        conversionFactor: factor,
        qtyBase,
        unitPrice: lineKind === 'STOCK_BASIS' ? ZERO : toMoney(it.unit_price),
        priceSource: it.price_source,
        isOpenPrice: lineKind === 'STOCK_BASIS' ? false : it.is_open_price,
        taxable: it.taxable,
        allowFraction: true,
        ...(discount ? { discount } : {}),
        ...(lineKind === 'ITEM' && it.note ? { note: it.note } : {}),
        sourceBillItemId: it.id,
        modifiers: it.modifiers.map((m) => ({
          modifier_id: m.modifier_id,
          name: m.name,
          price_delta: toMoney(m.price_delta),
          qty: m.qty,
        })),
      }
    })
}

/**
 * Converts an active local F&B open bill + items into a `CartState` for payment
 * without touching retail `cart_draft`. Supports both normal bills (`ITEM`) and
 * `EQUAL` split child bills (`SHARE` + once-per-parent `STOCK_BASIS` on last unsettled sibling).
 */
export function buildCartFromBill(input: {
  billWithItems: LocalBillWithItems
  parentBillWithItems?: LocalBillWithItems | null
  siblingBills?: readonly BillRecord[]
  shiftId: string | null
  finalizeId: string
  config: SaleConfigSnapshot
  cashRoundingUnit: CashRoundingUnit
  taxRateId: string | null
  nowIso: string
}): CartState {
  const { bill, items } = input.billWithItems
  const billDiscount = mapBillDiscount(bill)
  const customer =
    bill.customer_name || bill.customer_phone
      ? {
          ...(bill.customer_name ? { name: bill.customer_name } : {}),
          ...(bill.customer_phone ? { phone: bill.customer_phone } : {}),
        }
      : undefined

  if (
    bill.split_mode === 'EQUAL' &&
    bill.share_index !== null &&
    bill.share_count !== null &&
    input.parentBillWithItems
  ) {
    const parentItems = mapActiveBillItemsToCartLines(input.parentBillWithItems.items, 'ITEM', 1)
    const parentDiscount = mapBillDiscount(input.parentBillWithItems.bill)
    const parentCalcInput = toCalcInput({
      finalizeId: input.finalizeId,
      lines: parentItems,
      ...(parentDiscount ? { billDiscount: parentDiscount } : {}),
      config: input.config,
      cashRoundingUnit: input.cashRoundingUnit,
      taxRateId: input.taxRateId,
      createdAt: input.nowIso,
      shiftId: input.shiftId,
    })
    const splitRes = calcEqualSplit(parentCalcInput, bill.share_count)
    const share = splitRes.shares[bill.share_index - 1]!

    const shareLine: CartLine = {
      id: `${bill.id}:share:${bill.share_index}`,
      lineNo: 1,
      lineKind: 'SHARE',
      skuId: null,
      productId: null,
      uomId: null,
      skuCode: `SHARE-${bill.share_index}/${bill.share_count}`,
      itemName: `Bagian ${bill.share_index}/${bill.share_count} (${input.parentBillWithItems.bill.bill_ref})`,
      uomCode: 'share',
      qty: parseQty('1'),
      conversionFactor: parseQty('1'),
      qtyBase: parseQty('1'),
      unitPrice: toMoney(share.calc.netSubtotal + share.calc.billDiscountTotal),
      priceSource: 'TENANT_DEFAULT',
      isOpenPrice: false,
      taxable: true,
      allowFraction: false,
      modifiers: [],
    }

    const siblings = input.siblingBills ?? []
    const isLastUnsettledSibling =
      siblings.length > 0 && siblings.every((s) => s.id === bill.id || s.status !== 'OPEN')
    const stockBasisLines = isLastUnsettledSibling
      ? mapActiveBillItemsToCartLines(input.parentBillWithItems.items, 'STOCK_BASIS', 2)
      : []

    return {
      finalizeId: input.finalizeId,
      lines: [shareLine, ...stockBasisLines],
      ...(customer ? { customer } : {}),
      config: input.config,
      cashRoundingUnit: input.cashRoundingUnit,
      taxRateId: input.taxRateId,
      createdAt: input.nowIso,
      shiftId: input.shiftId,
      billId: bill.id,
      billRef: bill.bill_ref,
      equalShare: share,
    }
  }

  return {
    finalizeId: input.finalizeId,
    lines: mapActiveBillItemsToCartLines(items, 'ITEM', 1),
    ...(billDiscount ? { billDiscount } : {}),
    ...(customer ? { customer } : {}),
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
