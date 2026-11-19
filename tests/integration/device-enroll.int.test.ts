import { webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
  createLegalEntity,
  createOutlet,
  createPairingCode,
  createRegister,
  createTenant,
  enrollDevice,
  EnrollConflictError,
  getTenantAuthMetadataBySlug,
  RateLimitRejectedError,
  redeemInvite,
  revokeDevice,
  setTenantStatus,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { closePools } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
import { captureLogs } from '~/server/logging/logger-core'
import { appClient, ownerClient, withClient } from './helpers/db'
import { uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-dev@example.test' }

async function setupTenantWithRegister(slug: string, registerCode = 'POS01') {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Dev ${slug}`,
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
  const le = await createLegalEntity(actor, { name: 'PT Device', isPkp: false })
  const out = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  const reg = await createRegister(actor, {
    outletId: out.id,
    code: registerCode,
    name: 'Register 01',
    registerType: 'CASHIER',
    invoicePrefix: `OUT01-${registerCode}`,
  })
  return { tenantId: created.tenantId, slug, actor, outlet: out, register: reg }
}

describe('device-enroll integration (atomic pairing, V-41 rate limits, sentinel log check, RLS)', () => {
  beforeEach(() => {
    resetEnvForTests()
    resetLimitersForTests()
    __clearDeviceAuthCacheForTests()
    __clearTenantCacheForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('scenarios 1, 2, 6: full enrollment flow, zero token/code logs, atomic 6-way race, and replacement of unused pairing codes', async () => {
    const t = await setupTenantWithRegister(uniqueSlug('denr'))
    const logs = captureLogs('debug')

    // Scenario 6: second pairing code replaces previous unused code.
    try {
      const firstPairing = await createPairingCode(t.actor, t.register.id)
      const secondPairing = await createPairingCode(t.actor, t.register.id)
      expect(secondPairing.code).not.toBe(firstPairing.code)
      expect(secondPairing.enrollUrl).toContain(`/${t.slug}/pos#pair=${secondPairing.code}`)

      // Old unused code was deleted.
      await expect(
        enrollDevice(
          { slug: t.slug, code: firstPairing.code, device_name: 'Old Code Tablet' },
          '10.0.0.1',
          { minDelayMs: 0 },
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: 'sys.code.invalid' })

      // Scenario 2: 6 concurrent enroll calls using secondPairing.code -> exactly 1 wins.
      const raceResults = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) =>
          enrollDevice(
            { slug: t.slug, code: secondPairing.code, device_name: `Tablet-${i + 1}` },
            `10.0.1.${i + 1}`,
            { minDelayMs: 0 },
          ),
        ),
      )
      const fulfilled = raceResults.filter((r) => r.status === 'fulfilled')
      const rejected = raceResults.filter((r) => r.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(5)
      for (const r of rejected) {
        expect((r as PromiseRejectedResult).reason).toMatchObject({
          code: 'VALIDATION_FAILED',
          message: 'sys.code.invalid',
        })
      }

      const enrolled = (
        fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof enrollDevice>>>
      ).value
      expect(enrolled.credential.length).toBe(43)
      expect(enrolled.register.id).toBe(t.register.id)

      // Scenario 1 DB check: device, device_sync_status, pairing_code.used_at, and audit device.enrolled; token hashed cleanly.
      await withClient(ownerClient, async (client) => {
        await client.query('BEGIN')
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [t.tenantId])
        const devRes = await client.query(
          `SELECT d.credential_hash, ds.storage_persist, pc.used_at, pc.used_by_device_id
             FROM device d
             JOIN device_sync_status ds ON ds.device_id = d.id
             JOIN pairing_code pc ON pc.id = d.pairing_code_id
            WHERE d.id = $1`,
          [enrolled.device_id],
        )
        const auditRes = await client.query(
          `SELECT action, after_data FROM audit_log WHERE entity_id = $1 ORDER BY chain_seq DESC LIMIT 1`,
          [enrolled.device_id],
        )
        await client.query('COMMIT')
        expect(devRes.rows).toHaveLength(1)
        expect(Buffer.from(devRes.rows[0].credential_hash).toString('utf8')).not.toBe(
          enrolled.credential,
        )
        expect(devRes.rows[0].storage_persist).toBe('UNKNOWN')
        expect(devRes.rows[0].used_at).not.toBeNull()
        expect(devRes.rows[0].used_by_device_id).toBe(enrolled.device_id)
        expect(auditRes.rows[0].action).toBe('device.enrolled')
      })

      // Sentinel check: neither plaintext pairing codes nor bearer token appear anywhere in logs.
      const rawLogs = logs.lines().join('\n')
      expect(rawLogs).not.toContain(firstPairing.code)
      expect(rawLogs).not.toContain(secondPairing.code)
      expect(rawLogs).not.toContain(enrolled.credential)
    } finally {
      logs.stop()
    }
  })

  it('scenarios 3, 4, 5, 8, 9, 10: expiry, cross-tenant timing uniformity, 409 active device rollback without burning code, suspended tenant, DB unique active register, and RLS isolation', async () => {
    const tA = await setupTenantWithRegister(uniqueSlug('denra'))
    const tB = await setupTenantWithRegister(uniqueSlug('denrb'))

    // Scenario 3: code created at t0 fails cleanly after +16 minutes.
    const baseMs = Date.parse('2026-11-20T10:00:00.000Z')
    const pExp = await createPairingCode(tA.actor, tA.register.id, {
      nowIso: () => new Date(baseMs).toISOString(),
    })
    await expect(
      enrollDevice(
        { slug: tA.slug, code: pExp.code, device_name: 'Late Tablet' },
        '10.1.0.1',
        { nowIso: () => new Date(baseMs + 16 * 60_000).toISOString(), minDelayMs: 0 },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: 'sys.code.invalid' })

    // Scenario 4: valid code on Tenant A submitted to Tenant B slug -> identical failure + uniform timing.
    const pCross = await createPairingCode(tA.actor, tA.register.id)
    const tStartWrongCode = performance.now()
    await expect(
      enrollDevice(
        { slug: tA.slug, code: 'ZZZZ-ZZZZ', device_name: 'Wrong Code' },
        '10.1.0.2',
        { minDelayMs: 60 },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: 'sys.code.invalid' })
    const wrongCodeMs = performance.now() - tStartWrongCode

    const tStartWrongSlug = performance.now()
    await expect(
      enrollDevice(
        { slug: tB.slug, code: pCross.code, device_name: 'Wrong Tenant' },
        '10.1.0.3',
        { minDelayMs: 60 },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: 'sys.code.invalid' })
    const wrongSlugMs = performance.now() - tStartWrongSlug
    expect(Math.abs(wrongSlugMs - wrongCodeMs)).toBeLessThan(150)

    // Enroll device 1 legitimately with a fresh code while keeping a separate register's pairing test clean.
    const pDev1 = await createPairingCode(tA.actor, tA.register.id)
    const dev1 = await enrollDevice(
      { slug: tA.slug, code: pDev1.code, device_name: 'Device 1' },
      '10.1.0.4',
      { minDelayMs: 0 },
    )

    // Scenario 5: creating a pairing code while active device exists -> enroll rejects 409 REGISTER_HAS_ACTIVE_DEVICE AND leaves code UNUSED!
    const pDev2 = await createPairingCode(tA.actor, tA.register.id)
    let conflictErr: unknown = null
    try {
      await enrollDevice(
        { slug: tA.slug, code: pDev2.code, device_name: 'Device 2' },
        '10.1.0.5',
        { minDelayMs: 0 },
      )
    } catch (e) {
      conflictErr = e
    }
    expect(conflictErr).toBeInstanceOf(EnrollConflictError)
    expect((conflictErr as EnrollConflictError).reason).toBe('REGISTER_HAS_ACTIVE_DEVICE')

    // Scenario 9: DB enforces partial unique index uq_device__active_register at SQL level too.
    await expect(
      withClient(ownerClient, async (client) => {
        await client.query('BEGIN')
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tA.tenantId])
          await client.query(
            `INSERT INTO device (tenant_id, register_id, name, credential_hash, credential_expires_at, enrolled_by)
             VALUES ($1, $2, 'Raw Dup', decode('00010203', 'hex'), now() + interval '180 days', $3)`,
            [tA.tenantId, tA.register.id, tA.actor.appUserId],
          )
          await client.query('COMMIT')
        } catch (err) {
          await client.query('ROLLBACK')
          throw err
        }
      }),
    ).rejects.toThrow()

    // After revoking Device 1, preserved pDev2.code succeeds immediately!
    await revokeDevice(tA.actor, { deviceId: dev1.device_id, reasonCode: 'REPLACED' })
    const dev2 = await enrollDevice(
      { slug: tA.slug, code: pDev2.code, device_name: 'Device 2' },
      '10.1.0.6',
      { minDelayMs: 0 },
    )
    expect(dev2.device_id).not.toBe(dev1.device_id)

    // Scenario 10: RLS isolation on pairing_code, device, device_sync_status across tenants.
    await withClient(appClient, async (client) => {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tB.tenantId])
      const devCross = await client.query('SELECT id FROM device WHERE id = $1', [dev2.device_id])
      const syncCross = await client.query(
        'SELECT device_id FROM device_sync_status WHERE device_id = $1',
        [dev2.device_id],
      )
      const codeCross = await client.query(
        'SELECT id FROM pairing_code WHERE register_id = $1',
        [tA.register.id],
      )
      await client.query('COMMIT')
      expect(devCross.rows).toHaveLength(0)
      expect(syncCross.rows).toHaveLength(0)
      expect(codeCross.rows).toHaveLength(0)
    })

    // Scenario 8: Suspended tenant rejects enrollment with TENANT_SUSPENDED.
    await setTenantStatus(testOp, tA.tenantId, 'SUSPENDED')
    await expect(
      enrollDevice(
        { slug: tA.slug, code: 'ABCD-EFGH', device_name: 'Suspended Device' },
        '10.1.0.7',
        { minDelayMs: 0 },
      ),
    ).rejects.toMatchObject({ code: 'TENANT_SUSPENDED' })
  })

  it('scenario 7 (V-41): enforces per-IP (10/5m) and distributed per-slug (30/5m) rate limits', async () => {
    const t = await setupTenantWithRegister(uniqueSlug('denrl'))
    const t2 = await setupTenantWithRegister(uniqueSlug('denrl2'))
    const nowIso = () => '2026-11-20T12:00:00.000Z'

    // Per-IP limit: 10 attempts from the same IP fail normally; 11th throws RateLimitRejectedError.
    for (let i = 0; i < 10; i += 1) {
      await expect(
        enrollDevice(
          { slug: t.slug, code: 'AAAA-AAAA', device_name: 'Burst' },
          '203.0.113.10',
          { nowIso, minDelayMs: 0 },
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    }
    await expect(
      enrollDevice(
        { slug: t.slug, code: 'AAAA-AAAA', device_name: 'Burst' },
        '203.0.113.10',
        { nowIso, minDelayMs: 0 },
      ),
    ).rejects.toBeInstanceOf(RateLimitRejectedError)

    // Distributed per-slug limit: 30 attempts across distinct IPs hit VALIDATION_FAILED; 31st hits enrollSlug limit!
    for (let i = 0; i < 30; i += 1) {
      await expect(
        enrollDevice(
          { slug: t2.slug, code: 'BBBB-BBBB', device_name: 'Distributed' },
          `198.51.100.${i + 1}`,
          { nowIso, minDelayMs: 0 },
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    }
    await expect(
      enrollDevice(
        { slug: t2.slug, code: 'BBBB-BBBB', device_name: 'Distributed' },
        '198.51.100.250',
        { nowIso, minDelayMs: 0 },
      ),
    ).rejects.toBeInstanceOf(RateLimitRejectedError)
  })
})
