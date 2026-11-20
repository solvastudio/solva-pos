import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { REGISTRY_DB_NAME } from '../locks/names'
import {
  closeRegistryDbForTests,
  findTenantIdBySlug,
  forgetTenantFromRegistry,
  listTenants,
  rememberTenant,
  touchTenant,
} from './registry'

const T1 = '0192a000-0000-7000-8000-00000000a001'
const T2 = '0192a000-0000-7000-8000-00000000a002'

afterEach(async () => {
  closeRegistryDbForTests()
  await Dexie.delete(REGISTRY_DB_NAME)
})

describe('pos/db/registry (solva-registry)', () => {
  it('stores slug -> tenant_id without name/credentials and enforces unique immutable mappings', async () => {
    await rememberTenant({ tenantId: T1, slug: 'Kopi-Satu', nowIso: '2026-11-20T01:00:00.000Z' })

    expect(await findTenantIdBySlug('kopi-satu')).toBe(T1)
    expect(await findTenantIdBySlug('missing-slug')).toBeNull()

    // Duplicate slug on another tenant must reject
    await expect(
      rememberTenant({ tenantId: T2, slug: 'kopi-satu', nowIso: '2026-11-20T01:01:00.000Z' }),
    ).rejects.toThrow(/already bound/i)

    // Changing slug on existing tenant_id must reject
    await expect(
      rememberTenant({ tenantId: T1, slug: 'kopi-lain', nowIso: '2026-11-20T01:02:00.000Z' }),
    ).rejects.toThrow(/cannot reassign/i)

    await touchTenant(T1, '2026-11-20T02:00:00.000Z')
    const rows = await listTenants()
    expect(rows).toEqual([
      { tenant_id: T1, slug: 'kopi-satu', last_opened_at: '2026-11-20T02:00:00.000Z' },
    ])

    await forgetTenantFromRegistry(T1)
    expect(await listTenants()).toEqual([])
  })
})
