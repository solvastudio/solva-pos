import { addMoney, toMoney, ZERO, type Money } from '~/lib/kernel'
import {
  AcceptBillPayloadV1,
  AppendBillEventsPayloadV1,
  BILL_EVENT_PAYLOAD_SCHEMAS,
  BillCanceledPayloadSchema,
  BillEventEnvelopeV1Schema,
  BillItemDiscountInputSchema,
  BillItemModifierInputSchema,
  BillMergedPayloadSchema,
  BillOpenedPayloadSchema,
  BillSplitChildItemSpecSchema,
  BillSplitChildSpecSchema,
  BillSplitPayloadSchema,
  CancelBillHandoverPayloadV1,
  CustomerSetPayloadSchema,
  DiscountSetPayloadSchema,
  HandOverBillPayloadV1,
  ItemAddedPayloadSchema,
  ItemQtyChangedPayloadSchema,
  ItemVoidedPayloadSchema,
  ModifierSetPayloadSchema,
  PrebillPrintedPayloadSchema,
  TableSetPayloadSchema,
  type AcceptBillPayloadV1 as AcceptBillPayloadV1Type,
  type AppendBillEventsPayloadV1 as AppendBillEventsPayloadV1Type,
  type BillEventEnvelopeV1,
  type BillItemModifierInput,
  type BillMergedPayload,
  type BillSplitChildItemSpec,
  type BillSplitChildSpec,
  type BillSplitPayload,
  type CancelBillHandoverPayloadV1 as CancelBillHandoverPayloadV1Type,
  type CustomerSetPayload,
  type DiscountSetPayload,
  type HandOverBillPayloadV1 as HandOverBillPayloadV1Type,
  type ItemAddedPayload,
  type ItemQtyChangedPayload,
  type ItemVoidedPayload,
  type ModifierSetPayload,
  type TableSetPayload,
} from '~/lib/contracts'

export {
  AcceptBillPayloadV1,
  AppendBillEventsPayloadV1,
  BILL_EVENT_PAYLOAD_SCHEMAS,
  BillCanceledPayloadSchema,
  BillEventEnvelopeV1Schema,
  BillItemDiscountInputSchema,
  BillItemModifierInputSchema,
  BillMergedPayloadSchema,
  BillOpenedPayloadSchema,
  BillSplitChildItemSpecSchema,
  BillSplitChildSpecSchema,
  BillSplitPayloadSchema,
  CancelBillHandoverPayloadV1,
  CustomerSetPayloadSchema,
  DiscountSetPayloadSchema,
  HandOverBillPayloadV1,
  ItemAddedPayloadSchema,
  ItemQtyChangedPayloadSchema,
  ItemVoidedPayloadSchema,
  ModifierSetPayloadSchema,
  PrebillPrintedPayloadSchema,
  TableSetPayloadSchema,
}

export type {
  AcceptBillPayloadV1Type as AcceptBillPayload,
  AppendBillEventsPayloadV1Type as AppendBillEventsPayload,
  BillEventEnvelopeV1,
  BillItemModifierInput,
  BillMergedPayload,
  BillSplitChildItemSpec,
  BillSplitChildSpec,
  BillSplitPayload,
  CancelBillHandoverPayloadV1Type as CancelBillHandoverPayload,
  CustomerSetPayload,
  DiscountSetPayload,
  HandOverBillPayloadV1Type as HandOverBillPayload,
  ItemAddedPayload,
  ItemQtyChangedPayload,
  ItemVoidedPayload,
  ModifierSetPayload,
  TableSetPayload,
}

/**
 * Computes `sum(price_delta * qty)` for selected modifiers using safe integer money arithmetic (BR-PRC-006).
 */
export function computeModifierDeltaSum(modifiers: readonly BillItemModifierInput[]): Money {
  let sum: Money = ZERO
  for (const mod of modifiers) {
    const qty = mod.qty ?? 1
    const lineDelta = mod.price_delta * qty
    if (!Number.isSafeInteger(lineDelta)) {
      throw new RangeError('Modifier price delta overflow')
    }
    sum = addMoney(sum, toMoney(lineDelta))
  }
  return sum
}

/**
 * Verifies that `unit_price === max(0, base_unit_price + sum(price_delta * qty))` (BR-PRC-006).
 * Returns `{ ok, expectedUnitPrice, diffAmount }`.
 */
export function verifyBillItemUnitPrice(
  baseUnitPrice: Money,
  modifiers: readonly BillItemModifierInput[],
  actualUnitPrice: Money,
): { readonly ok: boolean; readonly expectedUnitPrice: Money; readonly diffAmount: Money } {
  const deltaSum = computeModifierDeltaSum(modifiers)
  const rawExpected = baseUnitPrice + deltaSum
  if (!Number.isSafeInteger(rawExpected)) {
    throw new RangeError('Bill item unit price overflow')
  }
  const expectedUnitPrice = toMoney(Math.max(0, rawExpected))
  const diffAmount = toMoney(Math.abs(actualUnitPrice - expectedUnitPrice))
  return {
    ok: actualUnitPrice === expectedUnitPrice,
    expectedUnitPrice,
    diffAmount,
  }
}
