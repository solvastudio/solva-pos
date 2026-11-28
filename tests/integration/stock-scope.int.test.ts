import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import type { IdentityAuthActor } from '~/modules/identity/public'
import type { PermissionCode } from '~/modules/identity/shared'
import {
  createStocktake,
  deleteSupplier,
  getStocktake,
  getTransfer,
  listGr,
  listStocktakes,
  listSuppliers,
  listTransferDestinations,
  listTransfers,
  postGr,
  reportR02,
  saveGrDraft,
  saveSupplier,
  saveTransferDraft,
} from '~/modules/inventory/public'
import { closePools } from '~/server/db'
import {
  enableOutletInventory,
  masterUpdate,
  setupInventoryTenant,
  type InventoryTenant,
} from './helpers/inventory'

function scopedActor(
  t: InventoryTenant,
  permissions: PermissionCode[],
  outletIds: string[],
): IdentityAuthActor {
  return {
    ...t.actor,
    permissions: new Set<PermissionCode>(permissions),
    outletIds,
    roleCodes: ['MANAGER'],
  }
}

describe('inventory outlet scope for list and detail reads, and supplier permissions', () => {
  afterAll(async () => {
    await closePools()
  })

  it('filters GR, transfer and stocktake lists to the actor outlets and rejects out-of-scope details', async () => {
    const t = await setupInventoryTenant('stock-scope')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    await enableOutletInventory(t.tenantId, t.outletB, '2026-11-01T00:00:00.000Z')

    const grDraft = await saveGrDraft(t.actor, {
      outletId: t.outletA,
      businessDate: '2026-11-20',
      lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qty: '5', lineValue: 50000, unitCost: null }],
    })
    await postGr(t.actor, grDraft.id)
    const transfer = await saveTransferDraft(t.actor, {
      fromOutletId: t.outletA,
      toOutletId: t.outletB,
      businessDate: '2026-11-20',
      lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qtyInput: '1' }],
    })
    const stocktake = await createStocktake(t.actor, {
      outletId: t.outletA,
      businessDate: '2026-11-20',
      scope: 'SELECTED',
      skuIds: [t.skuA],
    })

    const managerA = scopedActor(t, ['inventory.manage'], [t.outletA])
    const managerB = scopedActor(t, ['inventory.manage'], [t.outletB])
    const outsider = scopedActor(t, ['inventory.manage'], [randomUUID()])

    // Tenant-wide actor sees everything.
    expect((await listGr(t.actor)).length).toBeGreaterThan(0)
    expect((await listTransfers(t.actor)).map((r) => r.id)).toEqual([transfer.id])
    expect((await listStocktakes(t.actor)).map((r) => r.id)).toEqual([stocktake.id])

    // Outlet A manager sees the A documents.
    const grA = await listGr(managerA)
    expect(grA.length).toBeGreaterThan(0)
    expect(grA.every((r) => r.outletId === t.outletA)).toBe(true)
    expect((await listTransfers(managerA)).map((r) => r.id)).toEqual([transfer.id])
    expect((await listStocktakes(managerA)).map((r) => r.id)).toEqual([stocktake.id])
    await expect(getStocktake(managerA, stocktake.id)).resolves.toMatchObject({ id: stocktake.id })

    // Outlet B manager sees the transfer (destination) but not the A receipt or stocktake.
    expect(await listGr(managerB)).toEqual([])
    expect((await listTransfers(managerB)).map((r) => r.id)).toEqual([transfer.id])
    expect(await listStocktakes(managerB)).toEqual([])
    await expect(getTransfer(managerB, transfer.id)).resolves.toMatchObject({ id: transfer.id })
    await expect(getStocktake(managerB, stocktake.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // An actor with an unrelated outlet sees nothing and cannot filter by an outlet outside its scope.
    expect(await listGr(outsider)).toEqual([])
    expect(await listTransfers(outsider)).toEqual([])
    expect(await listStocktakes(outsider)).toEqual([])
    await expect(getTransfer(outsider, transfer.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(listTransfers(outsider, { outletId: t.outletA })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('lets inventory.manage list suppliers but requires supplier.manage to change them', async () => {
    const t = await setupInventoryTenant('sup-perm')
    const stockOnly = scopedActor(t, ['inventory.manage'], [t.outletA])
    const supplierOnly = scopedActor(t, ['supplier.manage'], [t.outletA])
    const nobody = scopedActor(t, [], [t.outletA])

    const created = await saveSupplier(supplierOnly, { name: 'PT Scope Test' })
    expect((await listSuppliers(stockOnly)).map((s) => s.id)).toContain(created.id)
    expect((await listSuppliers(supplierOnly)).map((s) => s.id)).toContain(created.id)

    await expect(saveSupplier(stockOnly, { name: 'Not Allowed' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(deleteSupplier(stockOnly, created.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(listSuppliers(nobody)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await deleteSupplier(supplierOnly, created.id)
    expect(await listSuppliers(supplierOnly)).toEqual([])
  })

  it('limits the R-02 stock report to the actor outlets, with or without an outlet filter', async () => {
    const t = await setupInventoryTenant('r02-scope')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    await enableOutletInventory(t.tenantId, t.outletB, '2026-11-01T00:00:00.000Z')
    for (const outletId of [t.outletA, t.outletB]) {
      const draft = await saveGrDraft(t.actor, {
        outletId,
        businessDate: '2026-11-20',
        lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qty: '5', lineValue: 50000, unitCost: null }],
      })
      await postGr(t.actor, draft.id)
    }

    const managerA = scopedActor(t, ['report.view'], [t.outletA])
    const outsider = scopedActor(t, ['report.view'], [randomUUID()])

    // Tenant-wide actor sees both outlets.
    const all = await reportR02(t.actor, {})
    expect(new Set(all.rows.map((r) => r.outletId))).toEqual(new Set([t.outletA, t.outletB]))

    // Outlet A manager sees only outlet A (rows and totals) when no filter is given.
    const scoped = await reportR02(managerA, {})
    expect(scoped.rows.length).toBeGreaterThan(0)
    expect(scoped.rows.every((r) => r.outletId === t.outletA)).toBe(true)
    expect(scoped.totals.map((x) => x.outletId)).toEqual([t.outletA])

    // A filter outside the scope is still rejected.
    await expect(reportR02(managerA, { outletId: t.outletB })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    // An actor whose outlets do not exist in this tenant sees nothing.
    expect(await reportR02(outsider, {})).toEqual({ rows: [], totals: [] })
  })

  it('offers every active outlet as a transfer destination to inventory.manage holders, whatever their scope', async () => {
    const t = await setupInventoryTenant('xfer-dest')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    await enableOutletInventory(t.tenantId, t.outletB, '2026-11-01T00:00:00.000Z')

    const managerA = scopedActor(t, ['inventory.manage'], [t.outletA])
    const reportOnly = scopedActor(t, ['report.view'], [t.outletA])

    // The list is not limited to the actor's own outlets.
    expect((await listTransferDestinations(managerA)).map((o) => o.code)).toEqual(['OUT01', 'OUT02'])
    expect((await listTransferDestinations(t.actor)).map((o) => o.code)).toEqual(['OUT01', 'OUT02'])
    // Without inventory.manage the list is refused.
    await expect(listTransferDestinations(reportOnly)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // The server accepts a destination outside the sender's scope (only the source outlet is checked).
    const draft = await saveTransferDraft(managerA, {
      fromOutletId: t.outletA,
      toOutletId: t.outletB,
      businessDate: '2026-11-20',
      lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qtyInput: '1' }],
    })
    expect(draft.id).toBeTruthy()

    // Inactive outlets are not offered.
    await masterUpdate(
      t.tenantId,
      'UPDATE outlet SET is_active = false, version = $3 WHERE tenant_id = $1 AND id = $2',
      [t.tenantId, t.outletB],
    )
    expect((await listTransferDestinations(managerA)).map((o) => o.code)).toEqual(['OUT01'])
  })
})
