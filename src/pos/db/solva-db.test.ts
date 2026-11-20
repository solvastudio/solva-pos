import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { tenantDbName } from '../locks/names'
import { STORES_V1 } from './schema-v1'
import { closeTenantDb, openTenantDb } from './solva-db'

const T1 = '0192a000-0000-7000-8000-00000000a001'
const T2 = '0192a000-0000-7000-8000-00000000a002'

afterEach(async () => {
  closeTenantDb(T1)
  closeTenantDb(T2)
  await Dexie.delete(tenantDbName(T1))
  await Dexie.delete(tenantDbName(T2))
})

describe('pos/db/solva-db & schema-v1', () => {
  it('defines all 48 v1 stores matching docs/SCHEMA.md §6.3 plus pull_stage', () => {
    const storeNames = Object.keys(STORES_V1)
    expect(storeNames).toHaveLength(48)
    expect(STORES_V1.sale).toBe(
      'id, &invoice_no, [register_id+invoice_period+invoice_seq], business_date, shift_id, bill_id, [sync_status+business_date]',
    )
    expect(STORES_V1.sku_uom).toBe('id, &barcode, [sku_id+uom_id], sku_id')
    expect(STORES_V1.pull_stage).toBe('++seq, cycle_id')
    expect(STORES_V1.device_log).toBe('++id, &ref_local, [send_status+id]')
  })

  it('rejects slugs, caches one instance per tenantId, sets dexie_version=1, and isolates DBs per tenant', async () => {
    await expect(openTenantDb('kopi-slug')).rejects.toThrow(/Invalid tenantId UUID/i)

    const db1a = await openTenantDb(T1)
    const db1b = await openTenantDb(T1)
    expect(db1a).toBe(db1b)
    expect(db1a.name).toBe(`solva-pos:${T1}`)
    expect(db1a.verno).toBe(1)

    const ver = await db1a.meta.get('dexie_version')
    expect(ver?.value).toBe(1)

    const db2 = await openTenantDb(T2)
    expect(db2).not.toBe(db1a)
    expect(db2.name).toBe(`solva-pos:${T2}`)
  })
})
