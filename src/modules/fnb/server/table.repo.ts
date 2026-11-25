import '@tanstack/react-start/server-only'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import type { FnbTableView } from '../shared'
import { bill, fnbTable } from './schema'

export interface FnbTableRow {
  id: string
  tenantId: string
  version: number
  outletId: string
  code: string
  area: string | null
  capacity: number | null
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  createdBy: string | null
  updatedBy: string | null
  deletedAt: string | null
}

function mapTableRow(r: typeof fnbTable.$inferSelect): FnbTableRow {
  return {
    id: r.id,
    tenantId: r.tenantId,
    version: r.version,
    outletId: r.outletId,
    code: r.code,
    area: r.area,
    capacity: r.capacity,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    deletedAt: r.deletedAt,
  }
}

export async function outletExistsForTenant(
  tx: TenantTx,
  tenantId: string,
  outletId: string,
): Promise<boolean> {
  const res = await tx.execute(
    sql`SELECT 1 FROM outlet WHERE tenant_id = ${tenantId} AND id = ${outletId} LIMIT 1`,
  )
  return res.rows.length > 0
}

export async function listTablesWithBillFlags(
  tx: TenantTx,
  tenantId: string,
  outletId?: string,
): Promise<FnbTableView[]> {
  const conds = [eq(fnbTable.tenantId, tenantId), isNull(fnbTable.deletedAt)]
  if (outletId) {
    conds.push(eq(fnbTable.outletId, outletId))
  }

  const rows = await tx
    .select()
    .from(fnbTable)
    .where(and(...conds))
    .orderBy(asc(fnbTable.sortOrder), asc(fnbTable.code))

  if (rows.length === 0) return []

  const billAgg = await tx
    .select({
      tableId: bill.tableId,
      anyCount: sql<string>`count(*)::text`,
      openCount: sql<string>`count(*) FILTER (WHERE ${bill.status} = 'OPEN')::text`,
    })
    .from(bill)
    .where(
      outletId
        ? and(eq(bill.tenantId, tenantId), eq(bill.outletId, outletId))
        : eq(bill.tenantId, tenantId),
    )
    .groupBy(bill.tableId)

  const flagsByTable = new Map<string, { anyBill: boolean; openBill: boolean }>()
  for (const row of billAgg) {
    flagsByTable.set(row.tableId, {
      anyBill: Number(row.anyCount) > 0,
      openBill: Number(row.openCount) > 0,
    })
  }

  return rows.map((r) => {
    const flags = flagsByTable.get(r.id)
    return {
      id: r.id,
      outletId: r.outletId,
      code: r.code,
      area: r.area,
      capacity: r.capacity,
      sortOrder: r.sortOrder,
      isActive: r.isActive,
      hasAnyBill: flags?.anyBill ?? false,
      hasOpenBill: flags?.openBill ?? false,
    }
  })
}

export async function findTableById(
  tx: TenantTx,
  tenantId: string,
  tableId: string,
): Promise<FnbTableRow | null> {
  const rows = await tx
    .select()
    .from(fnbTable)
    .where(and(eq(fnbTable.tenantId, tenantId), eq(fnbTable.id, tableId), isNull(fnbTable.deletedAt)))
    .limit(1)
  return rows[0] ? mapTableRow(rows[0]) : null
}

export async function tableHasOpenBill(
  tx: TenantTx,
  tenantId: string,
  tableId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: bill.id })
    .from(bill)
    .where(and(eq(bill.tenantId, tenantId), eq(bill.tableId, tableId), eq(bill.status, 'OPEN')))
    .limit(1)
  return rows.length > 0
}

export async function tableHasAnyBill(
  tx: TenantTx,
  tenantId: string,
  tableId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: bill.id })
    .from(bill)
    .where(and(eq(bill.tenantId, tenantId), eq(bill.tableId, tableId)))
    .limit(1)
  return rows.length > 0
}

export async function insertTableRow(
  tx: TenantTx,
  w: MasterWriter,
  input: {
    id: string
    outletId: string
    code: string
    area: string | null
    capacity: number | null
    sortOrder: number
    nowIso: string
  },
): Promise<FnbTableRow> {
  const [inserted] = await tx
    .insert(fnbTable)
    .values({
      id: input.id,
      tenantId: w.tenantId,
      version: w.version,
      outletId: input.outletId,
      code: input.code,
      area: input.area,
      capacity: input.capacity,
      sortOrder: input.sortOrder,
      isActive: true,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
      createdBy: w.actorUserId,
      updatedBy: w.actorUserId,
    })
    .returning()
  return mapTableRow(inserted!)
}

export async function updateTableRow(
  tx: TenantTx,
  w: MasterWriter,
  input: {
    id: string
    code?: string
    area?: string | null
    capacity?: number | null
    sortOrder?: number
    isActive?: boolean
    nowIso: string
  },
): Promise<FnbTableRow | null> {
  const patch: Partial<typeof fnbTable.$inferInsert> = {
    version: w.version,
    updatedAt: input.nowIso,
    updatedBy: w.actorUserId,
  }
  if (input.code !== undefined) patch.code = input.code
  if (input.area !== undefined) patch.area = input.area
  if (input.capacity !== undefined) patch.capacity = input.capacity
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder
  if (input.isActive !== undefined) patch.isActive = input.isActive

  const [updated] = await tx
    .update(fnbTable)
    .set(patch)
    .where(and(eq(fnbTable.tenantId, w.tenantId), eq(fnbTable.id, input.id), isNull(fnbTable.deletedAt)))
    .returning()
  return updated ? mapTableRow(updated) : null
}

export async function tombstoneTableRow(
  tx: TenantTx,
  w: MasterWriter,
  id: string,
  nowIso: string,
): Promise<FnbTableRow | null> {
  const [deleted] = await tx
    .update(fnbTable)
    .set({
      version: w.version,
      deletedAt: nowIso,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(and(eq(fnbTable.tenantId, w.tenantId), eq(fnbTable.id, id), isNull(fnbTable.deletedAt)))
    .returning()
  return deleted ? mapTableRow(deleted) : null
}
