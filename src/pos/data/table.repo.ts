import type { SolvaDb } from '../db/solva-db'
import type { FnbTableRecord, ModifierGroupRecord, ModifierRecord } from '../db/types'

export interface ProductModifierGroupWithOptions {
  readonly group: ModifierGroupRecord
  readonly options: readonly ModifierRecord[]
}

export async function listActiveTables(db: SolvaDb, outletId: string): Promise<FnbTableRecord[]> {
  const rows = await db.fnb_table.toArray()
  return rows
    .filter((r) => !r.deleted_at && r.is_active && r.outlet_id === outletId)
    .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code))
}

export async function getTableById(db: SolvaDb, tableId: string): Promise<FnbTableRecord | null> {
  const row = await db.fnb_table.get(tableId)
  return row && !row.deleted_at ? row : null
}

/**
 * Loads active modifier groups & options linked to a product sorted by `sort_order`.
 */
export async function listProductModifierGroupsWithOptions(
  db: SolvaDb,
  productId: string,
): Promise<ProductModifierGroupWithOptions[]> {
  const links = await db.modifier_group_product.where('product_id').equals(productId).toArray()
  const activeLinks = links.filter((l) => !l.deleted_at).sort((a, b) => a.sort_order - b.sort_order)
  if (activeLinks.length === 0) return []

  const groupIds = activeLinks.map((l) => l.modifier_group_id)
  const [groups, allMods] = await Promise.all([
    db.modifier_group.bulkGet(groupIds),
    db.modifier.where('modifier_group_id').anyOf(groupIds).toArray(),
  ])

  const groupMap = new Map<string, ModifierGroupRecord>()
  for (const g of groups) {
    if (g && !g.deleted_at && g.is_active) groupMap.set(g.id, g)
  }

  const modsByGroup = new Map<string, ModifierRecord[]>()
  for (const m of allMods) {
    if (m.deleted_at || !m.is_active) continue
    const arr = modsByGroup.get(m.modifier_group_id) ?? []
    arr.push(m)
    modsByGroup.set(m.modifier_group_id, arr)
  }

  const out: ProductModifierGroupWithOptions[] = []
  for (const link of activeLinks) {
    const group = groupMap.get(link.modifier_group_id)
    if (!group) continue
    const options = (modsByGroup.get(group.id) ?? []).sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
    )
    out.push({ group, options })
  }
  return out
}

export async function countPendingBillOutbox(db: SolvaDb, billId: string): Promise<number> {
  const rows = await db.outbox_command.where('dependency_key').equals(`bill:${billId}`).toArray()
  return rows.filter((r) => r.status !== 'ACKED' && r.status !== 'DISMISSED').length
}
