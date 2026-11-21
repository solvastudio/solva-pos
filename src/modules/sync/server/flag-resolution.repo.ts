import '@tanstack/react-start/server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { TenantTx } from '~/server/db'
import { dataFlag } from './schema'

/**
 * Menyelesaikan flag `STOK_MINUS` untuk SKU yang saldonya kembali ≥ 0 (ARCH §5.2, SCHEMA §4.6.4).
 * Flag tidak dihapus — tetap sebagai jejak; hanya `status` menjadi `RESOLVED`.
 */
export async function resolveStockMinusFlags(
  tx: TenantTx,
  input: { tenantId: string; outletId: string; skuIds: readonly string[] },
): Promise<number> {
  if (input.skuIds.length === 0) return 0
  const rows = await tx
    .update(dataFlag)
    .set({ status: 'RESOLVED' })
    .where(
      and(
        eq(dataFlag.tenantId, input.tenantId),
        eq(dataFlag.outletId, input.outletId),
        eq(dataFlag.flagCode, 'STOK_MINUS'),
        inArray(dataFlag.status, ['OPEN', 'ACKNOWLEDGED']),
        sql`${dataFlag.detail}->>'sku_id' IN (${sql.join(
          input.skuIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    )
    .returning({ id: dataFlag.id })
  return rows.length
}
