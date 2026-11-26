import '@tanstack/react-start/server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { isUuid } from '~/lib/kernel'
import { runtimeIdGenerator as shiftIdGen } from '~/lib/runtime-id'
import { appendAudit } from '~/modules/audit/public'
import { requireActorPermission, type IdentityAuthActor } from '~/modules/identity/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { recomputeShiftRecap } from './recap.service'
import { cashCashier } from './schema'
import { findShiftFullById, updateForceCloseShiftRow } from './shift.repo'

export interface ForceCloseShiftInput {
  shiftId: string
  countedCash: number
  reasonText: string
}

/**
 * Manager emergency close for an orphaned/open cashier shift (`shift.force_close`, BR-SHF-009).
 */
export async function forceCloseShift(
  actor: IdentityAuthActor,
  input: ForceCloseShiftInput,
  deps?: { nowIso?: () => string },
): Promise<{ shiftId: string; status: 'FORCE_CLOSED' }> {
  requireActorPermission(actor, 'shift.force_close')

  if (!isUuid(input.shiftId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid shiftId')
  }
  if (!Number.isSafeInteger(input.countedCash) || input.countedCash < 0) {
    throw new AppError('VALIDATION_FAILED', 'countedCash must be non-negative integer')
  }
  const reasonText = input.reasonText.trim()
  if (reasonText.length === 0 || reasonText.length > 500) {
    throw new AppError('VALIDATION_FAILED', 'reasonText is required')
  }

  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()

  await withTenant(actor.tenantId, async (tx) => {
    const shift = await findShiftFullById(tx, input.shiftId)
    if (!shift) {
      throw new AppError('VALIDATION_FAILED', 'Shift not found')
    }
    requireActorPermission(actor, 'shift.force_close', { outletId: shift.outletId })

    if (shift.status !== 'OPEN') {
      throw new AppError('VALIDATION_FAILED', 'Only OPEN shifts can be force-closed')
    }

    await updateForceCloseShiftRow(tx, {
      shiftId: shift.id,
      closedAt: nowIso,
      countedCash: input.countedCash,
      countSubmittedAt: nowIso,
      forceClosedBy: actor.appUserId,
      forceCloseReasonText: reasonText,
    })

    await recomputeShiftRecap(tx, shift.id, nowIso)

    await appendAudit(
      tx,
      {
        action: 'shift.force_closed',
        entityType: 'cash_cashier',
        entityId: shift.id,
        outletId: shift.outletId,
        registerId: shift.registerId,
        deviceId: shift.deviceId,
        actorUserId: actor.appUserId,
        reasonText,
        occurredAt: nowIso,
        beforeData: { status: 'OPEN' },
        afterData: { status: 'FORCE_CLOSED', counted_cash: input.countedCash },
      },
      { newId: () => shiftIdGen.newId(), nowIso: () => nowIso },
    )
  })

  return { shiftId: input.shiftId, status: 'FORCE_CLOSED' }
}

export interface OpenShiftAdminRow {
  readonly id: string
  readonly outletId: string
  readonly registerId: string
  readonly openedAt: string
  readonly openingCash: number
}

export async function listOpenShiftsForAdmin(
  actor: IdentityAuthActor,
): Promise<OpenShiftAdminRow[]> {
  requireActorPermission(actor, 'shift.force_close')
  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const conditions = [eq(cashCashier.tenantId, actor.tenantId), eq(cashCashier.status, 'OPEN')]
    if (actor.outletIds !== null && actor.outletIds !== undefined) {
      if (actor.outletIds.length === 0) return []
      conditions.push(inArray(cashCashier.outletId, [...actor.outletIds]))
    }

    const rows = await tx
      .select({
        id: cashCashier.id,
        outletId: cashCashier.outletId,
        registerId: cashCashier.registerId,
        openedAt: cashCashier.occurredAt,
        openingCash: cashCashier.openingCash,
      })
      .from(cashCashier)
      .where(and(...conditions))
      .orderBy(desc(cashCashier.occurredAt))
    return rows
  })
}
