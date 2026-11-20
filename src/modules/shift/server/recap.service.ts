import '@tanstack/react-start/server-only'
import { toMoney } from '~/lib/kernel'
import { cashVariance, expectedCash } from '~/lib/sales-calc'
import { getRegisterPendingCommandCount } from '~/modules/identity/public'
import type { TenantTx } from '~/server/db'
import { getShiftRecapSalesPort } from './ports'
import {
  findShiftFullById,
  sumShiftCashMovements,
  updateShiftRecapColumns,
} from './shift.repo'

/**
 * Recomputes authoritative server-side shift cash expectations, variance, and completeness
 * using `sales-calc` kernels so server and client always agree (BR-SHF-005/008, V-21).
 */
export async function recomputeShiftRecap(
  tx: TenantTx,
  shiftId: string,
  nowIso?: string,
): Promise<void> {
  const shift = await findShiftFullById(tx, shiftId)
  if (!shift) return

  const { cashIn, cashOut } = await sumShiftCashMovements(tx, shiftId)
  const { cashSales, cashRefund } = await getShiftRecapSalesPort().getShiftCashTotals(tx, shiftId)

  const exp = expectedCash({
    openingFloat: toMoney(shift.openingCash),
    cashSalesApplied: [toMoney(cashSales)],
    cashIn: [toMoney(cashIn)],
    cashOut: [toMoney(cashOut)],
    cashRefunds: [toMoney(cashRefund)],
  })

  const variance =
    shift.countedCash !== null ? cashVariance(toMoney(shift.countedCash), exp) : null

  const pendingCount = await getRegisterPendingCommandCount(tx, shift.tenantId, shift.registerId)
  const isClosed = shift.status === 'CLOSED' || shift.status === 'FORCE_CLOSED'
  const recapStatus: 'COMPLETE' | 'INCOMPLETE' =
    isClosed && pendingCount === 0 ? 'COMPLETE' : 'INCOMPLETE'

  await updateShiftRecapColumns(tx, {
    shiftId,
    expectedCash: exp,
    variance,
    recapCashSales: cashSales,
    recapCashIn: cashIn,
    recapCashOut: cashOut,
    recapCashRefund: cashRefund,
    recapStatus,
    recapComputedAt: nowIso ?? new Date().toISOString(),
  })
}

/**
 * Recomputes a closed or force-closed shift recap when late offline transactions arrive (EC-007).
 */
export async function recomputeRecapIfClosed(
  tx: TenantTx,
  shiftId: string,
  nowIso?: string,
): Promise<void> {
  const shift = await findShiftFullById(tx, shiftId)
  if (!shift) return
  if (shift.status === 'CLOSED' || shift.status === 'FORCE_CLOSED') {
    await recomputeShiftRecap(tx, shiftId, nowIso)
  }
}
