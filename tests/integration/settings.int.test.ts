import { webcrypto } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createIdGenerator } from '~/lib/kernel'
import { selectTaxRate } from '~/lib/sales-calc'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
  addTaxRate,
  createLegalEntity,
  createOutlet,
  createPairingCode,
  createRegister,
  createTenant,
  enrollDevice,
  getOutletFullSettings,
  savePaymentMethod,
  updateOutletTaxSettings,
  uploadOutletLogo,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { handleGetOutletLogo } from '~/routes/api/pos/v1/assets.logo.$outletId'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { __resetPushLimitsForTests } from '~/server/auth/rate-limit/push-limits'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenantReadOnly } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
import { uniqueSlug } from './helpers/tenants'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: idGen.newId(), email: 'op-settings@example.test' }
const tempDirs: string[] = []

function pngBytes(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24, 0)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  buf.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

function jpegBytes(width: number, height: number): Buffer {
  const buf = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x40, 0x00, 0x40, 0x03, 0x01, 0x11, 0x00, 0xff,
    0xd9,
  ])
  buf.writeUInt16BE(height, 7)
  buf.writeUInt16BE(width, 9)
  return buf
}

beforeEach(() => {
  resetEnvForTests()
  __clearTenantCacheForTests()
  __clearDeviceAuthCacheForTests()
  resetLimitersForTests()
  __resetPushLimitsForTests()
  resetCompositionForTests()
  composeServer()
})

afterAll(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true })
  }
  await closePools()
})

