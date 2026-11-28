import { webcrypto } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import {
  cancelInvite,
  changeMemberRoleAndOutlets,
  createInvite,
  createLegalEntity,
  createOutlet,
  createTenant,
  getTenantAuthMetadataBySlug,
  issueResetCode,
  listPendingInvites,
  listRolesWithPermissions,
  redeemInvite,
  reissueInvite,
  removeMember,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { closePools } from '~/server/db'
import { uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-guards@example.test' }

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
  return { tenantId: created.tenantId, slug, authOrgId: meta!.authOrgId, actor }
}

type Boot = Awaited<ReturnType<typeof bootstrapTenant>>

async function setup(prefix: string) {
  const t = await bootstrapTenant(uniqueSlug(prefix))
  const le = await createLegalEntity(t.actor, { name: 'PT Guards', isPkp: false })
  const out01 = await createOutlet(t.actor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  const out02 = await createOutlet(t.actor, {
    legalEntityId: le.id,
    code: 'OUT02',
    name: 'Outlet 02',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  const roles = await listRolesWithPermissions(t.actor)
  return {
    t,
    out01,
    out02,
    ownerRole: roles.find((r) => r.code === 'OWNER')!,
    managerRole: roles.find((r) => r.code === 'MANAGER')!,
    cashierRole: roles.find((r) => r.code === 'CASHIER')!,
  }
}

async function addMember(
  t: Boot,
  roleId: string,
  outletIds: string[] | null,
  label: string,
): Promise<{ appUserId: string; email: string }> {
  const email = `${label}-${uniqueSlug('g')}@example.test`
  const invite = await createInvite(t.actor, {
    email,
    displayName: `${label} ${uniqueSlug('n')}`,
    roleId,
    outletIds,
  })
  await redeemInvite({
    tenantId: t.tenantId,
    tenantSlug: t.slug,
    authOrgId: t.authOrgId,
    email,
    code: invite.code,
    password: 'MemberPassword123!',
  })
  return { appUserId: invite.appUserId, email }
}

describe('member action guards (invite lifecycle, reset, remove) and one role per member', () => {
  afterAll(async () => {
    await closePools()
  })

  it('lets a scoped Manager act only inside its own outlets and never above its own rights', async () => {
    const { t, out01, out02, ownerRole, managerRole, cashierRole } = await setup('mgrd')

    const manager = await addMember(t, managerRole.id, [out01.id], 'mgr')
    const managerActor: IdentityAuthActor = {
      tenantId: t.tenantId,
      tenantSlug: t.slug,
      authOrgId: t.authOrgId,
      appUserId: manager.appUserId,
      permissions: new Set(managerRole.permissions),
      outletIds: [out01.id],
      roleCodes: ['MANAGER'],
    }
    expect(managerActor.permissions.has('user.invite')).toBe(true)
    expect(managerActor.permissions.has('user.remove')).toBe(true)
    expect(managerActor.permissions.has('user.reset_password')).toBe(true)

    const staff1 = await addMember(t, cashierRole.id, [out01.id], 'c1')
    const staff2 = await addMember(t, cashierRole.id, [out02.id], 'c2')
    const wideStaff = await addMember(t, cashierRole.id, null, 'cw')

    // Invite: only inside own outlets, never tenant-wide, never a role above own rights.
    const invite = (outletIds: string[] | null, roleId: string = cashierRole.id) =>
      createInvite(managerActor, {
        email: `inv-${uniqueSlug('i')}@example.test`,
        displayName: `Inv ${uniqueSlug('d')}`,
        roleId,
        outletIds,
      })
    await expect(invite(null)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(invite([out02.id])).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(invite([out01.id, out02.id])).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(invite([out01.id], ownerRole.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const okInvite = await invite([out01.id])
    expect(okInvite.appUserId).toBeTruthy()

    // Pending invitations: the list is limited to own outlets, and foreign invites cannot be cancelled or reissued.
    const foreignPending = await createInvite(t.actor, {
      email: `p2-${uniqueSlug('p')}@example.test`,
      displayName: `P2 ${uniqueSlug('q')}`,
      roleId: cashierRole.id,
      outletIds: [out02.id],
    })
    const pendingIds = (await listPendingInvites(managerActor)).map((p) => p.id)
    expect(pendingIds).toContain(okInvite.appUserId)
    expect(pendingIds).not.toContain(foreignPending.appUserId)
    await expect(cancelInvite(managerActor, foreignPending.appUserId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(reissueInvite(managerActor, foreignPending.appUserId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await cancelInvite(managerActor, okInvite.appUserId)

    // Password reset: own outlet only; never another outlet, a tenant-wide member, or the Owner.
    const reset = await issueResetCode(managerActor, staff1.appUserId)
    expect(reset.code).toBeTruthy()
    await expect(issueResetCode(managerActor, staff2.appUserId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(issueResetCode(managerActor, wideStaff.appUserId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(issueResetCode(managerActor, t.actor.appUserId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    // Removal: same boundaries.
    await expect(removeMember(managerActor, staff2.appUserId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(removeMember(managerActor, wideStaff.appUserId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(removeMember(managerActor, t.actor.appUserId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await removeMember(managerActor, staff1.appUserId)

    // A tenant-wide Manager still cannot reset or remove the Owner.
    const wideManager = await addMember(t, managerRole.id, null, 'wm')
    const wideManagerActor: IdentityAuthActor = {
      ...managerActor,
      appUserId: wideManager.appUserId,
      outletIds: null,
    }
    await expect(removeMember(wideManagerActor, t.actor.appUserId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(issueResetCode(wideManagerActor, t.actor.appUserId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects mixed roles and mixed tenant-wide/outlet assignments in one access change', async () => {
    const { t, out01, out02, managerRole, cashierRole } = await setup('onerole')
    const member = await addMember(t, cashierRole.id, [out01.id], 'sr')

    await expect(
      changeMemberRoleAndOutlets(t.actor, {
        appUserId: member.appUserId,
        assignments: [
          { outletId: out01.id, roleId: cashierRole.id },
          { outletId: out02.id, roleId: managerRole.id },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'admin.users.editAccess.singleRole',
    })

    await expect(
      changeMemberRoleAndOutlets(t.actor, {
        appUserId: member.appUserId,
        assignments: [
          { outletId: null, roleId: cashierRole.id },
          { outletId: out01.id, roleId: cashierRole.id },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'admin.users.editAccess.singleScope',
    })

    const updated = await changeMemberRoleAndOutlets(t.actor, {
      appUserId: member.appUserId,
      assignments: [
        { outletId: out01.id, roleId: cashierRole.id },
        { outletId: out02.id, roleId: cashierRole.id },
      ],
    })
    expect(updated.assignments).toHaveLength(2)
  })
})
