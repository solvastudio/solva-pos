import { webcrypto } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import {
  changeMemberRoleAndOutlets,
  createInvite,
  createLegalEntity,
  createOutlet,
  createTenant,
  getTenantAuthMetadataBySlug,
  listMembers,
  listPendingInvites,
  listRolesWithPermissions,
  redeemInvite,
  removeMember,
  updateRole,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { closePools } from '~/server/db'
import { appClient, withClient } from './helpers/db'
import { uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-mem@example.test' }

async function bootstrapTenant(slug: string) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Tenant ${slug}`,
    slug,
    ownerEmail: email,
    ownerDisplayName: 'Owner',
  })
  const meta = await getTenantAuthMetadataBySlug(slug)
  await redeemInvite({
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    email,
    code: created.ownerInvite.code,
    password: 'OwnerPassword123!',
  })
  const actor: IdentityAuthActor = {
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
    roleCodes: ['OWNER'],
  }
  return { tenantId: created.tenantId, slug, authOrgId: meta!.authOrgId, ownerEmail: email, actor }
}

describe('members-admin & role integration (tenant_member_emails, scopes, role locking)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('isolates tenant_member_emails(), enforces Manager scope, prevents removing last OWNER, and locks OWNER permissions', async () => {
    const tA = await bootstrapTenant(uniqueSlug('mema'))
    const tB = await bootstrapTenant(uniqueSlug('memb'))

    const leA = await createLegalEntity(tA.actor, { name: 'PT A', isPkp: false })
    const out01 = await createOutlet(tA.actor, {
      legalEntityId: leA.id,
      code: 'OUT01',
      name: 'Outlet 01',
      timezone: 'Asia/Jakarta',
      dayCutoffTime: '00:00',
      priceTaxMode: 'INCLUSIVE',
    })
    const out02 = await createOutlet(tA.actor, {
      legalEntityId: leA.id,
      code: 'OUT02',
      name: 'Outlet 02',
      timezone: 'Asia/Jakarta',
      dayCutoffTime: '00:00',
      priceTaxMode: 'INCLUSIVE',
    })

    const rolesA = await listRolesWithPermissions(tA.actor)
    const ownerRole = rolesA.find((r) => r.code === 'OWNER')!
    const managerRole = rolesA.find((r) => r.code === 'MANAGER')!
    const cashierRole = rolesA.find((r) => r.code === 'CASHIER')!
    const waiterRole = rolesA.find((r) => r.code === 'WAITER')!

    const sharedEmail = `shared-${uniqueSlug('sh')}@example.test`
    const tenantBOnlyEmail = `onlyb-${uniqueSlug('ob')}@example.test`
    const pendingEmail = `pend-${uniqueSlug('pn')}@example.test`

    // Invite + redeem sharedEmail in both Tenant A (OUT01 CASHIER) and Tenant B.
    const invSharedA = await createInvite(tA.actor, {
      email: sharedEmail,
      displayName: 'Shared Staff A',
      roleId: cashierRole.id,
      outletIds: [out01.id],
    })
    await redeemInvite({
      tenantId: tA.tenantId,
      tenantSlug: tA.slug,
      authOrgId: tA.authOrgId,
      email: sharedEmail,
      code: invSharedA.code,
      password: 'StaffPassword123!',
    })

    const rolesB = await listRolesWithPermissions(tB.actor)
    const cashierRoleB = rolesB.find((r) => r.code === 'CASHIER')!
    const invSharedB = await createInvite(tB.actor, {
      email: sharedEmail,
      displayName: 'Shared Staff B',
      roleId: cashierRoleB.id,
      outletIds: null,
    })
    await redeemInvite({
      tenantId: tB.tenantId,
      tenantSlug: tB.slug,
      authOrgId: tB.authOrgId,
      email: sharedEmail,
      code: invSharedB.code,
      password: 'StaffPassword123!',
    })

    const invOnlyB = await createInvite(tB.actor, {
      email: tenantBOnlyEmail,
      displayName: 'Only B Staff',
      roleId: cashierRoleB.id,
      outletIds: null,
    })
    await redeemInvite({
      tenantId: tB.tenantId,
      tenantSlug: tB.slug,
      authOrgId: tB.authOrgId,
      email: tenantBOnlyEmail,
      code: invOnlyB.code,
      password: 'StaffPassword123!',
    })

    // Pending invite in Tenant A.
    await createInvite(tA.actor, {
      email: pendingEmail,
      displayName: 'Pending Staff',
      roleId: waiterRole.id,
      outletIds: [out02.id],
    })
    expect((await listPendingInvites(tA.actor)).map((p) => p.email)).toContain(pendingEmail)

    // SECURITY DEFINER tenant_member_emails() only returns ACTIVE members for caller's tenant.
    await withClient(appClient, async (client) => {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tA.tenantId])
      const res = await client.query('SELECT app_user_id, email FROM tenant_member_emails()')
      await client.query('COMMIT')
      const returnedEmails = res.rows.map((r) => r.email)
      expect(returnedEmails).toContain(tA.ownerEmail)
      expect(returnedEmails).toContain(sharedEmail)
      expect(returnedEmails).not.toContain(tenantBOnlyEmail)
      expect(returnedEmails).not.toContain(pendingEmail)
    })

    // Last Owner protection in changeMemberRoleAndOutlets.
    await expect(
      changeMemberRoleAndOutlets(tA.actor, {
        appUserId: tA.actor.appUserId,
        assignments: [{ outletId: null, roleId: cashierRole.id }],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'admin.users.lastOwner',
    })

    // Invite + redeem a Manager scoped only to OUT01 and another staff in OUT02.
    const mgrEmail = `mgr-${uniqueSlug('mg')}@example.test`
    const invMgr = await createInvite(tA.actor, {
      email: mgrEmail,
      displayName: 'Manager One',
      roleId: managerRole.id,
      outletIds: [out01.id],
    })
    await redeemInvite({
      tenantId: tA.tenantId,
      tenantSlug: tA.slug,
      authOrgId: tA.authOrgId,
      email: mgrEmail,
      code: invMgr.code,
      password: 'MgrPassword123!',
    })

    const managerActor: IdentityAuthActor = {
      tenantId: tA.tenantId,
      tenantSlug: tA.slug,
      authOrgId: tA.actor.authOrgId,
      appUserId: invMgr.appUserId,
      permissions: new Set(['user.manage']),
      outletIds: [out01.id],
      roleCodes: ['MANAGER'],
    }

    // Manager listMembers excludes tenant-wide OWNER and OUT02 members.
    const mgrList = await listMembers(managerActor)
    expect(mgrList.some((m) => m.email === sharedEmail)).toBe(true)
    expect(mgrList.some((m) => m.email === tA.ownerEmail)).toBe(false)
    expect(mgrList.some((m) => m.email === pendingEmail)).toBe(false)

    // Manager can change sharedEmail inside OUT01 (CASHIER -> WAITER), cannot assign OUT02 or OWNER.
    const updatedShared = await changeMemberRoleAndOutlets(managerActor, {
      appUserId: invSharedA.appUserId,
      assignments: [{ outletId: out01.id, roleId: waiterRole.id }],
    })
    expect(updatedShared.assignments[0]?.roleCode).toBe('WAITER')

    await expect(
      changeMemberRoleAndOutlets(managerActor, {
        appUserId: invSharedA.appUserId,
        assignments: [{ outletId: out02.id, roleId: waiterRole.id }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await expect(
      changeMemberRoleAndOutlets(managerActor, {
        appUserId: invSharedA.appUserId,
        assignments: [{ outletId: out01.id, roleId: ownerRole.id }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Removed member leaves listMembers and tenant_member_emails().
    await removeMember(tA.actor, invSharedA.appUserId)
    const afterRemove = await listMembers(tA.actor)
    expect(afterRemove.some((m) => m.appUserId === invSharedA.appUserId)).toBe(false)

    // updateRole: OWNER permissions locked; updating non-OWNER role bumps version & supports revoke+regrant.
    await expect(
      updateRole(tA.actor, { roleId: ownerRole.id, permissions: ['sale.create'] }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'admin.users.role.ownerPermissionsLocked',
    })

    const reducedPerms = cashierRole.permissions.filter((p) => p !== 'discount.manual')
    const roleAfterRevoke = await updateRole(tA.actor, {
      roleId: cashierRole.id,
      discountLimitPct: 15,
      permissions: reducedPerms,
    })
    expect(roleAfterRevoke.discountLimitPct).toBe(15)
    expect(roleAfterRevoke.permissions).not.toContain('discount.manual')

    // Re-granting previously deleted permission succeeds (handles uq_role_permission__role_perm).
    const roleAfterRegrant = await updateRole(tA.actor, {
      roleId: cashierRole.id,
      permissions: [...reducedPerms, 'discount.manual'],
    })
    expect(roleAfterRegrant.permissions).toContain('discount.manual')
    expect(roleAfterRegrant.version).toBeGreaterThan(roleAfterRevoke.version)
  })
})
