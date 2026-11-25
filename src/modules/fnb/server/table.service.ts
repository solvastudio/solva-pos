import '@tanstack/react-start/server-only'
import { webcrypto } from 'node:crypto'
import { z } from 'zod'
import {
  createFnbTableSchema,
  updateFnbTableSchema,
  type CreateFnbTableInput,
  type UpdateFnbTableInput,
} from '~/lib/contracts'
import { createIdGenerator } from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import type { FnbTableView } from '../shared'
import {
  findTableById,
  insertTableRow,
  listTablesWithBillFlags,
  outletExistsForTenant,
  tableHasAnyBill,
  tableHasOpenBill,
  tombstoneTableRow,
  updateTableRow,
  type FnbTableRow,
} from './table.repo'

const uuidSchema = z.string().uuid()

const fnbIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

export interface FnbActor {
  tenantId: string
  appUserId: string
  permissions: ReadonlySet<string>
  outletIds?: readonly string[] | null
}

export interface FnbServiceDeps {
  nowIso?: () => string
  newId?: () => string
}

function nowIsoFrom(deps?: FnbServiceDeps): string {
  return (deps?.nowIso ?? (() => new Date().toISOString()))()
}

function newIdFrom(deps?: FnbServiceDeps): string {
  return (deps?.newId ?? (() => fnbIdGen.newId()))()
}

function requireManagePermission(actor: FnbActor): void {
  if (!actor.permissions.has('catalog.manage')) {
    throw new AppError('FORBIDDEN', 'Missing required permission: catalog.manage')
  }
}

function assertOutletAccess(actor: FnbActor, outletId: string): void {
  requireManagePermission(actor)
  if (actor.outletIds === null) return
  if (!Array.isArray(actor.outletIds) || !actor.outletIds.includes(outletId)) {
    throw new AppError('FORBIDDEN', 'Outlet is outside your assigned scope')
  }
}

function isPgUniqueViolation(err: unknown): boolean {
  let cur: unknown = err
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i += 1) {
    if ('code' in cur && (cur as { code?: unknown }).code === '23505') return true
    cur = 'cause' in cur ? (cur as { cause?: unknown }).cause : null
  }
  return false
}

export async function listTables(
  actor: FnbActor,
  outletId?: string,
): Promise<FnbTableView[]> {
  requireManagePermission(actor)
  if (outletId !== undefined) {
    if (!uuidSchema.safeParse(outletId).success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid outletId')
    }
    assertOutletAccess(actor, outletId)
  }

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const rows = await listTablesWithBillFlags(tx, actor.tenantId, outletId)
    if (actor.outletIds === null) return rows
    const allowed = new Set(actor.outletIds ?? [])
    return rows.filter((r) => allowed.has(r.outletId))
  })
}

export async function createTable(
  actor: FnbActor,
  rawInput: CreateFnbTableInput,
  deps?: FnbServiceDeps,
): Promise<FnbTableRow> {
  const parsedRes = createFnbTableSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid table input',
    )
  }
  const parsed = parsedRes.data
  assertOutletAccess(actor, parsed.outletId)

  const id = newIdFrom(deps)
  const nowIso = nowIsoFrom(deps)
  const area = parsed.area && parsed.area.trim().length > 0 ? parsed.area.trim() : null

  try {
    return await withTenant(actor.tenantId, async (tx) => {
      const exists = await outletExistsForTenant(tx, actor.tenantId, parsed.outletId)
      if (!exists) {
        throw new AppError('VALIDATION_FAILED', 'Outlet not found')
      }

      const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
        const created = await insertTableRow(tx, w, {
          id,
          outletId: parsed.outletId,
          code: parsed.code,
          area,
          capacity: parsed.capacity ?? null,
          sortOrder: parsed.sortOrder,
          nowIso,
        })
        await appendAudit(
          tx,
          {
            actorUserId: actor.appUserId,
            action: 'fnb_table.changed',
            entityType: 'fnb_table',
            entityId: created.id,
            outletId: created.outletId,
            afterData: {
              code: created.code,
              area: created.area,
              capacity: created.capacity,
              isActive: created.isActive,
            },
            occurredAt: nowIso,
          },
          { newId: () => newIdFrom(deps), nowIso: () => nowIso },
        )
        return created
      })
      return result
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError('VALIDATION_FAILED', 'admin.tables.codeTaken')
    }
    throw err
  }
}

