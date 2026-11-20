import '@tanstack/react-start/server-only'
import { and, eq, sql } from 'drizzle-orm'
import type { TenantTx } from '~/server/db'
import { cashCashier, cashMovement } from './schema'

export interface ShiftCommandSummary {
  readonly id: string
  readonly registerId: string
  readonly status: string
}

export interface ShiftFullRow {
  readonly id: string
  readonly tenantId: string
  readonly outletId: string
  readonly registerId: string
  readonly deviceId: string
  readonly status: 'OPEN' | 'CLOSED' | 'FORCE_CLOSED'
  readonly openingCash: number
  readonly countedCash: number | null
  readonly countSubmittedAt: string | null
  readonly closedAt: string | null
}

export async function getShiftForCommand(
  tx: TenantTx,
  shiftId: string,
): Promise<ShiftCommandSummary | null> {
  const rows = await tx
    .select({
      id: cashCashier.id,
      registerId: cashCashier.registerId,
      status: cashCashier.status,
    })
    .from(cashCashier)
    .where(eq(cashCashier.id, shiftId))
    .limit(1)

  return rows[0] ?? null
}

export async function findShiftFullById(
  tx: TenantTx,
  shiftId: string,
): Promise<ShiftFullRow | null> {
  const rows = await tx
    .select({
      id: cashCashier.id,
      tenantId: cashCashier.tenantId,
      outletId: cashCashier.outletId,
      registerId: cashCashier.registerId,
      deviceId: cashCashier.deviceId,
      status: cashCashier.status,
      openingCash: cashCashier.openingCash,
      countedCash: cashCashier.countedCash,
      countSubmittedAt: cashCashier.countSubmittedAt,
      closedAt: cashCashier.closedAt,
    })
    .from(cashCashier)
    .where(eq(cashCashier.id, shiftId))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return {
    ...row,
    status: row.status as 'OPEN' | 'CLOSED' | 'FORCE_CLOSED',
  }
}

export async function findOpenShiftIdByRegister(
  tx: TenantTx,
  tenantId: string,
  registerId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ id: cashCashier.id })
    .from(cashCashier)
    .where(
      and(
        eq(cashCashier.tenantId, tenantId),
        eq(cashCashier.registerId, registerId),
        eq(cashCashier.status, 'OPEN'),
      ),
    )
    .limit(1)
  return rows[0]?.id ?? null
}

export async function insertOpenShiftRow(
  tx: TenantTx,
  params: {
    id: string
    tenantId: string
    outletId: string
    registerId: string
    deviceId: string
    createdBy: string
    createdAtDevice: string
    clockOffsetMs: number
    occurredAt: string
    businessDate: string
    receivedAt: string
    commandId: string
    schemaVersion: number
    appVersion: string | null
    openingCash: number
  },
): Promise<void> {
  await tx.insert(cashCashier).values({
    id: params.id,
    tenantId: params.tenantId,
    outletId: params.outletId,
    registerId: params.registerId,
    deviceId: params.deviceId,
    createdBy: params.createdBy,
    createdAtDevice: params.createdAtDevice,
    clockOffsetMs: params.clockOffsetMs,
    occurredAt: params.occurredAt,
    businessDate: params.businessDate,
    receivedAt: params.receivedAt,
    commandId: params.commandId,
    schemaVersion: params.schemaVersion,
    appVersion: params.appVersion,
    status: 'OPEN',
    openingCash: params.openingCash,
    recapStatus: 'INCOMPLETE',
  })
}

