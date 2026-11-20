import { webcrypto } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import { type PushCommandEnvelope } from '~/lib/contracts'
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
  revokeDevice,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { __clearCommandHandlersForTests, registerCommandHandler } from '~/modules/sync/public'
import { handlePush } from '~/routes/api/pos/v1/push'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { __resetPushLimitsForTests } from '~/server/auth/rate-limit/push-limits'
import { composeServer, resetCompositionForTests } from '~/server/composition'
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

const testOp = { platformUserId: testIdGen.newId(), email: 'op-push-http@example.test' }

async function setupDevices(slug: string, count: number) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `HTTP ${slug}`,
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
  const le = await createLegalEntity(actor, { name: 'PT HTTP', isPkp: false })
  const out = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })

  const devices: Array<{ deviceId: string; registerId: string; credential: string }> = []
  for (let i = 1; i <= count; i += 1) {
    const code = `POS${String(i).padStart(2, '0')}`
    const reg = await createRegister(actor, {
      outletId: out.id,
      code,
      name: `Cashier ${i}`,
      registerType: 'CASHIER',
      invoicePrefix: `OUT01-${code}`,
    })
    const pairing = await createPairingCode(actor, reg.id)
    resetLimitersForTests()
    const enrolled = await enrollDevice(
      { slug, code: pairing.code, device_name: `Device-${i}` },
      `10.4.0.${i}`,
      { minDelayMs: 0 },
    )
    devices.push({
      deviceId: enrolled.device_id,
      registerId: reg.id,
      credential: enrolled.credential,
    })
  }

  resetLimitersForTests()
  return { tenantId: created.tenantId, actor, outlet: out, devices }
}

