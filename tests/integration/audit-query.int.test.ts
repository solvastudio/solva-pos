import { webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import {
  escapeCsvCell,
  exportAuditCsv,
  listAudit,
  verifyTenantAuditChain,
  type AuditActorContext,
} from '~/modules/audit/public'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
  createLegalEntity,
  createOutlet,
  createTenant,
  updateOutletTaxSettings,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { __resetPushLimitsForTests } from '~/server/auth/rate-limit/push-limits'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
import { adminClient, withClient } from './helpers/db'
import { uniqueSlug } from './helpers/tenants'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: idGen.newId(), email: 'op-audit-q@example.test' }

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
  await closePools()
})

describe('audit viewer, CSV formula escaping, and hash-chain verification', () => {
  it('filters audit entries, orders by chain_seq, escapes formula injection in CSV, and detects hash tampering', async () => {
    const slug = uniqueSlug('audq')
    const ownerEmail = `owner-${slug}@example.test`
    const created = await createTenant(testOp, {
      name: `Aud ${slug}`,
      slug,
      ownerEmail,
      ownerDisplayName: 'Owner Aud',
    })
    const ownerUserId = created.ownerInvite.appUserId
    const ownerIdentity: IdentityAuthActor = {
      tenantId: created.tenantId,
      tenantSlug: slug,
      authOrgId: 'org-audq',
      appUserId: ownerUserId,
      outletIds: null,
      permissions: new Set(PERMISSION_CODES),
    }
    const auditActor: AuditActorContext = ownerIdentity

    const le = await createLegalEntity(ownerIdentity, { name: 'PT Aud', npwp: null, isPkp: false })
    const out1 = await createOutlet(ownerIdentity, {
      legalEntityId: le.id,
      code: 'O1',
      name: 'Outlet 1',
      timezone: 'Asia/Jakarta',
      dayCutoffTime: '00:00',
      priceTaxMode: 'INCLUSIVE',
      taxProfile: 'NONE',
    })

    await updateOutletTaxSettings(
      ownerIdentity,
      {
        outletId: out1.id,
        taxProfile: 'PB1',
        priceTaxMode: 'EXCLUSIVE',
        cashRoundingUnit: 100,
        serviceChargeEnabled: false,
        serviceChargeRate: '0',
        serviceChargeTaxable: false,
      },
      { nowIso: () => '2026-11-20T05:00:00.000Z' },
    )

    // Inject an audit entry whose reasonText starts with '=' (CSV formula injection vector!)
    await withTenant(created.tenantId, async (tx) => {
      await appendAudit(
        tx,
        {
          action: 'gap.explained',
          entityType: 'invoice_gap',
          entityId: idGen.newId(),
          outletId: out1.id,
          actorUserId: ownerUserId,
          reasonText: '=CMD("calc")',
          occurredAt: '2026-11-20T06:00:00.000Z',
        },
        { newId: () => idGen.newId(), nowIso: () => '2026-11-20T06:00:00.000Z' },
      )
    })

    // 1. Query ordered ascending by chain_seq & filtered by action
    const allAsc = await listAudit(auditActor, { sort: 'asc' })
    expect(allAsc.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < allAsc.length; i += 1) {
      expect(allAsc[i]!.chainSeq).toBeGreaterThan(allAsc[i - 1]!.chainSeq)
    }

    const onlyGap = await listAudit(auditActor, {
      action: 'gap.explained',
      actorUserId: ownerUserId,
      fromDate: '2026-11-20',
      toDate: '2026-11-20',
    })
    expect(onlyGap).toHaveLength(1)
    expect(onlyGap[0]!.reasonText).toBe('=CMD("calc")')

    // 2. CSV escapes formula prefixes safely
    expect(escapeCsvCell('=1+1')).toBe("'=1+1")
    expect(escapeCsvCell('+SUM(A1)')).toBe("'+SUM(A1)")
    expect(escapeCsvCell('@IMPORT')).toBe("'@IMPORT")
    const exported = await exportAuditCsv(auditActor, { action: 'gap.explained' })
    expect(exported.csv).toContain("'=CMD(")
    expect(exported.csv).not.toMatch(/^=CMD|,=CMD/m)

    // 3. Chain verification passes cleanly
    const cleanVerify = await verifyTenantAuditChain(auditActor)
    expect(cleanVerify.ok).toBe(true)

    // 4. Tampering audit_log row (via adminClient with trigger temporarily disabled) detects ROW_HASH corruption
    const target = onlyGap[0]!
    await withClient(adminClient, async (c) => {
      await c.query('BEGIN')
      await c.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_immutable')
      await c.query(
        'UPDATE audit_log SET reason_text = $1 WHERE tenant_id = $2::uuid AND id = $3::uuid',
        ['tampered', created.tenantId, target.id],
      )
      await c.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_immutable')
      await c.query('COMMIT')
    })
    const brokenVerify = await verifyTenantAuditChain(auditActor)
    expect(brokenVerify).toEqual({
      ok: false,
      brokenAtSeq: target.chainSeq,
      reason: 'ROW_HASH',
    })
  })

  it('treats an actor without an outlet scope as having no outlets, while null still means every outlet', async () => {
    const slug = uniqueSlug('audu')
    const created = await createTenant(testOp, {
      name: `Aud ${slug}`,
      slug,
      ownerEmail: `owner-${slug}@example.test`,
      ownerDisplayName: 'Owner Aud',
    })
    const base = {
      tenantId: created.tenantId,
      appUserId: created.ownerInvite.appUserId,
      permissions: new Set(['audit.view']),
    }
    const tenantWide: AuditActorContext = { ...base, outletIds: null }
    const unscoped: AuditActorContext = { ...base, outletIds: undefined }
    const someOutlet = idGen.newId()

    // null is tenant-wide access: tenant-level entries are visible and any outlet filter is allowed.
    expect((await listAudit(tenantWide)).length).toBeGreaterThan(0)
    await expect(listAudit(tenantWide, { outletId: someOutlet })).resolves.toEqual([])

    // A missing scope fails closed.
    expect(await listAudit(unscoped)).toEqual([])
    await expect(listAudit(unscoped, { outletId: someOutlet })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(exportAuditCsv(unscoped)).resolves.toMatchObject({ count: 0 })
  })
})
