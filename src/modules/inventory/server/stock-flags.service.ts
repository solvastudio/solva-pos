import '@tanstack/react-start/server-only'
import { createDataFlag, resolveStockMinusFlags } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { nonNegativeSkuIds } from './sale-stock.repo'

/**
 * Stock flags: resolving `STOK_MINUS` once the balance is back to ≥ 0, and `SELISIH_TRANSFER`
 * for transfer receipt differences (R-04). Flags stay recorded as a trail and are never deleted.
 */

export async function resolveStockMinus(
  tx: TenantTx,
  input: { tenantId: string; outletId: string; skuIds: readonly string[] },
): Promise<number> {
  // Only SKUs whose balance is back to ≥ 0 have their flags resolved.
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
 * Flags `STOK_MINUS` for every movement that makes the balance negative (ARCH §5.2). Used by paths
 * other than sales (transfer send, GR reversal). Never rejects a transaction.
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
