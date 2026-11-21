import { cmpQty, parseQty, subQty, type Qty } from '~/lib/kernel'

/**
 * Estimasi stok lokal (BR-STK-005, FR-POS-011). Murni: tanpa I/O, tanpa waktu.
 * estimate = snapshot.qty − Σ qty_base penjualan lokal dengan device_seq > acked_device_seq.
 * Retur lokal tidak menambah estimasi (informasional); estimasi tidak pernah menulis `stock_snapshot`.
 */

export interface LocalStockSale {
  readonly skuId: string
  readonly qtyBase: Qty
  readonly deviceSeq: number
}

/** `null` bila SKU tidak ada di snapshot — tidak ditampilkan (BR-STK-005). */
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

/** Chip peringatan bila estimasi ≤ 0 (tidak memblokir apa pun). */
export function isEstimateLow(estimate: Qty | null): boolean {
  return estimate !== null && cmpQty(estimate, parseQty('0')) <= 0
}
