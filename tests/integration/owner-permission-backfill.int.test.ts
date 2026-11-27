import { afterAll, describe, expect, it } from 'vitest'
import { runtimeIdGenerator } from '~/lib/runtime-id'
import {
  ensureOwnerHasAllPermissions,
  ensureOwnerHasAllPermissionsForTenant,
  listRolesWithPermissions,
} from '~/modules/identity/public'
import {
  findRoleByCode,
  syncRolePermissionsRows,
} from '~/modules/identity/server/role.repo'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { writeMaster } from '~/modules/sync/public'
import { closePools, withTenant } from '~/server/db'
import { bootstrapIdentityTenant } from './helpers/identity-actor'
import { uniqueSlug } from './helpers/tenants'

describe('owner permission backfill job', () => {
  afterAll(async () => {
    await closePools()
  })

  it('restores a missing permission on OWNER once and is a no-op afterwards', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('ownbf'))

    // A freshly seeded tenant is already complete.
    expect(await ensureOwnerHasAllPermissionsForTenant(t.tenantId)).toBe(false)

    // Simulate a tenant created before `role.manage` existed.
    await withTenant(t.tenantId, async (tx) => {
      const owner = await findRoleByCode(tx, t.tenantId, 'OWNER')
      await writeMaster(tx, { actorUserId: null }, (w) =>
        syncRolePermissionsRows(tx, w, {
          roleId: owner!.id,
          desiredCodes: new Set<string>(PERMISSION_CODES.filter((c) => c !== 'role.manage')),
          newId: () => runtimeIdGenerator.newId(),
          nowIso: new Date().toISOString(),
        }),
      )
    })
    const before = (await listRolesWithPermissions(t.actor)).find((r) => r.code === 'OWNER')!
    expect(before.permissions).not.toContain('role.manage')

    expect(await ensureOwnerHasAllPermissionsForTenant(t.tenantId)).toBe(true)
    const after = (await listRolesWithPermissions(t.actor)).find((r) => r.code === 'OWNER')!
    expect(after.permissions).toContain('role.manage')
    expect(after.permissions).toHaveLength(PERMISSION_CODES.length)

    expect(await ensureOwnerHasAllPermissionsForTenant(t.tenantId)).toBe(false)
    expect(await ensureOwnerHasAllPermissions({ tenantIds: [t.tenantId] })).toEqual({
      tenantsChecked: 1,
      tenantsRepaired: 0,
    })
  })
})
