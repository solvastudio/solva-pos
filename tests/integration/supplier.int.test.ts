import { afterAll, describe, expect, it } from 'vitest'
import { deleteSupplier, listSuppliers, saveSupplier } from '~/modules/inventory/public'
import { closePools } from '~/server/db'
import { setupInventoryTenant } from './helpers/inventory'

describe('pemasok (CRUD, soft-delete)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('tambah, ubah, dan cegah nama ganda (tanpa memperhatikan huruf besar-kecil)', async () => {
    const t = await setupInventoryTenant('sup')
    const a = await saveSupplier(t.actor, { name: '  PT Susu Murni ', contact: '021-555' })
    await expect(saveSupplier(t.actor, { name: 'pt susu murni' })).rejects.toThrow(/sudah digunakan/)
    await saveSupplier(t.actor, { id: a.id, name: 'PT Susu Murni Jaya', contact: null })
    const list = await listSuppliers(t.actor)
    expect(list).toEqual([{ id: a.id, name: 'PT Susu Murni Jaya', contact: null, active: true }])
  })

  it('validasi panjang nama (maks 120) dan kontak (maks 200)', async () => {
    const t = await setupInventoryTenant('sup-len')
    await expect(saveSupplier(t.actor, { name: '   ' })).rejects.toThrow(/wajib diisi/)
    await expect(saveSupplier(t.actor, { name: 'x'.repeat(121) })).rejects.toThrow(/wajib diisi/)
    await expect(saveSupplier(t.actor, { name: 'Ok', contact: 'y'.repeat(201) })).rejects.toThrow(/maksimal 200/)
  })

  it('hapus = soft-delete: hilang dari daftar aktif, tetap ada bila diminta; nama boleh dipakai ulang', async () => {
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
