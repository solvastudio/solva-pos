import { afterAll, describe, expect, it } from 'vitest'
import { runtimeIdGenerator } from '~/lib/runtime-id'
import { createRole } from '~/modules/identity/public'
import { findRoleById } from '~/modules/identity/server/role.repo'
import { rolePermission } from '~/modules/identity/server/schema'
import { writeMaster } from '~/modules/sync/public'
import { closePools, withTenant } from '~/server/db'
import { bootstrapIdentityTenant } from './helpers/identity-actor'
import { uniqueSlug } from './helpers/tenants'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('role row lock order', () => {
  afterAll(async () => {
    await closePools()
  })

  it('does not deadlock when a role is locked while another master write inserts rows that reference it', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('rlock'))
    const custom = await createRole(t.actor, {
      name: 'Kunci Uji',
      discountLimitPct: 0,
      permissions: ['bill.edit'],
    })
    const aLocked = deferred()
    const bHasSync = deferred()

    // A mimics updateRole/deleteRole: lock the role row first, then take the tenant_sync lock.
    const a = withTenant(t.tenantId, async (tx) => {
      await findRoleById(tx, t.tenantId, custom.id)
      aLocked.resolve()
      await bHasSync.promise
      await writeMaster(tx, { actorUserId: null }, async () => undefined)
    })

    // B mimics a member assignment: take the tenant_sync lock first, then insert a row whose FK
    // points at the role (the FK check takes a KEY SHARE lock on the role row).
    const b = withTenant(t.tenantId, async (tx) => {
      await aLocked.promise
      await writeMaster(tx, { actorUserId: null }, async (w) => {
        bHasSync.resolve()
        const nowIso = new Date().toISOString()
        await tx.insert(rolePermission).values({
          id: runtimeIdGenerator.newId(),
          tenantId: t.tenantId,
          roleId: custom.id,
          permissionCode: 'report.view',
          version: w.version,
          createdAt: nowIso,
          updatedAt: nowIso,
          createdBy: null,
          updatedBy: null,
        })
      })
    })

    await expect(Promise.all([a, b])).resolves.toBeDefined()
  })
})
