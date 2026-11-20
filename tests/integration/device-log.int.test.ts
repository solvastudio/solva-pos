import { webcrypto } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import { MAX_DEVICE_LOG_BODY_BYTES, type DeviceLogEntry } from '~/lib/contracts'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
  createLegalEntity,
  createOutlet,
  createPairingCode,
  createRegister,
  createTenant,
  enrollDevice,
  getTenantAuthMetadataBySlug,
  redeemInvite,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { handleDeviceLog } from '~/routes/api/pos/v1/device-log'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { resetCompositionForTests } from '~/server/composition'
import { closePools } from '~/server/db'
import { searchLogDirectory } from '~/server/logging/log-search'
import { captureLogs, resetLoggerForTests } from '~/server/logging/logger-core'
import { uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-device-log@example.test' }

async function setupDevice(slug: string) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `DeviceLog ${slug}`,
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
  const le = await createLegalEntity(actor, { name: 'PT Log', isPkp: false })
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
    code: 'POS01',
    name: 'Cashier 1',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS01',
  })
  const pairing = await createPairingCode(actor, reg.id)
  resetLimitersForTests()
  const enrolled = await enrollDevice(
    { slug, code: pairing.code, device_name: 'Log-Device' },
    '10.5.0.1',
    { minDelayMs: 0 },
  )
  resetLimitersForTests()
  return {
    tenantId: created.tenantId,
    deviceId: enrolled.device_id,
    registerId: reg.id,
    credential: enrolled.credential,
  }
}

function makeDeviceLogRequest(credential: string | null, rawBody: string | Record<string, unknown>) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Schema-Version': '1',
  })
  if (credential) {
    headers.set('Authorization', `Bearer ${credential}`)
  }
  return new Request('https://pos.solva.test/api/pos/v1/device-log', {
    method: 'POST',
    headers,
    body: typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody),
  })
}

function makeEntry(overrides: Partial<DeviceLogEntry> = {}): DeviceLogEntry {
  return {
    ref_local: 'D-20261120-081500-ab3cd',
    created_at: '2026-11-20T08:15:00.000Z',
    clock_offset_ms: 0,
    level: 'error',
    code: 'APP_ERROR',
    route: '/pos/cart?token=secret123',
    stack: 'Error: crash\n  at Cart (assets/index-abc.js?v=1:1:12)',
    component_stack: 'at Cart\n  at ErrorBoundaryArea',
    ctx: { area: 'pos-cart', attempt: 1 },
    app_version: '1.0.0',
    schema_version: 1,
    ...overrides,
  }
}

afterEach(() => {
  __clearDeviceAuthCacheForTests()
  __clearTenantCacheForTests()
  resetLimitersForTests()
  resetLoggerForTests()
})

afterAll(async () => {
  resetCompositionForTests()
  await closePools()
})

describe('POST /api/pos/v1/device-log', () => {
  it('writes scrubbed device log entries with scope device and finds them by --ref-local', async () => {
    const dev = await setupDevice(uniqueSlug('devlog-ok'))
    const cap = captureLogs('info')
    const tmpDir = await mkdtemp(join(tmpdir(), 'solva-devlog-'))

    try {
      const res = await handleDeviceLog(
        makeDeviceLogRequest(dev.credential, {
          entries: [
            makeEntry({
              ref_local: 'D-20261120-081501-km7np',
              ctx: {
                area: 'pos-checkout',
                pin: '123456',
                customerName: 'Budi',
                token: 'tok-secret',
                nested: { shouldDrop: true },
              },
            }),
          ],
        }),
      )

      expect(res.status).toBe(200)
      const json = (await res.json()) as { received: number; dropped?: number }
      expect(json).toEqual({ received: 1 })

      const entries = cap.entries()
      const logLine = entries.find((e) => e.refLocal === 'D-20261120-081501-km7np')
      expect(logLine).toBeDefined()
      expect(logLine!.scope).toBe('device')
      expect(logLine!.tenantId).toBe(dev.tenantId)
      expect(logLine!.deviceId).toBe(dev.deviceId)
      expect(logLine!.route).toBe('/pos/cart')

      const serialized = JSON.stringify(logLine)
      expect(serialized).not.toContain('123456')
      expect(serialized).not.toContain('Budi')
      expect(serialized).not.toContain('tok-secret')
      expect(serialized).not.toContain('shouldDrop')

      await writeFile(join(tmpDir, 'app.2026-11-20.1.log'), `${serialized}\n`, 'utf8')
      const found = await searchLogDirectory(
        tmpDir,
        { refLocal: 'D-20261120-081501-km7np' },
        '2026-11-20',
      )
      expect(found).toHaveLength(1)
      expect(found[0]).toContain('D-20261120-081501-km7np')
    } finally {
      cap.stop()
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns 401 when missing device Bearer credential, 400 for > 100 entries, and 413 for > 256 KB body', async () => {
    const dev = await setupDevice(uniqueSlug('devlog-val'))

    const unauth = await handleDeviceLog(
      makeDeviceLogRequest(null, { entries: [makeEntry()] }),
    )
    expect(unauth.status).toBe(401)

    const tooManyEntries = Array.from({ length: 101 }, (_, idx) =>
      makeEntry({
        ref_local: `D-20261120-0815${String(idx % 60).padStart(2, '0')}-ab3cd`,
      }),
    )
    const tooManyRes = await handleDeviceLog(
      makeDeviceLogRequest(dev.credential, { entries: tooManyEntries }),
    )
    expect(tooManyRes.status).toBe(400)

    const oversizedRaw = JSON.stringify({
      entries: [makeEntry()],
      pad: 'x'.repeat(MAX_DEVICE_LOG_BODY_BYTES + 64),
    })
    const tooBigRes = await handleDeviceLog(makeDeviceLogRequest(dev.credential, oversizedRaw))
    expect(tooBigRes.status).toBe(413)
  })

  it('silently drops batches over 20 reports per 10 minutes with HTTP 200 and dropped count', async () => {
    const dev = await setupDevice(uniqueSlug('devlog-rl'))
    const cap = captureLogs('info')

    try {
      for (let i = 0; i < 20; i += 1) {
        const res = await handleDeviceLog(
          makeDeviceLogRequest(dev.credential, {
            entries: [
              makeEntry({
                ref_local: `D-20261120-0815${String(i).padStart(2, '0')}-ab3cd`,
              }),
            ],
          }),
        )
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ received: 1 })
      }

      const overLimit = await handleDeviceLog(
        makeDeviceLogRequest(dev.credential, {
          entries: [
            makeEntry({ ref_local: 'D-20261120-081601-ab3cd' }),
            makeEntry({ ref_local: 'D-20261120-081602-ab3cd' }),
          ],
        }),
      )
      expect(overLimit.status).toBe(200)
      expect(await overLimit.json()).toEqual({ received: 0, dropped: 2 })
    } finally {
      cap.stop()
    }
  })
})
