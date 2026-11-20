import { afterEach, describe, expect, it } from 'vitest'
import { toMoney } from '~/lib/kernel'
import { buildCartDraftId, getActiveDraft } from '../data/cart-draft.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import type { ResolvedCartItem } from '../domain/cart'
import { createCartStore } from './cart-store'

const T1 = '0192a000-0000-7000-8000-00000000b401'
const REG = '0192a000-0000-7000-8000-00000000b402'
const STAFF1 = '0192a000-0000-7000-8000-00000000b403'
const STAFF2 = '0192a000-0000-7000-8000-00000000b404'
const SHIFT = '0192a000-0000-7000-8000-00000000b405'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

const ITEM_A: ResolvedCartItem = {
  skuId: 's1',
  productId: 'p1',
  uomId: 'u1',
  skuCode: 'KOP-1',
  itemName: 'Kopi Susu',
  uomCode: 'PCS',
  conversionFactor: '1',
  allowFraction: false,
  taxable: true,
  price: { kind: 'PRICE', price: toMoney(25_000), source: 'DEFAULT' },
}

describe('pos/state/cart-store', () => {
  it('persists immediately on addItem/removeLine, debounces qty edits, and isolates drafts by staffId', async () => {
    const db = await openTenantDb(T1)
    const store1 = createCartStore()
    const ctx1 = {
      registerId: REG,
      staffId: STAFF1,
      shiftId: SHIFT,
      config: {
        priceTaxMode: 'EXCLUSIVE' as const,
        taxProfile: 'PPN' as const,
        taxRate: '11.0000',
        serviceChargeEnabled: false,
        serviceChargeRate: '0',
        serviceChargeTaxable: true,
      },
      cashRoundingUnit: 100 as const,
      taxRateId: 'tx1',
    }
    await store1.getState().hydrate(db, ctx1)

    const added = store1.getState().addItem(ITEM_A)
    expect(added.ok).toBe(true)
    const lineId = added.touchedLineId!

    // Immediate persistence without waiting for 150ms debounce
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 15))
    const draftAfterAdd = await getActiveDraft(db, REG, STAFF1)
    expect(draftAfterAdd?.id).toBe(buildCartDraftId(REG, STAFF1))

    // Qty edit is debounced (150ms) then persisted
    store1.getState().setQty(lineId, '3')
    await new Promise((r) => setTimeout(r, 200))

    // Fresh store hydrates saved draft for STAFF1; STAFF2 gets empty cart
    const store1Reloaded = createCartStore()
    await store1Reloaded.getState().hydrate(db, ctx1)
    expect(store1Reloaded.getState().cart.lines).toHaveLength(1)
    expect(store1Reloaded.getState().cart.lines[0]!.qty).toBe('3')

    const store2 = createCartStore()
    await store2.getState().hydrate(db, { ...ctx1, staffId: STAFF2 })
    expect(store2.getState().cart.lines).toHaveLength(0)

    // Remove deletes draft
    store1Reloaded.getState().removeLine(lineId)
    await new Promise((r) => setTimeout(r, 20))
    expect(await getActiveDraft(db, REG, STAFF1)).toBeNull()
  })
})
