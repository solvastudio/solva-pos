import { webcrypto } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import {
  changeInvoicePrefix,
  createLegalEntity,
  createOutlet,
  createRegister,
  createTenant,
  getTenantAuthMetadataBySlug,
  listRegisters,
  redeemInvite,
  updateRegister,
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

const testOp = { platformUserId: testIdGen.newId(), email: 'op-reg@example.test' }

async function setupTenantWithTwoOutlets(slug: string) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Reg ${slug}`,
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

  const le = await createLegalEntity(actor, {
    name: 'PT Register',
    isPkp: false,
  })
  const out01 = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  const out02 = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT02',
    name: 'Outlet 02',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  return { actor, out01, out02 }
}

describe('register-prefix integration (CASHIER/WAITER, uniqueness, next-month V-29 scheduling)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('validates CASHIER/WAITER prefix rules, tenant-wide uniqueness, next-month prefix rollover (V-29), and scope', async () => {
    const { actor, out01, out02 } = await setupTenantWithTwoOutlets(uniqueSlug('reg'))
    const novClock = () => '2026-11-20T05:00:00.000Z'

    // CASHIER without prefix rejected; WAITER with prefix rejected.
    await expect(
      createRegister(actor, {
        outletId: out01.id,
        code: 'POS01',
        name: 'Cashier 1',
        registerType: 'CASHIER',
        invoicePrefix: null,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    await expect(
      createRegister(actor, {
        outletId: out01.id,
        code: 'WTR01',
        name: 'Waiter 1',
        registerType: 'WAITER',
        invoicePrefix: 'OUT01-W1',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    // Invalid prefix shapes rejected.
    for (const bad of ['OUT01-NK', '-AB', 'A--B', 'a']) {
      await expect(
        createRegister(actor, {
          outletId: out01.id,
          code: 'POS01',
          name: 'Cashier 1',
          registerType: 'CASHIER',
          invoicePrefix: bad,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    }

    const pos01 = await createRegister(
      actor,
      {
        outletId: out01.id,
        code: 'POS01',
        name: 'Cashier 1',
        registerType: 'CASHIER',
        invoicePrefix: 'OUT01-POS01',
      },
      { nowIso: novClock },
    )
    expect(pos01.currentPrefix).toBe('OUT01-POS01')
    expect(pos01.prefixHistory[0]?.effectiveMonth).toBe('2026-11-01')

    const waiter01 = await createRegister(actor, {
      outletId: out01.id,
      code: 'WTR01',
      name: 'Waiter 1',
      registerType: 'WAITER',
      paperWidthMm: 58,
    })
    expect(waiter01.currentPrefix).toBeNull()

    // Cross-register prefix collision rejected (even across outlets in the same tenant).
    await expect(
      createRegister(actor, {
        outletId: out02.id,
        code: 'POS01',
        name: 'Cashier Out 2',
        registerType: 'CASHIER',
        invoicePrefix: 'OUT01-POS01',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'admin.users.register.prefixTaken',
    })

    // V-29: Changing prefix on Nov 20 schedules KSR2 for Dec 1; historical OUT01-POS01 stays reserved.
    const scheduled = await changeInvoicePrefix(
      actor,
      { registerId: pos01.id, newPrefix: 'KSR2' },
      { nowIso: novClock },
    )
    expect(scheduled.currentPrefix).toBe('OUT01-POS01')
    expect(scheduled.pendingNextPrefix).toMatchObject({
      effectiveMonth: '2026-12-01',
      invoicePrefix: 'KSR2',
    })

    // Old prefix still owned by pos01, so another register cannot claim OUT01-POS01 or KSR2.
    await expect(
      createRegister(actor, {
        outletId: out02.id,
        code: 'POS02',
        name: 'Other Cashier',
        registerType: 'CASHIER',
        invoicePrefix: 'OUT01-POS01',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'admin.users.register.prefixTaken',
    })

    // Same register CAN reuse its own previous prefix.
    const reverted = await changeInvoicePrefix(
      actor,
      { registerId: pos01.id, newPrefix: 'OUT01-POS01' },
      { nowIso: novClock },
    )
    expect(reverted.pendingNextPrefix?.invoicePrefix).toBe('OUT01-POS01')

    // updateRegister rejects registerType or code changes.
    await expect(
      updateRegister(actor, { id: pos01.id, registerType: 'WAITER' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'admin.users.register.typeLocked',
    })

    // Scoped Manager for OUT01 cannot create/list registers in OUT02.
    const managerActor: IdentityAuthActor = {
      ...actor,
      permissions: new Set(['user.manage']),
      outletIds: [out01.id],
      roleCodes: ['MANAGER'],
    }
    const mgrRegs = await listRegisters(managerActor, { nowIso: novClock })
    expect(mgrRegs.every((r) => r.outletId === out01.id)).toBe(true)

    await expect(
      createRegister(managerActor, {
        outletId: out02.id,
        code: 'POS09',
        name: 'Forbidden',
        registerType: 'CASHIER',
        invoicePrefix: 'OUT02-POS09',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