export async function updateTable(
  actor: FnbActor,
  rawInput: UpdateFnbTableInput,
  deps?: FnbServiceDeps,
): Promise<FnbTableRow> {
  const parsedRes = updateFnbTableSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid table update input',
    )
  }
  const parsed = parsedRes.data
  requireManagePermission(actor)

  const nowIso = nowIsoFrom(deps)
  const normalizedArea =
    parsed.area === undefined
      ? undefined
      : parsed.area && parsed.area.trim().length > 0
        ? parsed.area.trim()
        : null

  try {
    return await withTenant(actor.tenantId, async (tx) => {
      const existing = await findTableById(tx, actor.tenantId, parsed.id)
      if (!existing) {
        throw new AppError('VALIDATION_FAILED', 'Table not found')
      }
      assertOutletAccess(actor, existing.outletId)

      if (parsed.isActive === false && existing.isActive) {
        const hasOpen = await tableHasOpenBill(tx, actor.tenantId, existing.id)
        if (hasOpen) {
          throw new AppError('VALIDATION_FAILED', 'admin.tables.hasOpenBill')
        }
      }

      const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
        const updated = await updateTableRow(tx, w, {
          id: existing.id,
          code: parsed.code,
          area: normalizedArea,
          capacity: parsed.capacity,
          sortOrder: parsed.sortOrder,
          isActive: parsed.isActive,
          nowIso,
        })
        if (!updated) {
          throw new AppError('VALIDATION_FAILED', 'Table not found')
        }
        await appendAudit(
          tx,
          {
            actorUserId: actor.appUserId,
            action: 'fnb_table.changed',
            entityType: 'fnb_table',
            entityId: updated.id,
            outletId: updated.outletId,
            beforeData: {
              code: existing.code,
              area: existing.area,
              capacity: existing.capacity,
              isActive: existing.isActive,
            },
            afterData: {
              code: updated.code,
              area: updated.area,
              capacity: updated.capacity,
              isActive: updated.isActive,
            },
            occurredAt: nowIso,
          },
          { newId: () => newIdFrom(deps), nowIso: () => nowIso },
        )
        return updated
      })
      return result
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError('VALIDATION_FAILED', 'admin.tables.codeTaken')
    }
    throw err
  }
}

export async function deactivateOrDeleteTable(
  actor: FnbActor,
  tableId: string,
  deps?: FnbServiceDeps,
): Promise<{ mode: 'deleted' | 'deactivated'; table: FnbTableRow }> {
  if (!uuidSchema.safeParse(tableId).success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid tableId')
  }
  requireManagePermission(actor)
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findTableById(tx, actor.tenantId, tableId)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'Table not found')
    }
    assertOutletAccess(actor, existing.outletId)

    const hasOpen = await tableHasOpenBill(tx, actor.tenantId, existing.id)
    if (hasOpen) {
      throw new AppError('VALIDATION_FAILED', 'admin.tables.hasOpenBill')
    }

    const usedByAnyBill = await tableHasAnyBill(tx, actor.tenantId, existing.id)

    const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      if (usedByAnyBill) {
        const deactivated = await updateTableRow(tx, w, {
          id: existing.id,
          isActive: false,
          nowIso,
        })
        await appendAudit(
          tx,
          {
            actorUserId: actor.appUserId,
            action: 'fnb_table.changed',
            entityType: 'fnb_table',
            entityId: existing.id,
            outletId: existing.outletId,
            beforeData: { isActive: existing.isActive },
            afterData: { isActive: false },
            occurredAt: nowIso,
          },
          { newId: () => newIdFrom(deps), nowIso: () => nowIso },
        )
        return { mode: 'deactivated' as const, table: deactivated! }
      }

      const deleted = await tombstoneTableRow(tx, w, existing.id, nowIso)
      await appendAudit(
        tx,
        {
          actorUserId: actor.appUserId,
          action: 'fnb_table.changed',
          entityType: 'fnb_table',
          entityId: existing.id,
          outletId: existing.outletId,
          beforeData: { code: existing.code, isActive: existing.isActive },
          afterData: { deletedAt: nowIso },
          occurredAt: nowIso,
        },
        { newId: () => newIdFrom(deps), nowIso: () => nowIso },
      )
      return { mode: 'deleted' as const, table: deleted! }
    })
    return result
  })
}
