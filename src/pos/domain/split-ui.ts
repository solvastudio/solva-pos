import { addQty, cmpQty, parseQty, roundToUnit, toMoney, type CashRoundingUnit, type Money } from '~/lib/kernel'
import {
  calcEqualSplit,
  calcGroupSplit,
  type CartLineInput,
  type DiscountInput,
  type SaleConfigSnapshot,
} from '~/lib/sales-calc'
import type { BillItemRecord, BillRecord } from '../db/types'

export function canSplitBill(
  bill: Pick<BillRecord, 'status' | 'lease_device_id' | 'handover_status' | 'split_mode'>,
  activeItems: readonly Pick<BillItemRecord, 'qty' | 'status'>[],
  deviceId: string,
): boolean {
  if (bill.status !== 'OPEN') return false
  if (bill.lease_device_id !== deviceId) return false
  if (bill.handover_status === 'PENDING') return false
  if (bill.split_mode === 'EQUAL') return false
  const active = activeItems.filter((it) => it.status === 'ACTIVE')
  return active.length > 0
}

function toCartLineInputs(
  items: readonly Pick<
    BillItemRecord,
    'id' | 'sku_id' | 'uom_id' | 'qty' | 'unit_price' | 'taxable' | 'discount_type' | 'discount_pct' | 'discount_input'
  >[],
): CartLineInput[] {
  return items.map((it, idx) => ({
    lineNo: idx + 1,
    skuId: it.sku_id,
    uomId: it.uom_id,
    qty: it.qty as CartLineInput['qty'],
    unitPrice: toMoney(it.unit_price),
    taxable: it.taxable,
    discount:
      it.discount_type === 'PERCENT' && it.discount_pct
        ? { kind: 'PERCENT' as const, percent: it.discount_pct }
        : it.discount_type === 'NOMINAL' && it.discount_input !== null
          ? { kind: 'NOMINAL' as const, amount: toMoney(it.discount_input) }
          : undefined,
  }))
}

function mapBillDiscount(bill: Pick<BillRecord, 'bill_discount_type' | 'bill_discount_pct' | 'bill_discount_input'>): DiscountInput | undefined {
  if (bill.bill_discount_type === 'PERCENT' && bill.bill_discount_pct) {
    return { kind: 'PERCENT', percent: bill.bill_discount_pct }
  }
  if (bill.bill_discount_type === 'NOMINAL' && bill.bill_discount_input !== null) {
    return { kind: 'NOMINAL', amount: toMoney(bill.bill_discount_input) }
  }
  return undefined
}

export interface SplitChildPreview {
  readonly label: string
  readonly grandTotal: Money
  readonly cashTotal: Money
  readonly itemCount: number
}

export function previewEqualSplit(input: {
  bill: BillRecord
  activeItems: readonly BillItemRecord[]
  shareCount: number
  config: SaleConfigSnapshot
  cashRoundingUnit: CashRoundingUnit
}): readonly SplitChildPreview[] {
  if (input.activeItems.length === 0 || input.shareCount < 2) return []
  const res = calcEqualSplit(
    {
      lines: toCartLineInputs(input.activeItems),
      billDiscount: mapBillDiscount(input.bill),
      config: input.config,
    },
    input.shareCount,
  )
  return res.shares.map((s) => ({
    label: `${input.bill.bill_ref}-${s.shareIndex}`,
    grandTotal: s.calc.grandTotal,
    cashTotal: roundToUnit(s.calc.grandTotal, input.cashRoundingUnit),
    itemCount: input.activeItems.length,
  }))
}

export function validateItemPartition(
  activeItems: readonly BillItemRecord[],
  groupAssignments: ReadonlyMap<string, number>,
  groupCount: number,
): boolean {
  if (groupCount < 2 || activeItems.length < 2) return false
  const nonEmptyGroups = new Set<number>()
  for (const item of activeItems) {
    const g = groupAssignments.get(item.id)
    if (g === undefined || g < 0 || g >= groupCount) return false
    nonEmptyGroups.add(g)
  }
  return nonEmptyGroups.size === groupCount
}

export function validateQtyPartition(
  activeItems: readonly BillItemRecord[],
  /** Map<itemId, string[] of length groupCount> */
  qtyMatrix: ReadonlyMap<string, readonly string[]>,
  groupCount: number,
): boolean {
  if (groupCount < 2 || activeItems.length === 0) return false
  const groupNonEmpty = new Array<boolean>(groupCount).fill(false)
  for (const item of activeItems) {
    const row = qtyMatrix.get(item.id)
    if (!row || row.length !== groupCount) return false
    let sum: ReturnType<typeof parseQty> | null = null
    for (let g = 0; g < groupCount; g += 1) {
      const raw = row[g]?.trim() ?? '0'
      if (raw === '' || raw === '0') continue
      let parsed: ReturnType<typeof parseQty>
      try {
        parsed = parseQty(raw.replace(',', '.'))
      } catch {
        return false
      }
      if (cmpQty(parsed, parseQty('0')) <= 0) continue
      groupNonEmpty[g] = true
      sum = sum !== null ? parseQty(addQty(sum, parsed)) : parsed
    }
    if (sum === null || cmpQty(sum, parseQty(item.qty)) !== 0) {
      return false
    }
  }
  return groupNonEmpty.every(Boolean)
}

export function previewGroupSplit(input: {
  bill: BillRecord
  groups: readonly (readonly BillItemRecord[])[]
  config: SaleConfigSnapshot
  cashRoundingUnit: CashRoundingUnit
}): readonly SplitChildPreview[] {
  if (input.groups.length < 2 || input.groups.some((g) => g.length === 0)) return []
  const allItems = input.groups.flat()
  const res = calcGroupSplit(
    {
      lines: toCartLineInputs(allItems),
      billDiscount: mapBillDiscount(input.bill),
      config: input.config,
    },
    input.groups.map((g) => toCartLineInputs(g)),
  )
  return res.children.map((calc, i) => ({
    label: `${input.bill.bill_ref}-${i + 1}`,
    grandTotal: calc.grandTotal,
    cashTotal: roundToUnit(calc.grandTotal, input.cashRoundingUnit),
    itemCount: input.groups[i]!.length,
  }))
}
