import '@tanstack/react-start/server-only'
import { eq, or, sql } from 'drizzle-orm'
import type { TenantTx } from '~/server/db'
import { saleLine } from './schema'

/**
 * Checks whether any `sale_line` references the given `product_id` or `sku_id` within the active tenant transaction.
 */
export async function hasSalesForProductOrSku(
  productIdOrSkuId: string,
  tx?: TenantTx,
): Promise<boolean> {
  if (!tx) {
    return false
  }

  const rows = await tx
    .select({ present: sql<number>`1` })
    .from(saleLine)
    .where(or(eq(saleLine.productId, productIdOrSkuId), eq(saleLine.skuId, productIdOrSkuId)))
    .limit(1)

  return rows.length > 0
}