function makePushHttpRequest(
  credential: string | null,
  body: string | Record<string, unknown>,
  headers?: Record<string, string>,
): Request {
  const hdrs = new Headers({
    'Content-Type': 'application/json',
    'X-Schema-Version': '1',
    'X-App-Version': 'v0.1.0',
    'X-Sync-Protocol': '1',
    ...headers,
  })
  if (credential !== null) {
    hdrs.set('Authorization', `Bearer ${credential}`)
  }
  return new Request('https://app.solva.test/api/pos/v1/push', {
    method: 'POST',
    headers: hdrs,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function makeAuditEnvelope(deviceSeq: number): PushCommandEnvelope {
  const nowIso = new Date().toISOString()
  return {
    id: testIdGen.newId(),
    type: 'AppendAudit',
    schema_version: 1,
    device_seq: deviceSeq,
    depends_on: [],
    created_at_device: nowIso,
    payload: {
      entry: {
        id: testIdGen.newId(),
        action: 'drawer.opened',
        entity_type: 'cash_drawer',
        entity_id: null,
        before_data: null,
        after_data: null,
        reason_code: null,
        reason_text: 'Count till',
        actor_user_id: null,
        approver_user_id: null,
        occurred_at_device: nowIso,
        occurred_at: nowIso,
        business_date: null,
        related_command_id: null,
      },
    },
  }
}

describe('POST /api/pos/v1/push HTTP integration', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
    resetLimitersForTests()
    __resetPushLimitsForTests()
    __clearDeviceAuthCacheForTests()
    __clearTenantCacheForTests()
  })

  afterEach(() => {
    resetCompositionForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('rejects unauthenticated or invalid bearer with 401 and revoked device with 403', async () => {
    const slug = uniqueSlug('push-http-auth')
    const fx = await setupDevices(slug, 1)
    const dev = fx.devices[0]!

    const noAuth = await handlePush(
      makePushHttpRequest(null, {
        sent_at_device: new Date().toISOString(),
        clock_offset_ms: 0,
        commands: [],
      }),
    )
    expect(noAuth.status).toBe(401)
    const noAuthJson = (await noAuth.json()) as { error: { code: string } }
    expect(noAuthJson.error.code).toBe('UNAUTHORIZED')

    const badAuth = await handlePush(
      makePushHttpRequest('bad_token_value', {
        sent_at_device: new Date().toISOString(),
        clock_offset_ms: 0,
        commands: [],
      }),
    )
    expect(badAuth.status).toBe(401)

    await revokeDevice(fx.actor, { deviceId: dev.deviceId, reasonCode: 'LOST' })
    const revokedRes = await handlePush(
      makePushHttpRequest(dev.credential, {
        sent_at_device: new Date().toISOString(),
        clock_offset_ms: 0,
        commands: [],
      }),
    )
    expect(revokedRes.status).toBe(403)
    const revokedJson = (await revokedRes.json()) as { error: { code: string } }
    expect(revokedJson.error.code).toBe('DEVICE_REVOKED')
  })

  it('returns 426 UPDATE_REQUIRED on unsupported schema, 413 over 1MB, and 400 over 50 commands', async () => {
    const slug = uniqueSlug('push-http-val')
    const fx = await setupDevices(slug, 1)
    const cred = fx.devices[0]!.credential

    const tooOldSchema = await handlePush(
      makePushHttpRequest(
        cred,
        { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [] },
        { 'X-Schema-Version': '99' },
      ),
    )
    expect(tooOldSchema.status).toBe(426)
    const schemaJson = (await tooOldSchema.json()) as { error: { code: string } }
    expect(schemaJson.error.code).toBe('UPDATE_REQUIRED')

    const over1Mb = JSON.stringify({
      sent_at_device: new Date().toISOString(),
      clock_offset_ms: 0,
      commands: [],
      pad: 'x'.repeat(1024 * 1024 + 64),
    })
    const res413 = await handlePush(makePushHttpRequest(cred, over1Mb))
    expect(res413.status).toBe(413)
    const json413 = (await res413.json()) as { error: { code: string } }
    expect(json413.error.code).toBe('VALIDATION_FAILED')

    const over50Cmds = Array.from({ length: 51 }, (_, idx) => makeAuditEnvelope(idx + 1))
    const res400 = await handlePush(
      makePushHttpRequest(cred, {
        sent_at_device: new Date().toISOString(),
        clock_offset_ms: 0,
        commands: over50Cmds,
      }),
    )
    expect(res400.status).toBe(400)
    const json400 = (await res400.json()) as { error: { code: string } }
    expect(json400.error.code).toBe('VALIDATION_FAILED')
  })

  it('enforces V-42 global limit 8 on 12 concurrent pushes and per-device limit 1 with Retry-After 2-10s', async () => {
    const slug = uniqueSlug('push-http-conc')
    const fx = await setupDevices(slug, 12)

    // Warm auth cache sequentially for all 12 devices so concurrent requests hit pushSemaphore simultaneously.
    for (const d of fx.devices) {
      const warmup = await handlePush(
        makePushHttpRequest(d.credential, {
          sent_at_device: new Date().toISOString(),
          clock_offset_ms: 0,
          commands: [],
        }),
      )
      expect(warmup.status).toBe(200)
    }

    let releaseGate!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    let inHandler = 0
    let onPinHandle: () => Promise<void> = async () => {
      inHandler += 1
      await gate
    }

    __clearCommandHandlersForTests()
    registerCommandHandler({
      type: 'ReportPinState',
      parse: (p) => p,
      async handle() {
        await onPinHandle()
        return { recorded: true }
      },
    })

    const pinCmd = (seq: number): PushCommandEnvelope => ({
      id: testIdGen.newId(),
      type: 'ReportPinState',
      schema_version: 1,
      device_seq: seq,
      depends_on: [],
      created_at_device: new Date().toISOString(),
      payload: {
        user_id: testIdGen.newId(),
        failed_count: 0,
        lock_tier: 0,
        locked_until: null,
        last_failed_at: null,
        pin_epoch_seen: 1,
      },
    })

    const responsesPromise = Promise.all(
      fx.devices.map((d, idx) =>
        handlePush(
          makePushHttpRequest(d.credential, {
            sent_at_device: new Date().toISOString(),
            clock_offset_ms: 0,
            commands: [pinCmd(idx + 1)],
          }),
        ),
      ),
    )

    // Wait until all 8 global slots are held inside the slow handler, then open the gate.
    for (let attempt = 0; attempt < 50 && inHandler < 8; attempt += 1) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(inHandler).toBe(8)
    // Allow the 4 rejected promises a tick to return 429 before releasing slots.
    await new Promise((r) => setTimeout(r, 20))
    releaseGate()

    const responses = await responsesPromise
    const okResponses = responses.filter((r) => r.status === 200)
    const rateLimitedResponses = responses.filter((r) => r.status === 429)

    expect(okResponses).toHaveLength(8)
    expect(rateLimitedResponses).toHaveLength(4)

    for (const r of rateLimitedResponses) {
      const retryAfter = Number(r.headers.get('Retry-After'))
      expect(retryAfter).toBeGreaterThanOrEqual(2)
      expect(retryAfter).toBeLessThanOrEqual(10)
    }

    // Per-device concurrent cap of 1
    let releaseSingle!: () => void
    const singleGate = new Promise<void>((resolve) => {
      releaseSingle = resolve
    })
    let singleEntered = false
    onPinHandle = async () => {
      singleEntered = true
      await singleGate
    }

    const firstSameDev = handlePush(
      makePushHttpRequest(fx.devices[0]!.credential, {
        sent_at_device: new Date().toISOString(),
        clock_offset_ms: 0,
        commands: [pinCmd(101)],
      }),
    )
    for (let attempt = 0; attempt < 50 && !singleEntered; attempt += 1) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(singleEntered).toBe(true)

    const secondSameDev = await handlePush(
      makePushHttpRequest(fx.devices[0]!.credential, {
        sent_at_device: new Date().toISOString(),
        clock_offset_ms: 0,
        commands: [pinCmd(102)],
      }),
    )
    expect(secondSameDev.status).toBe(429)
    const retrySingle = Number(secondSameDev.headers.get('Retry-After'))
    expect(retrySingle).toBeGreaterThanOrEqual(2)
    expect(retrySingle).toBeLessThanOrEqual(10)

    releaseSingle()
    const firstDone = await firstSameDev
    expect(firstDone.status).toBe(200)

    // Follow-up AppendAudit after slots drain succeeds
    const followUp = await handlePush(
      makePushHttpRequest(fx.devices[0]!.credential, {
        sent_at_device: new Date().toISOString(),
        clock_offset_ms: 0,
        commands: [makeAuditEnvelope(103)],
      }),
    )
    expect(followUp.status).toBe(200)
  })
})
