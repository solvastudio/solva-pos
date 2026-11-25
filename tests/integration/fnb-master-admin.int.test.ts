import { afterAll, describe, expect, it } from 'vitest'
import {
  createModifier,
  createModifierGroup,
  deleteModifierGroup,
  linkModifierGroupProduct,
  listProductModifierGroups,
  setPrice,
  unlinkModifierGroupProduct,
  updateModifier,
} from '~/modules/catalog/public'
import { createTable, deactivateOrDeleteTable, listTables, updateTable } from '~/modules/fnb/public'
import { closePools } from '~/server/db'
import { seedOpenBill, setupFnbTenant, withFnbAppTx } from './helpers/fnb'

describe('F&B Master Admin services (tables & modifiers)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('handles table CRUD, open-bill deactivation guard, and bill-history deactivation vs delete', async () => {
    const f = await setupFnbTenant('fnb-adm-tbl')

    const unused = await createTable(f.fnbActor, {
      outletId: f.outletA,
      code: 'T02',
      area: 'Teras',
      capacity: 2,
    })
    await expect(
      createTable(f.fnbActor, { outletId: f.outletA, code: 'T02' }),
    ).rejects.toThrow(/admin\.tables\.codeTaken/)

    const updated = await updateTable(f.fnbActor, {
      id: unused.id,
      area: 'VIP',
      capacity: 6,
    })
    expect(updated.area).toBe('VIP')
    expect(updated.capacity).toBe(6)

    // Unused table -> physical tombstone delete
    const delRes = await deactivateOrDeleteTable(f.fnbActor, unused.id)
    expect(delRes.mode).toBe('deleted')

    // Table with OPEN bill -> reject deactivate/delete
    const { billId } = await withFnbAppTx(f.tenantId, (c) => seedOpenBill(c, f))
    await expect(deactivateOrDeleteTable(f.fnbActor, f.tableA1Id)).rejects.toThrow(
      /admin\.tables\.hasOpenBill/,
    )
    await expect(
      updateTable(f.fnbActor, { id: f.tableA1Id, isActive: false }),
    ).rejects.toThrow(/admin\.tables\.hasOpenBill/)

    // Close bill -> table now has historical bill, so deactivate sets is_active = false
    await withFnbAppTx(f.tenantId, (c) =>
      c.query(`UPDATE bill SET status = 'PAID', closed_at = now() WHERE id = $1`, [billId]),
    )
    const deactRes = await deactivateOrDeleteTable(f.fnbActor, f.tableA1Id)
    expect(deactRes.mode).toBe('deactivated')
    expect(deactRes.table.isActive).toBe(false)

    const allTables = await listTables(f.fnbActor, f.outletA)
    expect(allTables.map((t) => t.id)).toEqual([f.tableA1Id])

    // Outlet scope guard
    const scopedActor = { ...f.fnbActor, outletIds: [f.outletB] }
    await expect(listTables(scopedActor, f.outletA)).rejects.toThrow(/outside your assigned scope/)
  })

  it('handles modifier groups, ingredient adjustments, MENU_FNB link/revive, and negative delta warning', async () => {
    const f = await setupFnbTenant('fnb-adm-mod')

    // Set base price on MENU_FNB SKU = Rp 10.000
    await setPrice(f.catalogActor, {
      skuId: f.menuSkuId,
      uomId: f.pcsUomId,
      outletId: null,
      price: 10000,
    })

    const grp = await createModifierGroup(f.catalogActor, {
      name: 'Kustomisasi',
      selectionType: 'MULTI',
      minSelect: 0,
      maxSelect: 3,
    })

    const mod = await createModifier(f.catalogActor, {
      modifierGroupId: grp.id,
      name: 'Tanpa Telur',
      priceDelta: -12000,
      ingredients: [{ ingredientSkuId: f.ingTrackedSkuId, adjustType: 'REMOVE', qty: null }],
    })
    expect(mod.ingredients).toHaveLength(1)
    expect(mod.ingredients[0]?.adjustType).toBe('REMOVE')

    // Atomic ingredient replacement on updateModifier
    const updatedMod = await updateModifier(f.catalogActor, {
      id: mod.id,
      ingredients: [{ ingredientSkuId: f.ingTrackedSkuId, adjustType: 'REDUCE', qty: '5' }],
    })
    expect(updatedMod.ingredients).toHaveLength(1)
    expect(updatedMod.ingredients[0]?.adjustType).toBe('REDUCE')
    expect(Number(updatedMod.ingredients[0]?.qty)).toBe(5)

    // Linking to RETAIL product is rejected
    await expect(
      linkModifierGroupProduct(f.catalogActor, {
        modifierGroupId: grp.id,
        productId: f.retailProductId,
      }),
    ).rejects.toThrow(/MENU_FNB/)

    // Link, check negativeDeltaWarning, unlink, then re-link (revives soft-deleted row via ON CONFLICT)
    await linkModifierGroupProduct(f.catalogActor, {
      modifierGroupId: grp.id,
      productId: f.menuProductId,
    })
    const linked = await listProductModifierGroups(f.catalogActor, f.menuProductId)
    expect(linked).toHaveLength(1)
    expect(linked[0]?.negativeDeltaWarning).toBe(true)

    await unlinkModifierGroupProduct(f.catalogActor, {
      modifierGroupId: grp.id,
      productId: f.menuProductId,
    })
    expect(await listProductModifierGroups(f.catalogActor, f.menuProductId)).toHaveLength(0)

    const revived = await linkModifierGroupProduct(f.catalogActor, {
      modifierGroupId: grp.id,
      productId: f.menuProductId,
    })
    expect(revived.modifierGroupId).toBe(grp.id)
    expect(await listProductModifierGroups(f.catalogActor, f.menuProductId)).toHaveLength(1)

    await deleteModifierGroup(f.catalogActor, grp.id)
    expect(await listProductModifierGroups(f.catalogActor, f.menuProductId)).toHaveLength(0)
  })
})
