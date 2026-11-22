import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import type { StockSnapshotBlock } from '~/lib/contracts'
import type { TenantTx } from '~/server/db'
import { readAckedDeviceSeq } from './stock-snapshot.repo'

/**
 * Outlet stock balance reader, provided by the inventory module through the composition root (port, BR-ARC-004).
 * Without a registered reader, the `stock` block is never sent.
 */
export interface OutletStockReader {
  read(
    tx: TenantTx,
    tenantId: string,
    outletId: string,
  ): Promise<{ rows: readonly { skuId: string; qty: string }[]; lastMovementAt: string | null; count: number }>
}

let activeReader: OutletStockReader | null = null

export function registerOutletStockReader(reader: OutletStockReader): void {
  activeReader = reader
}

export function __clearOutletStockReaderForTests(): void {
  activeReader = null
}

/**
 * Etag = deterministic hash of (outlet, max(last_movement_at), balance count, acked_device_seq); no new columns.
 * Changes when a movement or a newly ACKed device command occurs (AD-27 / PRD BR-STK-005).
 */
export function stockEtag(parts: { outletId: string; lastMovementAt: string | null; count: number; ackedDeviceSeq: number }): string {
  return createHash('sha256')
    .update(`${parts.outletId}|${parts.lastMovementAt ?? ''}|${parts.count}|${parts.ackedDeviceSeq}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * Builds the stock snapshot block for one device outlet within one DB snapshot (read-only).
 * `null` when no reader is registered yet.
 */
export async function buildStockSnapshot(
  tx: TenantTx,
  input: { tenantId: string; outletId: string; deviceId: string; nowIso: string },
): Promise<{ etag: string; block: StockSnapshotBlock } | null> {
  if (!activeReader) return null
  const stock = await activeReader.read(tx, input.tenantId, input.outletId)
  const ackedDeviceSeq = await readAckedDeviceSeq(tx, input.tenantId, input.deviceId)
  const etag = stockEtag({
    outletId: input.outletId,
    lastMovementAt: stock.lastMovementAt,
    count: stock.count,
    ackedDeviceSeq,
  })
  return {
    etag,
    block: {
      etag,
      as_of_server_time: input.nowIso,
      acked_device_seq: ackedDeviceSeq,
      rows: stock.rows.map((r) => ({ sku_id: r.skuId, qty: r.qty })),
    },
  }
}
