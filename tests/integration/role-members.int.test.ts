import { afterAll, describe, expect, it } from 'vitest'
import {
  cancelInvite,
  createInvite,
  createLegalEntity,
  createOutlet,
  createRole,
  listRoleMembers,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import type { PermissionCode } from '~/modules/identity/shared'
import { closePools } from '~/server/db'
import { bootstrapIdentityTenant } from './helpers/identity-actor'
import { uniqueSlug } from './helpers/tenants'

describe('listRoleMembers', () => {
  afterAll(async () => {
    await closePools()
  })

  it('lists distinct member names of one role, limited to the actor outlet scope', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('rmem'))
    const custom = await createRole(t.actor, {
      name: 'Dapur',
      discountLimitPct: 0,
      permissions: ['bill.edit'],
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
    const invite = (displayName: string, outletIds: string[]) =>
      createInvite(t.actor, {
        email: `${displayName.split(' ')[0]!.toLowerCase()}-${uniqueSlug('m')}@example.test`,
        displayName,
        roleId: custom.id,
        outletIds,
      })
    await invite('Budi Dapur', [out01.id])
    const ani = await invite('Ani Dapur', [out02.id])
    await invite('Citra Dapur', [out01.id, out02.id])

    const names = async (actor: IdentityAuthActor) =>
      (await listRoleMembers(actor, { roleId: custom.id })).map((m) => m.displayName)

    // Tenant-wide actor: every member once, ordered by name (Citra holds two assignments).
    expect(await names(t.actor)).toEqual(['Ani Dapur', 'Budi Dapur', 'Citra Dapur'])
    // Scoped actor: only members holding the role at one of the actor outlets.
    expect(await names({ ...t.actor, outletIds: [out01.id] })).toEqual(['Budi Dapur', 'Citra Dapur'])
    // Empty scope fails closed.
    expect(await names({ ...t.actor, outletIds: [] })).toEqual([])

    await cancelInvite(t.actor, ani.appUserId)
    expect(await names(t.actor)).toEqual(['Budi Dapur', 'Citra Dapur'])
  })

  it('requires user.manage and a valid role id', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('rmem'))
    const noAccess: IdentityAuthActor = {
      ...t.actor,
      permissions: new Set<PermissionCode>(['role.manage']),
    }
    await expect(listRoleMembers(noAccess, { roleId: crypto.randomUUID() })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(listRoleMembers(t.actor, { roleId: 'not-a-uuid' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
  })
})