describe('admin full outlet settings (tax, tax_rate_history, logo upload, payment methods)', () => {
  it('enforces PKP for PPN, future effectiveFrom for tax rates, magic-byte/size logo rules + GET logo, and single active CASH method', async () => {
    const slug = uniqueSlug('set')
    const ownerEmail = `owner-${slug}@example.test`
    const created = await createTenant(testOp, {
      name: `Set ${slug}`,
      slug,
      ownerEmail,
      ownerDisplayName: 'Owner Set',
    })
    const ownerActor: IdentityAuthActor = {
      tenantId: created.tenantId,
      tenantSlug: slug,
      authOrgId: 'org-set',
      appUserId: created.ownerInvite.appUserId,
      outletIds: null,
      permissions: new Set(PERMISSION_CODES),
    }

    const nonPkpLe = await createLegalEntity(ownerActor, {
      name: 'CV Non PKP',
      npwp: null,
      isPkp: false,
    })
    const pkpLe = await createLegalEntity(ownerActor, {
      name: 'PT PKP Resmi',
      npwp: '123456789012345',
      isPkp: true,
    })
    const out1 = await createOutlet(ownerActor, {
      legalEntityId: nonPkpLe.id,
      code: 'OUT1',
      name: 'Outlet NonPKP',
      timezone: 'Asia/Jakarta',
      dayCutoffTime: '00:00',
      priceTaxMode: 'INCLUSIVE',
      taxProfile: 'NONE',
    })
    const out2 = await createOutlet(ownerActor, {
      legalEntityId: pkpLe.id,
      code: 'OUT2',
      name: 'Outlet PKP',
      timezone: 'Asia/Jakarta',
      dayCutoffTime: '00:00',
      priceTaxMode: 'EXCLUSIVE',
      taxProfile: 'PPN',
    })

    // 1. PPN rejected on non-PKP legal entity
    await expect(
      updateOutletTaxSettings(ownerActor, {
        outletId: out1.id,
        taxProfile: 'PPN',
        priceTaxMode: 'INCLUSIVE',
        cashRoundingUnit: 100,
        serviceChargeEnabled: false,
        serviceChargeRate: '0',
        serviceChargeTaxable: true,
      }),
    ).rejects.toThrow(/PKP/)

    // Valid PB1 + service charge on out1
    const taxUpdate = await updateOutletTaxSettings(
      ownerActor,
      {
        outletId: out1.id,
        taxProfile: 'PB1',
        priceTaxMode: 'EXCLUSIVE',
        cashRoundingUnit: 500,
        serviceChargeEnabled: true,
        serviceChargeRate: '5',
        serviceChargeTaxable: true,
      },
      { nowIso: () => '2026-12-01T08:00:00.000Z' },
    )
    expect(taxUpdate.version).toBeGreaterThan(0)

    // Out-of-scope manager rejected on out1
    const mgrOut2: IdentityAuthActor = {
      tenantId: created.tenantId,
      tenantSlug: slug,
      authOrgId: 'org-set',
      appUserId: idGen.newId(),
      outletIds: [out2.id],
      permissions: new Set(['user.manage']),
    }
    await expect(
      updateOutletTaxSettings(mgrOut2, {
        outletId: out1.id,
        taxProfile: 'NONE',
        priceTaxMode: 'INCLUSIVE',
        cashRoundingUnit: 0,
        serviceChargeEnabled: false,
        serviceChargeRate: '0',
        serviceChargeTaxable: false,
      }),
    ).rejects.toThrow()

    // 2. Tax rate history: past rejected; 2026-12-31 (11%) & 2027-01-01 (12%) preserved separately
    await expect(
      addTaxRate(
        ownerActor,
        { taxCode: 'PPN', outletId: out2.id, effectiveFrom: '2026-11-30', rate: '11' },
        { nowIso: () => '2026-12-01T08:00:00.000Z' },
      ),
    ).rejects.toThrow(/before today/)

    await addTaxRate(
      ownerActor,
      { taxCode: 'PPN', outletId: out2.id, effectiveFrom: '2026-12-31', rate: '11' },
      { nowIso: () => '2026-12-01T08:00:00.000Z' },
    )
    await addTaxRate(
      ownerActor,
      { taxCode: 'PPN', outletId: out2.id, effectiveFrom: '2027-01-01', rate: '12' },
      { nowIso: () => '2026-12-01T08:00:00.000Z' },
    )
    // Historical row cannot be overwritten
    await expect(
      addTaxRate(
        ownerActor,
        { taxCode: 'PPN', outletId: out2.id, effectiveFrom: '2026-12-31', rate: '10' },
        { nowIso: () => '2026-12-01T08:00:00.000Z' },
      ),
    ).rejects.toThrow(/overwritten/)

    const out2Settings = await getOutletFullSettings(ownerActor, out2.id)
    const rateRows = out2Settings.taxRates.map((r) => ({
      id: r.id,
      taxCode: r.taxCode,
      outletId: r.outletId,
      effectiveFrom: r.effectiveFrom,
      rate: r.rate,
    }))
    expect(selectTaxRate(rateRows, 'PPN', out2.id, '2026-12-31')?.rate).toBe('11')
    expect(selectTaxRate(rateRows, 'PPN', out2.id, '2027-01-01')?.rate).toBe('12')

    // 3. Logo upload: PNG ok, JPEG ok, SVG rejected, >200KB rejected, >1024px rejected, GET returns bytes
    const assetsDir = await mkdtemp(path.join(os.tmpdir(), 'solva-logo-test-'))
    tempDirs.push(assetsDir)
    process.env.ASSETS_DIR = assetsDir
    resetEnvForTests()

    const svgB64 = Buffer.from('<svg></svg>').toString('base64')
    await expect(
      uploadOutletLogo(ownerActor, { outletId: out2.id, base64Data: svgB64 }, { assetsDir }),
    ).rejects.toThrow()

    const hugePng = Buffer.alloc(205 * 1024, 0)
    pngBytes(100, 100).copy(hugePng)
    await expect(
      uploadOutletLogo(
        ownerActor,
        { outletId: out2.id, base64Data: hugePng.toString('base64') },
        { assetsDir },
      ),
    ).rejects.toThrow(/limit/)

    await expect(
      uploadOutletLogo(
        ownerActor,
        { outletId: out2.id, base64Data: pngBytes(1025, 64).toString('base64') },
        { assetsDir },
      ),
    ).rejects.toThrow(/exceed/)

    const jpgRes = await uploadOutletLogo(
      ownerActor,
      { outletId: out2.id, base64Data: jpegBytes(120, 60).toString('base64') },
      { assetsDir },
    )
    expect(jpgRes.logoObjectKey).toMatch(/\.jpg$/)

    const validPng = pngBytes(200, 100)
    const pngRes = await uploadOutletLogo(
      ownerActor,
      { outletId: out2.id, base64Data: `data:image/png;base64,${validPng.toString('base64')}` },
      { assetsDir },
    )
    expect(pngRes.logoObjectKey).toContain(pngRes.logoSha256)
    expect(pngRes.logoObjectKey).toMatch(/\.png$/)

    // Verify GET /api/pos/v1/assets/logo/$outletId streams back identical bytes
    const reg2 = await createRegister(ownerActor, {
      outletId: out2.id,
      code: 'POS02',
      name: 'Reg 2',
      registerType: 'CASHIER',
      invoicePrefix: 'OUT02-POS02',
    })
    const pair2 = await createPairingCode(ownerActor, reg2.id)
    const dev2 = await enrollDevice(
      { slug, code: pair2.code, device_name: 'Tab Logo' },
      '10.8.0.1',
      { minDelayMs: 0 },
    )

    const logoHttpRes = await handleGetOutletLogo(
      new Request(`https://pos.solva.test/api/pos/v1/assets/logo/${out2.id}`, {
        headers: { Authorization: `Bearer ${dev2.credential}` },
      }),
    )
    expect(logoHttpRes.status).toBe(200)
    const streamed = Buffer.from(await logoHttpRes.arrayBuffer())
    expect(streamed.equals(validPng)).toBe(true)

    // 4. Payment method single active CASH invariant (seeded CASH already exists) + QRIS add/disable
    const existingCash = out2Settings.paymentMethods.find((p) => p.kind === 'CASH')!
    expect(existingCash).toBeDefined()

    // Cannot create 2nd CASH method
    await expect(
      savePaymentMethod(ownerActor, {
        code: 'CASH2',
        name: 'Tunai 2',
        kind: 'CASH',
        requiresReference: false,
        sortOrder: 2,
        isActive: true,
      }),
    ).rejects.toThrow(/CASH/)

    // Cannot deactivate sole CASH method
    await expect(
      savePaymentMethod(ownerActor, {
        id: existingCash.id,
        code: existingCash.code,
        name: existingCash.name,
        kind: 'CASH',
        requiresReference: false,
        sortOrder: 1,
        isActive: false,
      }),
    ).rejects.toThrow(/deactivate/)

    const qrisPm = await savePaymentMethod(ownerActor, {
      code: 'QRIS',
      name: 'QRIS Dinamis',
      kind: 'NON_CASH',
      requiresReference: true,
      sortOrder: 2,
      isActive: true,
    })
    expect(qrisPm.version).toBeGreaterThan(existingCash.version)

    // Verify audits recorded
    await withTenantReadOnly(created.tenantId, async (tx) => {
      const aud = await tx.execute(
        sql`SELECT action FROM audit_log WHERE tenant_id = ${created.tenantId}::uuid`,
      )
      const actions = (aud.rows as Array<{ action: string }>).map((r) => r.action)
      expect(actions).toContain('outlet.changed')
      expect(actions).toContain('tax_rate.changed')
    })
  })
})
