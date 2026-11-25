import { afterAll, describe, expect, it } from 'vitest'
import { deleteSupplier, listSuppliers, saveSupplier } from '~/modules/inventory/public'
import { closePools } from '~/server/db'
import { setupInventoryTenant } from './helpers/inventory'

describe('suppliers (CRUD, soft-delete)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('add, update, and reject duplicate names (case-insensitive)', async () => {
    const t = await setupInventoryTenant('sup')
    const a = await saveSupplier(t.actor, { name: '  PT Susu Murni ', contact: '021-555' })
    await expect(saveSupplier(t.actor, { name: 'pt susu murni' })).rejects.toThrow(/supplierNameTaken/)
    await saveSupplier(t.actor, { id: a.id, name: 'PT Susu Murni Jaya', contact: null })
    const list = await listSuppliers(t.actor)
    expect(list).toEqual([{ id: a.id, name: 'PT Susu Murni Jaya', contact: null, active: true }])
  })

  it('name length (max 120) and contact (max 200) validation', async () => {
    const t = await setupInventoryTenant('sup-len')
    await expect(saveSupplier(t.actor, { name: '   ' })).rejects.toThrow(/supplierNameRequired/)
    await expect(saveSupplier(t.actor, { name: 'x'.repeat(121) })).rejects.toThrow(/supplierNameRequired/)
    await expect(saveSupplier(t.actor, { name: 'Ok', contact: 'y'.repeat(201) })).rejects.toThrow(/supplierContactMax/)
  })

  it('delete = soft-delete: removed from the active list, still present when requested; the name may be reused', async () => {
    const t = await setupInventoryTenant('sup-del')
    const a = await saveSupplier(t.actor, { name: 'Gudang Lama' })
    await deleteSupplier(t.actor, a.id)
    expect(await listSuppliers(t.actor)).toEqual([])
    const withInactive = await listSuppliers(t.actor, { includeInactive: true })
    expect(withInactive.map((s) => [s.id, s.active])).toEqual([[a.id, false]])
    await saveSupplier(t.actor, { name: 'Gudang Lama' })
    expect((await listSuppliers(t.actor)).length).toBe(1)
  })
})
