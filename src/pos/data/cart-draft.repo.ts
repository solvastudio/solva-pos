import type { SolvaDb } from '../db/solva-db'
import type { CartDraftRecord } from '../db/types'

export function buildCartDraftId(registerId: string, staffId: string): string {
  return `cart:${registerId}:${staffId}`
}

export async function getActiveDraft(
  db: SolvaDb,
  registerId: string,
  staffId: string,
): Promise<CartDraftRecord | null> {
  const row = await db.cart_draft
    .where('[register_id+staff_id+status]')
    .equals([registerId, staffId, 'ACTIVE'])
    .first()
  return row ?? null
}

export async function saveActiveDraft(db: SolvaDb, record: CartDraftRecord): Promise<void> {
  await db.cart_draft.put(record)
}

export async function deleteDraft(db: SolvaDb, id: string): Promise<void> {
  await db.cart_draft.delete(id)
}
