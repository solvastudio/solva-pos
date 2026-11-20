import { afterEach, describe, expect, it } from 'vitest'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import {
  buildCartDraftId,
  deleteDraft,
  getActiveDraft,
  saveActiveDraft,
} from './cart-draft.repo'

const T1 = '0192a000-0000-7000-8000-00000000b301'
const REG = '0192a000-0000-7000-8000-00000000b302'
const STAFF1 = '0192a000-0000-7000-8000-00000000b303'
const STAFF2 = '0192a000-0000-7000-8000-00000000b304'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

describe('pos/data/cart-draft.repo', () => {
  it('saves, queries per (registerId, staffId), and deletes active drafts', async () => {
    const db = await openTenantDb(T1)
    const id1 = buildCartDraftId(REG, STAFF1)
    const id2 = buildCartDraftId(REG, STAFF2)

    await saveActiveDraft(db, {
      id: id1,
      kind: 'CART',
      register_id: REG,
      staff_id: STAFF1,
      status: 'ACTIVE',
      bill_key: 'CURRENT',
      payload: { lines: [{ id: 'L1' }] },
      updated_at: '2026-11-20T01:00:00.000Z',
    })
    await saveActiveDraft(db, {
      id: id2,
      kind: 'CART',
      register_id: REG,
      staff_id: STAFF2,
      status: 'ACTIVE',
      bill_key: 'CURRENT',
      payload: { lines: [{ id: 'L2' }] },
      updated_at: '2026-11-20T01:00:00.000Z',
    })

    const d1 = await getActiveDraft(db, REG, STAFF1)
    const d2 = await getActiveDraft(db, REG, STAFF2)
    expect((d1?.payload as { lines: { id: string }[] }).lines[0]?.id).toBe('L1')
    expect((d2?.payload as { lines: { id: string }[] }).lines[0]?.id).toBe('L2')

    await deleteDraft(db, id1)
    expect(await getActiveDraft(db, REG, STAFF1)).toBeNull()
    expect(await getActiveDraft(db, REG, STAFF2)).not.toBeNull()
  })
})
