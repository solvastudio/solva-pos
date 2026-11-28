import { afterAll, describe, expect, it } from 'vitest'
import {
  changeMemberRoleAndOutlets,
  createInvite,
  createLegalEntity,
  createOutlet,
  listRolesWithPermissions,
} from '~/modules/identity/public'
import { closePools } from '~/server/db'
import { bootstrapIdentityTenant } from './helpers/identity-actor'
import { uniqueSlug } from './helpers/tenants'

describe('changeMemberRoleAndOutlets batching', () => {
  afterAll(async () => {
    await closePools()
  })

  it('removes, reassigns, and adds assignments in one change', async () => {
    const t = await bootstrapIdentityTenant(uniqueSlug('rbatch'))
    const roles = await listRolesWithPermissions(t.actor)
    const waiter = roles.find((r) => r.code === 'WAITER')!
    const cashier = roles.find((r) => r.code === 'CASHIER')!
    const entity = await createLegalEntity(t.actor, { name: 'PT Uji', isPkp: false })
    const outletInput = {
      legalEntityId: entity.id,
      timezone: 'Asia/Jakarta' as const,
      dayCutoffTime: '00:00',
      priceTaxMode: 'INCLUSIVE' as const,
    }
    const out01 = await createOutlet(t.actor, { ...outletInput, code: 'OUT01', name: 'Outlet 01' })
    const out02 = await createOutlet(t.actor, { ...outletInput, code: 'OUT02', name: 'Outlet 02' })
    const out03 = await createOutlet(t.actor, { ...outletInput, code: 'OUT03', name: 'Outlet 03' })
    const invite = await createInvite(t.actor, {
      email: `batch-${uniqueSlug('b')}@example.test`,
      displayName: `Batch ${uniqueSlug('n')}`,
      roleId: waiter.id,
      outletIds: [out01.id, out02.id],
    })

    // One role per member: OUT01 is reassigned Waiter -> Cashier, OUT02 is removed, OUT03 is added as Cashier.
    const updated = await changeMemberRoleAndOutlets(t.actor, {
      appUserId: invite.appUserId,
      assignments: [
        { outletId: out01.id, roleId: cashier.id },
        { outletId: out03.id, roleId: cashier.id },
      ],
    })

    expect(updated.assignments.map((a) => `${a.outletCode}:${a.roleCode}`).sort()).toEqual([
      'OUT01:CASHIER',
      'OUT03:CASHIER',
    ])
    expect(updated.displayName).toContain('Batch')
    expect(updated.membershipStatus).toBe('PENDING')
  })
})
