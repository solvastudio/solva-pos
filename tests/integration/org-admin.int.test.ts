import { webcrypto } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import {
  createLegalEntity,
  createOutlet,
  createTenant,
  getTenantAuthMetadataBySlug,
  listLegalEntities,
  listOutlets,
  redeemInvite,
  updateLegalEntity,
  updateOutlet,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { AppError } from '~/server/error-classify'
import { closePools } from '~/server/db'
import { ownerClient, withClient } from './helpers/db'
import { uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-org@example.test' }

async function setupActiveOwnerActor(slug: string, name: string): Promise<{
  tenantId: string
  authOrgId: string
  actor: IdentityAuthActor
}> {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name,
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
  return {
    tenantId: created.tenantId,
    authOrgId: meta!.authOrgId,
    actor: {
      tenantId: created.tenantId,
      tenantSlug: slug,
      authOrgId: meta!.authOrgId,
      appUserId: created.ownerInvite.appUserId,
      permissions: new Set(PERMISSION_CODES),
      outletIds: null,
      roleCodes: ['OWNER'],
    },
  }
}

describe('org-admin integration (legal entities, outlets, scopes, tenant isolation)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('enforces NPWP/PKP rules, required priceTaxMode, and single writeMaster version for outlet + receipt setting', async () => {
    const t = await setupActiveOwnerActor(uniqueSlug('org1'), 'Org One')

    // isPkp without NPWP is rejected.
    await expect(
      createLegalEntity(t.actor, { name: 'PT Gagal', isPkp: true, npwp: null }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    // 15-digit and 16-digit NPWPs are accepted (punctuation stripped).
    const nonPkp = await createLegalEntity(t.actor, {
      name: 'PT Non PKP',
      npwp: '01.234.567.8-901.234',
      isPkp: false,
    })
    expect(nonPkp.npwp).toBe('012345678901234')

    // Duplicate NPWP rejected.
    await expect(
      createLegalEntity(t.actor, {
        name: 'PT Dup NPWP',
        npwp: '012345678901234',
        isPkp: false,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: 'admin.settings.legalEntity.npwpTaken' })

    const pkp = await createLegalEntity(t.actor, {
      name: 'PT PKP Jaya',
      npwp: '1234567890123456',
      isPkp: true,
      pkpSince: '2026-01-01',
    })
    expect(pkp.npwp).toBe('1234567890123456')

    // Outlet with PPN under non-PKP entity is rejected.
    await expect(
      createOutlet(t.actor, {
        legalEntityId: nonPkp.id,
        code: 'OUT01',
        name: 'Outlet Satu',
        timezone: 'Asia/Jakarta',
        dayCutoffTime: '00:00',
        priceTaxMode: 'INCLUSIVE',
        taxProfile: 'PPN',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'admin.settings.outlet.ppnRequiresPkp',
    })

    // Missing priceTaxMode is rejected (no default).
    await expect(
      createOutlet(t.actor, {
        legalEntityId: pkp.id,
        code: 'OUT01',
        name: 'Outlet Satu',
        timezone: 'Asia/Jakarta',
        dayCutoffTime: '00:00',
        priceTaxMode: undefined as unknown as 'INCLUSIVE',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    const out01 = await createOutlet(t.actor, {
      legalEntityId: pkp.id,
      code: 'OUT01',
      name: 'Outlet Satu',
      timezone: 'Asia/Jakarta',
      dayCutoffTime: '04:00',
      priceTaxMode: 'INCLUSIVE',
      taxProfile: 'PPN',
    })

    // Duplicate outlet code rejected.
    await expect(
      createOutlet(t.actor, {
        legalEntityId: pkp.id,
        code: 'OUT01',
        name: 'Outlet Duplikat',
        timezone: 'Asia/Jakarta',
        dayCutoffTime: '00:00',
        priceTaxMode: 'EXCLUSIVE',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'admin.settings.outlet.codeTaken',
    })

    // Single writeMaster version stamped on both outlet and outlet_receipt_setting.
    await withClient(ownerClient, async (client) => {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [t.tenantId])
      const res = await client.query(
        `SELECT o.version AS o_ver, r.version AS r_ver, r.receipt_locale
           FROM outlet o
           JOIN outlet_receipt_setting r ON r.tenant_id = o.tenant_id AND r.outlet_id = o.id
          WHERE o.id = $1`,
        [out01.id],
      )
      await client.query('COMMIT')
      expect(res.rows[0].o_ver).toBe(res.rows[0].r_ver)
      expect(Number(res.rows[0].o_ver)).toBe(out01.version)
      expect(res.rows[0].receipt_locale).toBe('id-ID')
    })

    // Cannot disable PKP while an outlet uses PPN.
    await expect(
      updateLegalEntity(t.actor, {
        id: pkp.id,
        name: pkp.name,
        npwp: pkp.npwp,
        isPkp: false,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'admin.settings.legalEntity.pkpInUseByPpnOutlet',
    })
  })

  it('enforces Manager per-outlet scope and tenant isolation', async () => {
    const tA = await setupActiveOwnerActor(uniqueSlug('orga'), 'Tenant A')
    const tB = await setupActiveOwnerActor(uniqueSlug('orgb'), 'Tenant B')

    const entA = await createLegalEntity(tA.actor, {
      name: 'Ent A',
      npwp: '111111111111111',
      isPkp: true,
    })
    const out01 = await createOutlet(tA.actor, {
      legalEntityId: entA.id,
      code: 'OUT01',
      name: 'Outlet 01',
      timezone: 'Asia/Jakarta',
      dayCutoffTime: '00:00',
      priceTaxMode: 'INCLUSIVE',
    })
    const out02 = await createOutlet(tA.actor, {
      legalEntityId: entA.id,
      code: 'OUT02',
      name: 'Outlet 02',
      timezone: 'Asia/Makassar',
      dayCutoffTime: '00:00',
      priceTaxMode: 'EXCLUSIVE',
    })

    const managerActor: IdentityAuthActor = {
      ...tA.actor,
      permissions: new Set(['user.manage']),
      outletIds: [out01.id],
      roleCodes: ['MANAGER'],
    }

    // Scoped list shows only OUT01.
    const mgrOutlets = await listOutlets(managerActor)
    expect(mgrOutlets.map((o) => o.code)).toEqual(['OUT01'])

    // Manager can update OUT01, cannot mutate its code.
    const updated01 = await updateOutlet(managerActor, {
      id: out01.id,
      name: 'Outlet 01 Renamed',
      dayCutoffTime: '05:00',
    })
    expect(updated01.name).toBe('Outlet 01 Renamed')
    await expect(
      updateOutlet(managerActor, { id: out01.id, code: 'OUT99' }),
    ).rejects.toBeInstanceOf(AppError)

    // Manager cannot update OUT02, create outlet, or create legal entity.
    await expect(
      updateOutlet(managerActor, { id: out02.id, name: 'No Access' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      createOutlet(managerActor, {
        legalEntityId: entA.id,
        code: 'OUT03',
        name: 'No Create',
        timezone: 'Asia/Jakarta',
        dayCutoffTime: '00:00',
        priceTaxMode: 'INCLUSIVE',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      createLegalEntity(managerActor, { name: 'Forbidden Ent', isPkp: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Tenant B cannot see or mutate Tenant A entities/outlets.
    expect(await listLegalEntities(tB.actor)).toEqual([])
    await expect(
      updateOutlet(tB.actor, { id: out01.id, name: 'Cross Tenant' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})
