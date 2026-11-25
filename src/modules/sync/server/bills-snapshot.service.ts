import '@tanstack/react-start/server-only'
import type { BillsSnapshotBlock } from '~/lib/contracts'
import type { TenantTx } from '~/server/db'

/**
 * Outlet open-bills snapshot reader provided by `fnb` via the composition root (ARCH §4.3.3 / BR-ARC-004).
 */
export interface OutletBillsReader {
  read(
    tx: TenantTx,
    input: {
      tenantId: string
      outletId: string
      deviceId: string
      registerId: string
      nowIso: string
    },
  ): Promise<{ etag: string; block: BillsSnapshotBlock }>
}

let activeBillsReader: OutletBillsReader | null = null

export function registerOutletBillsReader(reader: OutletBillsReader): void {
  activeBillsReader = reader
}

export function __clearOutletBillsReaderForTests(): void {
  activeBillsReader = null
}

export async function buildBillsSnapshot(
  tx: TenantTx,
  input: {
    tenantId: string
    outletId: string
    deviceId: string
    registerId: string
    nowIso: string
  },
): Promise<{ etag: string; block: BillsSnapshotBlock } | null> {
  if (!activeBillsReader) return null
  return activeBillsReader.read(tx, input)
}
