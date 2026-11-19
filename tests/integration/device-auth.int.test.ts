import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
  authenticateDevice,
  createLegalEntity,
  createOutlet,
  createPairingCode,
  createRegister,
  createTenant,
  enrollDevice,
  extendCredentialIfNeeded,
  getTenantAuthMetadataBySlug,
  listDevices,
  RateLimitRejectedError,
  redeemInvite,
  revokeDevice,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { handlePing } from '~/routes/api/pos/v1/ping'
import { closePools, withNoTenant, withTenant } from '~/server/db'
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

const testOp = { platformUserId: testIdGen.newId(), email: 'op-dauth@example.test' }

async function setupEnrolledDevice(slug: string, registerType: 'CASHIER' | 'WAITER' = 'CASHIER') {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Auth ${slug}`,
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
  const le = await createLegalEntity(actor, { name: 'PT Auth', isPkp: false })
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
    code: registerType === 'CASHIER' ? 'POS01' : 'WTR01',
    name: registerType === 'CASHIER' ? 'Cashier 1' : 'Waiter 1',
    registerType,
    invoicePrefix: registerType === 'CASHIER' ? 'OUT01-POS01' : null,
  })
  const pairing = await createPairingCode(actor, reg.id)
  const enrolled = await enrollDevice(
    { slug, code: pairing.code, device_name: `Tablet-${registerType}` },
    '10.2.0.1',
    { minDelayMs: 0 },
  )
  return { tenantId: created.tenantId, slug, actor, outlet: out, register: reg, enrolled }
}

describe('device-auth & endpoint integration (bearer verification, cache invalidation, rolling renewal, ping)', () => {
  beforeEach(() => {
    resetLimitersForTests()
    __clearDeviceAuthCacheForTests()
    __clearTenantCacheForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('authenticates valid Bearer credential, checks WAITER registerType, revokes immediately by clearing cache, and enforces badCredentialIp', async () => {
    const cashier = await setupEnrolledDevice(uniqueSlug('dauth1'), 'CASHIER')
    const waiter = await setupEnrolledDevice(uniqueSlug('dauth2'), 'WAITER')

    // Valid cashier device returns authoritative tenant/outlet/register from DB.
    const ctxCashier = await authenticateDevice(
      new Request('http://localhost/api/pos/v1/ping', {
        headers: { Authorization: `Bearer ${cashier.enrolled.credential}` },
      }),
    )
    expect(ctxCashier).toEqual({
      tenantId: cashier.tenantId,
      deviceId: cashier.enrolled.device_id,
      registerId: cashier.register.id,
      outletId: cashier.outlet.id,
      registerType: 'CASHIER',
    })

    // Valid waiter device carries WAITER registerType.
    const ctxWaiter = await authenticateDevice(
      new Request('http://localhost/api/pos/v1/ping', {
        headers: { Authorization: `Bearer ${waiter.enrolled.credential}` },
      }),
    )
    expect(ctxWaiter.registerType).toBe('WAITER')

    // Random valid-length bearer tokens fail UNAUTHORIZED and hit badCredentialIp after 30 failures.
    const badToken = 'A'.repeat(43)
    for (let i = 0; i < 30; i += 1) {
      await expect(
        authenticateDevice(
          new Request('http://localhost/api/pos/v1/ping', {
            headers: { Authorization: `Bearer ${badToken}` },
          }),
          { remoteAddress: '192.0.2.55' },
        ),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    }
    await expect(
      authenticateDevice(
        new Request('http://localhost/api/pos/v1/ping', {
          headers: { Authorization: `Bearer ${badToken}` },
        }),
        { remoteAddress: '192.0.2.55' },
      ),
    ).rejects.toBeInstanceOf(RateLimitRejectedError)

    // listDevices reports neverSynced=true initially.
    const listed = await listDevices(cashier.actor)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.neverSynced).toBe(true)

    // Revoking clears LRU cache immediately (< 15s) and triggers DEVICE_REVOKED 403.
    await revokeDevice(cashier.actor, {
      deviceId: cashier.enrolled.device_id,
      reasonCode: 'STOLEN',
    })
    await expect(
      authenticateDevice(
        new Request('http://localhost/api/pos/v1/ping', {
          headers: { Authorization: `Bearer ${cashier.enrolled.credential}` },
        }),
      ),
    ).rejects.toMatchObject({ code: 'DEVICE_REVOKED' })

    // Expired credential triggers CREDENTIAL_EXPIRED 401.
    const farFutureMs = Date.parse(waiter.enrolled.credential_expires_at) + 1_000
    await expect(
      authenticateDevice(
        new Request('http://localhost/api/pos/v1/ping', {
          headers: { Authorization: `Bearer ${waiter.enrolled.credential}` },
        }),
        { nowMs: () => farFutureMs },
      ),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_EXPIRED' })
  })

  it('handles extendCredentialIfNeeded threshold (<150d writes, >=150d skips), definer isolation, and compact /api/pos/v1/ping <= 200 bytes', async () => {
    const t = await setupEnrolledDevice(uniqueSlug('dauth3'), 'CASHIER')

    // At +20 days (remaining = 160d >= 150d): does NOT write.
    const enrolledMs = Date.parse(t.enrolled.credential_expires_at) - 180 * 86_400_000
    const atDay20Iso = new Date(enrolledMs + 20 * 86_400_000).toISOString()
    const skipped = await withTenant(t.tenantId, (tx) =>
      extendCredentialIfNeeded(tx, t.tenantId, t.enrolled.device_id, atDay20Iso),
    )
    expect(skipped).toBe(false)

    // At +31 days (remaining = 149d < 150d): extends credential_expires_at to now + 180d.
    const atDay31Ms = enrolledMs + 31 * 86_400_000
    const atDay31Iso = new Date(atDay31Ms).toISOString()
    const extended = await withTenant(t.tenantId, (tx) =>
      extendCredentialIfNeeded(tx, t.tenantId, t.enrolled.device_id, atDay31Iso),
    )
    expect(extended).toBe(true)

    await withClient(ownerClient, async (client) => {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [t.tenantId])
      const res = await client.query('SELECT credential_expires_at FROM device WHERE id = $1', [
        t.enrolled.device_id,
      ])
      await client.query('COMMIT')
      const updatedMs = new Date(res.rows[0].credential_expires_at).getTime()
      expect(updatedMs).toBe(atDay31Ms + 180 * 86_400_000)
    })

    // resolve_device_by_credential returns empty for unknown hash (no row leaks).
    await withNoTenant(async (tx) => {
      const dummyHash = Buffer.alloc(32, 0xff)
      const res = await tx.execute(
        sql`SELECT device_id FROM resolve_device_by_credential(${dummyHash})`,
      )
      expect(res.rows).toHaveLength(0)
    })

    // GET /api/pos/v1/ping returns compact JSON <= 200 bytes + no-store + X-App-Version.
    const pingRes = await handlePing(new Request('http://localhost:3000/api/pos/v1/ping'))
    expect(pingRes.status).toBe(200)
    expect(pingRes.headers.get('cache-control')).toBe('no-store')
    expect(pingRes.headers.get('x-app-version')).toBeTruthy()
    const rawBody = await pingRes.text()
    expect(Buffer.byteLength(rawBody, 'utf8')).toBeLessThanOrEqual(200)
    const parsed = JSON.parse(rawBody) as {
      ok: boolean
      server_time: number
      min_schema: number
      max_schema: number
    }
    expect(parsed.ok).toBe(true)
    expect(typeof parsed.server_time).toBe('number')
  })
})
