import type { Transaction } from 'dexie'
import { buildSearchTokens } from '~/modules/catalog/shared'
import { SolvaDb } from '../db/solva-db'
import { MASTER_STORE_NAMES, type MasterStoreName } from '../db/schema-v1'
import type {
  AppUserRecord,
  CashMasterRecord,
  OutletRecord,
  RolePermissionRecord,
  StaffPinRecord,
} from '../db/types'
import { deriveLocalFields } from './derive-local-fields'
import { setMeta } from './meta.repo'

const MASTER_SET = new Set<string>(MASTER_STORE_NAMES)

export interface PullMasterRow {
  entity: string
  op: 'upsert' | 'delete'
  id: string
  payload?: Record<string, unknown>
}

export function buildProductSearchTokens(name: string, code?: string | null): string[] {
  return buildSearchTokens(name, code ?? '')
}

function enrichMasterPayload(
  entity: MasterStoreName,
  id: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return deriveLocalFields(entity, { ...payload, id })
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
    if (row.entity === 'tenant' && row.op === 'upsert' && row.payload) {
      const name = typeof row.payload.name === 'string' ? row.payload.name : ''
      const locale =
        row.payload.default_locale === 'en-US' || row.payload.default_locale === 'id-ID'
          ? row.payload.default_locale
          : 'id-ID'
      if (name) {
        await setMeta(tx, 'tenant', {
          id: row.id,
          name,
          default_locale: locale,
        })
      }
      continue
    }

    if (!MASTER_SET.has(row.entity)) {
      continue
    }
    const entity = row.entity as MasterStoreName

    if (row.op === 'delete') {
      const list = deletes.get(entity) ?? []
      list.push(row.id)
      deletes.set(entity, list)
    } else if (row.payload) {
      const list = upserts.get(entity) ?? []
      list.push(enrichMasterPayload(entity, row.id, row.payload))
      upserts.set(entity, list)
    }
  }

  for (const [entity, items] of upserts.entries()) {
    await tx.table(entity).bulkPut(items)
  }

  for (const [entity, ids] of deletes.entries()) {
    await tx.table(entity).bulkDelete(ids)
  }
}

/**
 * Clears all 24 master tables inside a full-resync apply transaction.
 * Never clears `meta`, local transaction stores, `outbox_command`, or `device_log`.
 */
export async function clearMasterStoresInTx(tx: Transaction): Promise<void> {
  for (const storeName of MASTER_STORE_NAMES) {
    await tx.table(storeName).clear()
  }
}

export async function countMasterEntities(
  db: SolvaDb,
  entities: readonly string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const entity of entities) {
    if (entity === 'tenant') {
      const t = await db.meta.get('tenant')
      counts[entity] = t ? 1 : 0
      continue
    }
    if (MASTER_SET.has(entity)) {
      counts[entity] = await db.table(entity).count()
    }
  }
  return counts
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
  return row && !row.deleted_at ? row : null
}

export async function getRolePermissions(
  db: SolvaDb,
  roleId: string,
): Promise<RolePermissionRecord[]> {
  return db.role_permission.where('role_id').equals(roleId).toArray()
}