export async function insertCashMovementRow(
  tx: TenantTx,
  params: {
    id: string
    tenantId: string
    outletId: string
    registerId: string
    deviceId: string
    createdBy: string
    createdAtDevice: string
    clockOffsetMs: number
    occurredAt: string
    businessDate: string
    receivedAt: string
    commandId: string
    schemaVersion: number
    appVersion: string | null
    shiftId: string
    direction: 'IN' | 'OUT'
    amount: number
    reasonCode: string
    reasonText: string
  },
): Promise<void> {
  await tx.insert(cashMovement).values({
    id: params.id,
    tenantId: params.tenantId,
    outletId: params.outletId,
    registerId: params.registerId,
    deviceId: params.deviceId,
    createdBy: params.createdBy,
    createdAtDevice: params.createdAtDevice,
    clockOffsetMs: params.clockOffsetMs,
    occurredAt: params.occurredAt,
    businessDate: params.businessDate,
    receivedAt: params.receivedAt,
    commandId: params.commandId,
    schemaVersion: params.schemaVersion,
    appVersion: params.appVersion,
    shiftId: params.shiftId,
    direction: params.direction,
    amount: params.amount,
    reasonCode: params.reasonCode,
    reasonText: params.reasonText,
  })
}

export async function updateCloseShiftRow(
  tx: TenantTx,
  params: {
    shiftId: string
    closedAt: string
    closedAtDevice: string
    closeCommandId: string
    countedCash: number
    countSubmittedAt: string
    expectedCashDevice: number
    varianceDevice: number
    closeNote: string | null
  },
): Promise<void> {
  await tx
    .update(cashCashier)
    .set({
      status: 'CLOSED',
      closedAt: params.closedAt,
      closedAtDevice: params.closedAtDevice,
      closeCommandId: params.closeCommandId,
      countedCash: params.countedCash,
      countSubmittedAt: params.countSubmittedAt,
      expectedCashDevice: params.expectedCashDevice,
      varianceDevice: params.varianceDevice,
      closeNote: params.closeNote,
    })
    .where(eq(cashCashier.id, params.shiftId))
}

export async function updateForceCloseShiftRow(
  tx: TenantTx,
  params: {
    shiftId: string
    closedAt: string
    countedCash: number
    countSubmittedAt: string
    forceClosedBy: string
    forceCloseReasonText: string
  },
): Promise<void> {
  await tx
    .update(cashCashier)
    .set({
      status: 'FORCE_CLOSED',
      closedAt: params.closedAt,
      countedCash: params.countedCash,
      countSubmittedAt: params.countSubmittedAt,
      forceClosedBy: params.forceClosedBy,
      forceCloseReasonText: params.forceCloseReasonText,
    })
    .where(eq(cashCashier.id, params.shiftId))
}

export async function sumShiftCashMovements(
  tx: TenantTx,
  shiftId: string,
): Promise<{ cashIn: number; cashOut: number }> {
  const res = await tx.execute(
    sql`SELECT
          COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE 0 END), 0)::bigint AS cash_in,
          COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount ELSE 0 END), 0)::bigint AS cash_out
        FROM cash_movement
        WHERE shift_id = ${shiftId}::uuid`,
  )
  const row = res.rows[0] as { cash_in?: unknown; cash_out?: unknown } | undefined
  return {
    cashIn: Number(row?.cash_in ?? 0),
    cashOut: Number(row?.cash_out ?? 0),
  }
}

export async function updateShiftRecapColumns(
  tx: TenantTx,
  params: {
    shiftId: string
    expectedCash: number
    variance: number | null
    recapCashSales: number
    recapCashIn: number
    recapCashOut: number
    recapCashRefund: number
    recapStatus: 'COMPLETE' | 'INCOMPLETE'
    recapComputedAt: string
  },
): Promise<void> {
  await tx
    .update(cashCashier)
    .set({
      expectedCash: params.expectedCash,
      variance: params.variance,
      recapCashSales: params.recapCashSales,
      recapCashIn: params.recapCashIn,
      recapCashOut: params.recapCashOut,
      recapCashRefund: params.recapCashRefund,
      recapStatus: params.recapStatus,
      recapComputedAt: params.recapComputedAt,
    })
    .where(eq(cashCashier.id, params.shiftId))
}
