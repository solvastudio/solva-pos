import '@tanstack/react-start/server-only'
import { createDataFlag } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { countOpenBillsOnTable } from './bill.repo'

/**
 * Flags a bill with `BILL_GANDA_MEJA` when 2 or more OPEN bills exist on the same table (EC-015, BR-FNB-007).
 * Never rejects; both bills remain valid and managers resolve duplicates operationally.
 */
export async function flagDoubleTableBillsIfNeeded(
  tx: TenantTx,
  params: {
    tenantId: string
    outletId: string
    billId: string
    tableId: string
    businessDate: string
    commandId: string
  },
): Promise<boolean> {
  const openCount = await countOpenBillsOnTable(
    tx,
    params.tenantId,
    params.outletId,
    params.tableId,
  )
  if (openCount < 2) {
    return false
  }
  return createDataFlag(tx, {
    tenantId: params.tenantId,
    outletId: params.outletId,
    businessDate: params.businessDate,
    flagCode: 'BILL_GANDA_MEJA',
    severity: 'WARN',
    entityType: 'BILL',
    entityId: params.billId,
    commandId: params.commandId,
    detail: {
      table_id: params.tableId,
      open_count: openCount,
    },
  })
}
