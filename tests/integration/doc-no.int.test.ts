import { afterAll, describe, expect, it } from 'vitest'
import { postGr, saveGrDraft, saveTransferDraft, sendTransfer } from '~/modules/inventory/public'
import { closePools } from '~/server/db'
import { enableOutletInventory, setupInventoryTenant, type InventoryTenant } from './helpers/inventory'

/** Posts one GR line (value 1,000) and returns the final document number. */
async function postOneGr(t: InventoryTenant, outletId: string, businessDate: string): Promise<string> {
  const d = await saveGrDraft(t.actor, {
    outletId,
    businessDate,
    lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qty: '1', lineValue: 1000, unitCost: null }],
  })
  return (await postGr(t.actor, d.id)).docNo
}

async function tenantWithOutlets(prefix: string): Promise<InventoryTenant> {
  const t = await setupInventoryTenant(prefix)
  await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
  await enableOutletInventory(t.tenantId, t.outletB, '2026-11-01T00:00:00.000Z')
  return t
}

describe('inventory document number {KIND}-{OUTLET}-{MMYY}-{SEQ4} (BR-STK-020)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('sequence increases per outlet and month: GR-OUT01-1126-0001, 0002', async () => {
    const t = await tenantWithOutlets('doc-seq')
    expect(await postOneGr(t, t.outletA, '2026-11-20')).toBe('GR-OUT01-1126-0001')
    expect(await postOneGr(t, t.outletA, '2026-11-21')).toBe('GR-OUT01-1126-0002')
  })

  it('each document kind has its own sequence: TRF-OUT01-1126-0001 stays 0001 even after GR reached 0002', async () => {
    const t = await tenantWithOutlets('doc-kind')
    await postOneGr(t, t.outletA, '2026-11-20')
    await postOneGr(t, t.outletA, '2026-11-20')
    const draft = await saveTransferDraft(t.actor, {
      fromOutletId: t.outletA,
      toOutletId: t.outletB,
      businessDate: '2026-11-20',
      lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qtyInput: '1' }],
    })
    const sent = await sendTransfer(t.actor, draft.id)
    expect(sent.docNo).toBe('TRF-OUT01-1126-0001')
  })

  it('a different outlet starts its sequence at 0001', async () => {
    const t = await tenantWithOutlets('doc-outlet')
    await postOneGr(t, t.outletA, '2026-11-20')
    expect(await postOneGr(t, t.outletB, '2026-11-20')).toBe('GR-OUT02-1126-0001')
  })

  it('a different month starts its sequence at 0001 (MMYY from business_date)', async () => {
    const t = await tenantWithOutlets('doc-month')
    await postOneGr(t, t.outletA, '2026-11-20')
    expect(await postOneGr(t, t.outletA, '2026-12-05')).toBe('GR-OUT01-1226-0001')
  })

  it('parallel postings produce unique, consecutive numbers with no duplicates', async () => {
    const t = await tenantWithOutlets('doc-parallel')
    const drafts: string[] = []
    for (let i = 0; i < 5; i++) {
      const d = await saveGrDraft(t.actor, {
        outletId: t.outletA,
        businessDate: '2026-11-20',
        lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qty: '1', lineValue: 1000, unitCost: null }],
      })
      drafts.push(d.id)
    }
    const results = await Promise.all(drafts.map((id) => postGr(t.actor, id)))
    const numbers = results.map((r) => r.docNo).sort()
    expect(numbers).toEqual([
      'GR-OUT01-1126-0001',
      'GR-OUT01-1126-0002',
      'GR-OUT01-1126-0003',
      'GR-OUT01-1126-0004',
      'GR-OUT01-1126-0005',
    ])
  })
})
