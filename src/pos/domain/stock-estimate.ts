import { cmpQty, parseQty, subQty, type Qty } from '~/lib/kernel'

/**
 * Local stock estimate (BR-STK-005, FR-POS-011). Pure: no I/O, no clock.
 * estimate = snapshot.qty − Σ qty_base of local sales with device_seq > acked_device_seq.
 * Local returns do not increase the estimate (informational only); the estimate never writes `stock_snapshot`.
 */

export interface LocalStockSale {
  readonly skuId: string
  readonly qtyBase: Qty
  readonly deviceSeq: number
}

/** `null` when the SKU is not in the snapshot; not displayed (BR-STK-005). */
export function estimateStock(input: {
  readonly skuId: string
  readonly snapshotQty: Qty | null
  readonly ackedDeviceSeq: number
  readonly localSales: readonly LocalStockSale[]
}): Qty | null {
  if (input.snapshotQty === null) return null
  let estimate = input.snapshotQty
  for (const sale of input.localSales) {
    if (sale.skuId === input.skuId && sale.deviceSeq > input.ackedDeviceSeq) {
      estimate = subQty(estimate, sale.qtyBase)
    }
  }
  return estimate
}

/** Warning chip when the estimate is ≤ 0 (blocks nothing). */
export function isEstimateLow(estimate: Qty | null): boolean {
  return estimate !== null && cmpQty(estimate, parseQty('0')) <= 0
}
