import '@tanstack/react-start/server-only'
import { createDataFlag, resolveStockMinusFlags } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { nonNegativeSkuIds } from './sale-stock.repo'

/**
 * Flag stok (Fase 54): penyelesaian `STOK_MINUS` setelah saldo kembali ≥ 0, dan `SELISIH_TRANSFER`
 * untuk selisih penerimaan transfer (R-04). Flag tetap tercatat sebagai jejak (tidak dihapus).
 */

export async function resolveStockMinus(
  tx: TenantTx,
  input: { tenantId: string; outletId: string; skuIds: readonly string[] },
): Promise<number> {
  // Hanya SKU yang saldonya kembali ≥ 0 yang flag-nya diselesaikan.
  const skuIds = await nonNegativeSkuIds(tx, input.tenantId, input.outletId, input.skuIds)
  return resolveStockMinusFlags(tx, { ...input, skuIds })
}

export async function createTransferVarianceFlag(
  tx: TenantTx,
  input: {
    tenantId: string
    outletId: string
    businessDate: string
    transferLineId: string
    valueVariance: number
    qtyVariance: string
  },
): Promise<void> {
  await createDataFlag(tx, {
    tenantId: input.tenantId,
    outletId: input.outletId,
    businessDate: input.businessDate,
    flagCode: 'SELISIH_TRANSFER',
    entityType: 'TRANSFER_LINE',
    entityId: input.transferLineId,
    diffAmount: input.valueVariance,
    detail: { qty_variance: input.qtyVariance },
    commandId: null,
  })
}

/**
 * Menandai `STOK_MINUS` untuk setiap movement yang membuat saldo negatif (ARCH §5.2). Dipakai jalur
 * selain penjualan (kirim transfer, reversal GR). Tidak pernah menolak transaksi.
 */
export async function createStockMinusFlags(
  tx: TenantTx,
  input: {
    tenantId: string
    outletId: string
    businessDate: string
    applied: readonly { movementId: string; skuId: string; isNegativeResult: boolean }[]
  },
): Promise<void> {
  for (const a of input.applied) {
    if (!a.isNegativeResult) continue
    await createDataFlag(tx, {
      tenantId: input.tenantId,
      outletId: input.outletId,
      businessDate: input.businessDate,
      flagCode: 'STOK_MINUS',
      entityType: 'STOCK_MOVEMENT',
      entityId: a.movementId,
      commandId: null,
      detail: { sku_id: a.skuId },
    })
  }
}
