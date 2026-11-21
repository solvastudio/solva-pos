import type { StockSnapshotBlock } from '~/lib/contracts'
import { parseQty, type Qty } from '~/lib/kernel'
import type { SolvaDb } from '../db/solva-db'
import { estimateStock, type LocalStockSale } from '../domain/stock-estimate'
import { getMeta, setMeta } from './meta.repo'

/**
 * Menerapkan blok `stock` dari pull secara atomik: ganti penuh `stock_snapshot` dan metadata (Fase 53).
 * Tidak pernah dipanggil oleh alur apply master; galat dicatat oleh pemanggil tanpa menggagalkan siklus.
 */
export async function applyStockSnapshot(db: SolvaDb, block: StockSnapshotBlock): Promise<void> {
  await db.transaction('rw', [db.stock_snapshot, db.meta], async (tx) => {
    await tx.table('stock_snapshot').clear()
    await tx.table('stock_snapshot').bulkPut(
      block.rows.map((r) => ({ sku_id: r.sku_id, qty_on_hand: r.qty, updated_at: block.as_of_server_time })),
    )
    await setMeta(tx, 'stock_snapshot_meta', {
      etag: block.etag,
      as_of_server_time: block.as_of_server_time,
      acked_device_seq: block.acked_device_seq,
    })
  })
}

/**
 * Baca estimasi stok per SKU untuk layar jual (satu panggilan per render daftar, bukan per kartu).
 * Hanya membaca `stock_snapshot`, `meta`, dan outbox; tidak menulis apa pun.
 */
export async function getEstimatesBulk(db: SolvaDb, skuIds: readonly string[]): Promise<Map<string, Qty | null>> {
  const out = new Map<string, Qty | null>()
  if (skuIds.length === 0) return out

  const [snapshotRows, meta, outboxRows] = await Promise.all([
    db.stock_snapshot.bulkGet([...skuIds]),
    getMeta(db, 'stock_snapshot_meta'),
    // Outbox kecil (perintah belum ACK); tidak ada indeks pada `type`, jadi disaring di sini.
    db.outbox_command.filter((r) => r.type === 'FinalizeSale').toArray(),
  ])
  const ackedDeviceSeq = meta?.acked_device_seq ?? 0

  const localSales: LocalStockSale[] = []
  for (const row of outboxRows) {
    if (row.device_seq <= ackedDeviceSeq) continue
    const payload = row.payload as { lines?: Array<{ sku_id?: string | null; qty_base?: string }> } | null
    for (const line of payload?.lines ?? []) {
      if (!line.sku_id || typeof line.qty_base !== 'string') continue
      localSales.push({ skuId: line.sku_id, qtyBase: parseQty(line.qty_base), deviceSeq: row.device_seq })
    }
  }

  skuIds.forEach((skuId, i) => {
    const snap = snapshotRows[i]
    out.set(
      skuId,
      estimateStock({
        skuId,
        snapshotQty: snap ? parseQty(snap.qty_on_hand) : null,
        ackedDeviceSeq,
        localSales,
      }),
    )
  })
  return out
}
