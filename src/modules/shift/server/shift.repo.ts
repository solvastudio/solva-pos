import '@tanstack/react-start/server-only'
import { eq } from 'drizzle-orm'
import type { TenantTx } from '~/server/db'
import { cashCashier } from './schema'

export interface ShiftCommandSummary {
  readonly id: string
  readonly registerId: string
  readonly status: string
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
