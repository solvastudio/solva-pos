import type { Transaction } from 'dexie'
import { SolvaDb } from '../db/solva-db'
import type { MasterStoreName } from '../db/schema-v1'
import type {
  AppUserRecord,
  CashMasterRecord,
  OutletRecord,
  RolePermissionRecord,
  StaffPinRecord,
} from '../db/types'

export interface PullMasterRow {
  entity: MasterStoreName
  op: 'upsert' | 'delete'
  id: string
  payload?: Record<string, unknown>
}

export function buildProductSearchTokens(name: string, code?: string | null): string[] {
  const combined = `${name} ${code ?? ''}`
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const rawTokens = combined.split(/[^a-z0-9]+/).filter(Boolean)
  return Array.from(new Set(rawTokens))
}

function enrichMasterPayload(
  entity: MasterStoreName,
  id: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const record: Record<string, unknown> = { ...payload, id }
  if (entity === 'product') {
    const name = typeof record.name === 'string' ? record.name : ''
    const code = typeof record.code === 'string' ? record.code : null
    record.search_tokens = buildProductSearchTokens(name, code)
  }
  if (entity === 'sku_uom' && (record.barcode === null || record.barcode === '')) {
    // IndexedDB cannot uniquely index null/empty strings without colliding across rows.
    delete record.barcode
  }
  return record
}

/**
 * Applies pulled master entity changes inside an active transaction.
 * Guarded by `tests/arch/pos-data-guard.test.ts`: may ONLY be imported by
 * `src/pos/sync/applier.ts` (and tests).
 */
export async function applyMasterRows(
  tx: Transaction,
  rows: readonly PullMasterRow[],
): Promise<void> {
  const upserts = new Map<MasterStoreName, Record<string, unknown>[]>()
  const deletes = new Map<MasterStoreName, string[]>()

  for (const row of rows) {
    if (row.op === 'delete') {
      const list = deletes.get(row.entity) ?? []
      list.push(row.id)
      deletes.set(row.entity, list)
    } else if (row.payload) {
      const list = upserts.get(row.entity) ?? []
      list.push(enrichMasterPayload(row.entity, row.id, row.payload))
      upserts.set(row.entity, list)
    }
  }

  for (const [entity, items] of upserts.entries()) {
    await tx.table(entity).bulkPut(items)
  }

  for (const [entity, ids] of deletes.entries()) {
    await tx.table(entity).bulkDelete(ids)
  }
}

export async function getOutlet(db: SolvaDb, outletId: string): Promise<OutletRecord | null> {
  const row = await db.outlet.get(outletId)
  return row && !row.deleted_at ? row : null
}

export async function listOutlets(db: SolvaDb): Promise<OutletRecord[]> {
  const rows = await db.outlet.toArray()
  return rows.filter((r) => !r.deleted_at)
}

export async function listRegisters(db: SolvaDb, outletId?: string): Promise<CashMasterRecord[]> {
  const rows = outletId
    ? await db.cash_master.where('outlet_id').equals(outletId).toArray()
    : await db.cash_master.toArray()
  return rows.filter((r) => !r.deleted_at)
}

export async function listActiveStaff(db: SolvaDb): Promise<AppUserRecord[]> {
  const rows = await db.app_user.toArray()
  return rows.filter((r) => r.is_active && !r.deleted_at)
}

export async function getStaffPinForUser(
  db: SolvaDb,
  userId: string,
): Promise<StaffPinRecord | null> {
  const row = await db.staff_pin.where('user_id').equals(userId).first()
  return row && row.is_active && !row.deleted_at ? row : null
}

export async function getRolePermissions(
  db: SolvaDb,
  roleId: string,
): Promise<RolePermissionRecord[]> {
  return db.role_permission.where('role_id').equals(roleId).toArray()
}
