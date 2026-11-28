import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import {
  cancelInvite,
  changeMemberRoleAndOutlets,
  createInvite,
  createLegalEntity,
  createOutlet,
  createRole,
  deleteRole,
  duplicateRole,
  listRolesWithPermissions,
  updateRole,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { ROLE_DEFAULTS, type PermissionCode } from '~/modules/identity/shared'
import { closePools, withTenantReadOnly } from '~/server/db'
import { bootstrapIdentityTenant } from './helpers/identity-actor'
import { uniqueSlug } from './helpers/tenants'

type Boot = Awaited<ReturnType<typeof bootstrapIdentityTenant>>

async function roleByCode(t: Boot, code: string) {
  const found = (await listRolesWithPermissions(t.actor)).find((r) => r.code === code)
  if (!found) {
    throw new Error(`role ${code} not found`)
  }
  return found
}

/** Audit actions recorded for roles in this tenant, oldest first. */
async function auditActions(tenantId: string): Promise<string[]> {
  return withTenantReadOnly(tenantId, async (tx) => {
    const res = await tx.execute(
      sql`SELECT action FROM audit_log WHERE entity_type = 'role' ORDER BY chain_seq`,
    )
    return res.rows.map((r) => String((r as { action: unknown }).action))
  })
}

/** Invites a real MANAGER member (so the actor exists in the database) and builds its actor object. */
async function managerActorFor(t: Boot): Promise<IdentityAuthActor> {
  const manager = await roleByCode(t, 'MANAGER')
  const invite = await createInvite(t.actor, {
    email: `mgr-${uniqueSlug('m')}@example.test`,
    displayName: `Manager ${uniqueSlug('n')}`,
    roleId: manager.id,
    outletIds: null,
  })
  return {
    tenantId: t.tenantId,
    tenantSlug: t.slug,
    authOrgId: t.authOrgId,
    appUserId: invite.appUserId,
    // MANAGER no longer holds role.manage by default; grant it here to exercise the escalation guards.
    permissions: new Set<PermissionCode>([...manager.permissions, 'role.manage']),
    outletIds: null,
    roleCodes: ['MANAGER'],
  }
}

describe('role CRUD (create, duplicate, update, delete, escalation guards, audit)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('creates custom roles with generated codes, rejects bad input, and audits creation', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('rcrud'))

    const created = await createRole(t.actor, {
      name: 'Kepala Dapur',
      discountLimitPct: 10,
      permissions: ['report.view', 'bill.edit'],
    })
    expect(created).toMatchObject({
      code: 'KEPALA_DAPUR',
      name: 'Kepala Dapur',
      isSystem: false,
      discountLimitPct: 10,
      memberCount: 0,
    })
    expect(created.permissions).toEqual(['bill.edit', 'report.view'])

    await expect(
      createRole(t.actor, { name: 'kepala dapur', discountLimitPct: 0, permissions: ['bill.edit'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: 'admin.users.role.nameTaken' })
    await expect(
      createRole(t.actor, { name: 'Tanpa Izin', discountLimitPct: 0, permissions: [] }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'admin.users.role.permissionsRequired',
    })

    const second = await createRole(t.actor, {
      name: 'Kepala  Dapur!',
      discountLimitPct: 0,
      permissions: ['bill.edit'],
    })
    expect(second.code).toBe('KEPALA_DAPUR_A')

    const listed = await listRolesWithPermissions(t.actor)
    expect(listed).toHaveLength(ROLE_DEFAULTS.length + 2)

    const actions = await auditActions(t.tenantId)
    expect(actions.filter((a) => a === 'role.created')).toHaveLength(2)
  })

  it('uses optimistic locking and bumps the role version on permission-only changes', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('rver'))
    const created = await createRole(t.actor, {
      name: 'Kasir Senior',
      discountLimitPct: 5,
      permissions: ['sale.create'],
    })

    const renamed = await updateRole(t.actor, {
      roleId: created.id,
      expectedVersion: created.version,
      name: 'Kasir Utama',
    })
    expect(renamed.name).toBe('Kasir Utama')
    expect(renamed.code).toBe('KASIR_SENIOR')
    expect(renamed.version).toBeGreaterThan(created.version)

    await expect(
      updateRole(t.actor, {
        roleId: created.id,
        expectedVersion: created.version,
        name: 'Kasir Lama',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'admin.users.role.versionConflict',
    })

    const withPermission = await updateRole(t.actor, {
      roleId: created.id,
      expectedVersion: renamed.version,
      permissions: ['sale.create', 'report.view'],
    })
    expect(withPermission.version).toBeGreaterThan(renamed.version)
    expect(withPermission.permissions).toEqual(['report.view', 'sale.create'])

    const unchanged = await updateRole(t.actor, {
      roleId: created.id,
      expectedVersion: withPermission.version,
      name: 'Kasir Utama',
    })
    expect(unchanged.version).toBe(withPermission.version)

    await expect(
      updateRole(t.actor, {
        roleId: created.id,
        expectedVersion: withPermission.version,
        name: 'cashier',
      }),
    ).rejects.toMatchObject({ message: 'admin.users.role.nameTaken' })

    const actions = await auditActions(t.tenantId)
    expect(actions).toContain('role.changed')
    expect(actions).toContain('permission.changed')
  })

  it('locks the OWNER role completely and protects system roles from deletion', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('rown'))
    const owner = await roleByCode(t, 'OWNER')
    const cashier = await roleByCode(t, 'CASHIER')

    await expect(
      updateRole(t.actor, {
        roleId: owner.id,
        expectedVersion: owner.version,
        discountLimitPct: 50,
      }),
    ).rejects.toMatchObject({ message: 'admin.users.role.ownerLocked' })
    await expect(
      updateRole(t.actor, { roleId: owner.id, expectedVersion: owner.version, name: 'Pemilik' }),
    ).rejects.toMatchObject({ message: 'admin.users.role.ownerLocked' })
    await expect(
      updateRole(t.actor, {
        roleId: owner.id,
        expectedVersion: owner.version,
        permissions: ['sale.create'],
      }),
    ).rejects.toMatchObject({ message: 'admin.users.role.ownerPermissionsLocked' })
    await expect(
      deleteRole(t.actor, { roleId: owner.id, expectedVersion: owner.version }),
    ).rejects.toMatchObject({ message: 'admin.users.role.ownerLocked' })

    await expect(
      deleteRole(t.actor, { roleId: cashier.id, expectedVersion: cashier.version }),
    ).rejects.toMatchObject({ message: 'admin.users.role.systemUndeletable' })

    const renamed = await updateRole(t.actor, {
      roleId: cashier.id,
      expectedVersion: cashier.version,
      name: 'Kasir',
    })
    expect(renamed.name).toBe('Kasir')
    expect(renamed.code).toBe('CASHIER')
  })

  it('blocks deleting a role that is still in use and deletes it once it is free', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('rdel'))
    const custom = await createRole(t.actor, {
      name: 'Shift Lead',
      discountLimitPct: 0,
      permissions: ['bill.edit'],
    })
    const invite = await createInvite(t.actor, {
      email: `lead-${uniqueSlug('l')}@example.test`,
      displayName: `Lead ${uniqueSlug('n')}`,
      roleId: custom.id,
      outletIds: null,
    })

    const inUse = (await listRolesWithPermissions(t.actor)).find((r) => r.id === custom.id)!
    expect(inUse.memberCount).toBe(1)
    await expect(
      deleteRole(t.actor, { roleId: custom.id, expectedVersion: inUse.version }),
    ).rejects.toMatchObject({ message: 'admin.users.role.inUse' })

    await cancelInvite(t.actor, invite.appUserId)
    const deleted = await deleteRole(t.actor, { roleId: custom.id, expectedVersion: inUse.version })
    expect(deleted).toEqual({ id: custom.id })
    expect((await listRolesWithPermissions(t.actor)).some((r) => r.id === custom.id)).toBe(false)

    const again = await createRole(t.actor, {
      name: 'Shift Lead',
      discountLimitPct: 0,
      permissions: ['bill.edit'],
    })
    expect(again.code).toBe('SHIFT_LEAD')

    const actions = await auditActions(t.tenantId)
    expect(actions).toContain('role.deleted')
  })

  it('requires role.manage with tenant-wide access for mutations and user.manage or role.manage to list', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('racl'))
    const cashier = await roleByCode(t, 'CASHIER')
    const input = { name: 'Percobaan', discountLimitPct: 0, permissions: ['bill.edit' as const] }

    const noManage: IdentityAuthActor = {
      ...t.actor,
      permissions: new Set<PermissionCode>(['user.manage']),
    }
    await expect(createRole(noManage, input)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      updateRole(noManage, { roleId: cashier.id, expectedVersion: cashier.version, name: 'X' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      deleteRole(noManage, { roleId: cashier.id, expectedVersion: cashier.version }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      duplicateRole(noManage, { sourceRoleId: cashier.id, name: 'Salinan' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await listRolesWithPermissions(noManage)).length).toBeGreaterThan(0)

    const scoped: IdentityAuthActor = { ...t.actor, outletIds: ['00000000-0000-7000-8000-000000000001'] }
    await expect(createRole(scoped, input)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const nobody: IdentityAuthActor = { ...t.actor, permissions: new Set<PermissionCode>() }
    await expect(listRolesWithPermissions(nobody)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('prevents a Manager from escalating privileges through create, update, and duplicate', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('resc'))
    const manager = await managerActorFor(t)
    const managerRole = await roleByCode(t, 'MANAGER')
    const owner = await roleByCode(t, 'OWNER')

    await expect(
      createRole(manager, { name: 'Flag Admin', discountLimitPct: 0, permissions: ['flag.manage'] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      createRole(manager, { name: 'Big Discount', discountLimitPct: 60, permissions: ['bill.edit'] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const within = await createRole(manager, {
      name: 'Dapur',
      discountLimitPct: 10,
      permissions: ['bill.edit'],
    })
    expect(within.code).toBe('DAPUR')

    await expect(
      updateRole(manager, {
        roleId: managerRole.id,
        expectedVersion: managerRole.version,
        discountLimitPct: 40,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await expect(
      duplicateRole(manager, { sourceRoleId: owner.id, name: 'Owner Copy' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Created by the Owner with a permission the Manager does not hold (flag.manage).
    const mixed = await createRole(t.actor, {
      name: 'Campuran',
      discountLimitPct: 0,
      permissions: ['bill.edit', 'flag.manage'],
    })
    await expect(
      updateRole(manager, {
        roleId: mixed.id,
        expectedVersion: mixed.version,
        permissions: ['bill.edit', 'report.view'],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const edited = await updateRole(manager, {
      roleId: mixed.id,
      expectedVersion: mixed.version,
      permissions: ['bill.edit', 'flag.manage', 'report.view'],
    })
    expect(edited.permissions).toContain('report.view')
    expect(edited.permissions).toContain('flag.manage')

    const copy = await duplicateRole(manager, { sourceRoleId: within.id, name: 'Dapur Salinan' })
    expect(copy.permissions).toEqual(within.permissions)
    expect(copy.discountLimitPct).toBe(within.discountLimitPct)
    await expect(
      duplicateRole(manager, { sourceRoleId: mixed.id, name: 'Campuran Salinan' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('blocks assigning or inviting members into roles that exceed the actor', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('rasg'))
    const manager = await managerActorFor(t)
    const waiter = await roleByCode(t, 'WAITER')
    const flagRole = await createRole(t.actor, {
      name: 'Flag Admin',
      discountLimitPct: 0,
      permissions: ['flag.manage'],
    })
    const target = await createInvite(t.actor, {
      email: `target-${uniqueSlug('t')}@example.test`,
      displayName: `Target ${uniqueSlug('n')}`,
      roleId: waiter.id,
      outletIds: null,
    })

    await expect(
      changeMemberRoleAndOutlets(manager, {
        appUserId: target.appUserId,
        assignments: [{ outletId: null, roleId: flagRole.id }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Manager holds user.invite by default, so the role guard is what must reject this invite.
    const inviter: IdentityAuthActor = manager
    await expect(
      createInvite(inviter, {
        email: `blocked-${uniqueSlug('b')}@example.test`,
        displayName: `Blocked ${uniqueSlug('n')}`,
        roleId: flagRole.id,
        outletIds: null,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('only checks newly granted (outlet, role) pairs: an existing stronger role may stay, but not be granted again', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('rpair'))
    const manager = await managerActorFor(t)
    const waiter = await roleByCode(t, 'WAITER')
    const flagRole = await createRole(t.actor, {
      name: 'Flag Admin',
      discountLimitPct: 0,
      permissions: ['flag.manage'],
    })
    const entity = await createLegalEntity(t.actor, { name: 'PT Uji', isPkp: false })
    const outletInput = {
      legalEntityId: entity.id,
      timezone: 'Asia/Jakarta' as const,
      dayCutoffTime: '00:00',
      priceTaxMode: 'INCLUSIVE' as const,
    }
    const out01 = await createOutlet(t.actor, { ...outletInput, code: 'OUT01', name: 'Outlet 01' })
    const out02 = await createOutlet(t.actor, { ...outletInput, code: 'OUT02', name: 'Outlet 02' })
    const target = await createInvite(t.actor, {
      email: `pair-${uniqueSlug('p')}@example.test`,
      displayName: `Pair ${uniqueSlug('n')}`,
      roleId: flagRole.id,
      outletIds: [out01.id],
    })

    // The (OUT02, Flag Admin) pair is new and exceeds the Manager.
    await expect(
      changeMemberRoleAndOutlets(manager, {
        appUserId: target.appUserId,
        assignments: [
          { outletId: out01.id, roleId: flagRole.id },
          { outletId: out02.id, roleId: flagRole.id },
        ],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // One role per member: a different role per outlet is rejected before any role check runs.
    await expect(
      changeMemberRoleAndOutlets(manager, {
        appUserId: target.appUserId,
        assignments: [
          { outletId: out01.id, roleId: flagRole.id },
          { outletId: out02.id, roleId: waiter.id },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'admin.users.editAccess.singleRole',
    })

    // (OUT01, Flag Admin) is unchanged, so the Manager may keep it even though it exceeds its own rights.
    const updated = await changeMemberRoleAndOutlets(manager, {
      appUserId: target.appUserId,
      assignments: [{ outletId: out01.id, roleId: flagRole.id }],
    })
    expect(updated.assignments.map((a) => `${a.outletCode}:${a.roleCode}`)).toEqual([
      'OUT01:FLAG_ADMIN',
    ])
  })

  it('marks the roles held by the signed-in member', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('rheld'))
    const manager = await managerActorFor(t)

    const asManager = await listRolesWithPermissions(manager)
    expect(asManager.filter((r) => r.heldByActor).map((r) => r.code)).toEqual(['MANAGER'])

    const asOwner = await listRolesWithPermissions(t.actor)
    expect(asOwner.filter((r) => r.heldByActor).map((r) => r.code)).toEqual(['OWNER'])
  })
})
