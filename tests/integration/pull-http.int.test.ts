import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
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
  getTenantAuthMetadataBySlug,
  redeemInvite,
  setTenantStatus,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { handlePullRequest } from '~/routes/api/pos/v1/pull'
import { handlePullFullPage } from '~/routes/api/pos/v1/pull.full.page'
import { handlePullFullStart } from '~/routes/api/pos/v1/pull.full.start'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { getRateLimitConfig } from '~/server/rate-limit-config'
import { uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-pull-http@example.test' }

async function setupHttpDevice(slug: string) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `PullHTTP ${slug}`,
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
  const le = await createLegalEntity(actor, { name: 'PT HTTP Pull', isPkp: false })
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
  const pair = await createPairingCode(actor, reg.id)
  const enrolled = await enrollDevice(
    { slug, code: pair.code, device_name: 'Dev-Pull' },
    '10.7.0.1',
    { minDelayMs: 0 },
  )
  return {
    tenantId: created.tenantId,
    deviceId: enrolled.device_id,
    credential: enrolled.credential,
  }
}

function makeReq(path: string, credential: string | null, body: unknown): Request {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Schema-Version': '1',
    'X-App-Version': 'v0.1.0',
    'X-Sync-Protocol': '1',
  })
  if (credential !== null) {
    headers.set('Authorization', `Bearer ${credential}`)
  }
  return new Request(`https://app.solva.test${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function makeReport(pushOk: boolean, pendingCount = 0) {
  return {
    push_ok: pushOk,
    pending_count: pendingCount,
    oldest_pending_at: pendingCount > 0 ? '2026-11-20T00:00:00.000Z' : null,
    attention_count: 1,
    storage_persist: 'GRANTED' as const,
    storage_used_pct: 12,
    last_error_code: null,
    last_error_ref: null,
    clock_offset_ms: -40,
    app_version: 'v0.1.0',
    schema_version: 1,
    sync_protocol_version: 1,
  }
}

describe('POST /api/pos/v1/pull* HTTP integration', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
    resetLimitersForTests()
    __clearDeviceAuthCacheForTests()
    __clearTenantCacheForTests()
  })

  afterEach(() => {
    resetCompositionForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('requires Bearer token, rejects client-injected outlet_id via .strict(), and updates device_sync_status on last page + push_ok=true', async () => {
    const slug = uniqueSlug('pull-http-rep')
    const fx = await setupHttpDevice(slug)

    const noAuth = await handlePullRequest(
      makeReq('/api/pos/v1/pull', null, {
        cursor: null,
        cycle: null,
        page_size: 100,
        attention_ids: [],
      }),
    )
    expect(noAuth.status).toBe(401)

    // Strict Zod rejection of client-supplied outlet_id
    for (const [path, handler, payload] of [
      [
        '/api/pos/v1/pull',
        handlePullRequest,
        { cursor: null, cycle: null, outlet_id: testIdGen.newId() },
      ],
      [
        '/api/pos/v1/pull/full/start',
        handlePullFullStart,
        { outlet_id: testIdGen.newId() },
      ],
      [
        '/api/pos/v1/pull/full/page',
        handlePullFullPage,
        {
          snapshot_token: 'abc',
          entity: 'outlet',
          after_id: null,
          outlet_id: testIdGen.newId(),
        },
      ],
    ] as const) {
      const bad = await handler(makeReq(path, fx.credential, payload))
      expect(bad.status).toBe(400)
      const json = (await bad.json()) as { error: { code: string } }
      expect(json.error.code).toBe('VALIDATION_FAILED')
    }

    // Intermediate page (has_more = true) with push_ok=true must NOT set last_success_sync_at
    const page1Res = await handlePullRequest(
      makeReq('/api/pos/v1/pull', fx.credential, {
        cursor: null,
        cycle: null,
        page_size: 2,
        attention_ids: [],
        report: makeReport(true, 4),
      }),
    )
    expect(page1Res.status).toBe(200)
    const p1 = (await page1Res.json()) as {
      upper: number
      has_more: boolean
      next_cursor: { version: number; id: string } | null
    }
    expect(p1.has_more).toBe(true)

    await withTenant(fx.tenantId, async (tx) => {
      const st = await tx.execute(
        sql`SELECT last_success_sync_at, pending_count, storage_persist, storage_used_pct
            FROM device_sync_status WHERE device_id = ${fx.deviceId}::uuid`,
      )
      expect(st.rows[0]!.last_success_sync_at).toBeNull()
      expect(Number(st.rows[0]!.pending_count)).toBe(4)
      expect(st.rows[0]!.storage_persist).toBe('GRANTED')
      expect(Number(st.rows[0]!.storage_used_pct)).toBe(12)
    })

    // Final page with push_ok=false also keeps last_success_sync_at = null
    const pushFalseRes = await handlePullRequest(
      makeReq('/api/pos/v1/pull', fx.credential, {
        cursor: p1.next_cursor,
        cycle: { id: 'c-http', upper: p1.upper },
        page_size: 500,
        attention_ids: [],
        report: makeReport(false, 2),
      }),
    )
    expect(pushFalseRes.status).toBe(200)
    const pushFalseJson = (await pushFalseRes.json()) as {
      has_more: boolean
      next_cursor: { version: number; id: string } | null
    }
    expect(pushFalseJson.has_more).toBe(false)

    await withTenant(fx.tenantId, async (tx) => {
      const st = await tx.execute(
        sql`SELECT last_success_sync_at, pending_count FROM device_sync_status WHERE device_id = ${fx.deviceId}::uuid`,
      )
      expect(st.rows[0]!.last_success_sync_at).toBeNull()
      expect(Number(st.rows[0]!.pending_count)).toBe(2)
    })

    // Final page with push_ok=true sets last_success_sync_at
    const finalOkRes = await handlePullRequest(
      makeReq('/api/pos/v1/pull', fx.credential, {
        cursor: pushFalseJson.next_cursor,
        cycle: null,
        page_size: 500,
        attention_ids: [],
        report: makeReport(true, 0),
      }),
    )
    expect(finalOkRes.status).toBe(200)

    await withTenant(fx.tenantId, async (tx) => {
      const st = await tx.execute(
        sql`SELECT last_success_sync_at, pending_count, oldest_pending_at
            FROM device_sync_status WHERE device_id = ${fx.deviceId}::uuid`,
      )
      expect(st.rows[0]!.last_success_sync_at).not.toBeNull()
      expect(Number(st.rows[0]!.pending_count)).toBe(0)
      expect(st.rows[0]!.oldest_pending_at).toBeNull()
    })
  })

  it('enforces devicePull and fullResync rate limits (429 + Retry-After) and TENANT_SUSPENDED (403)', async () => {
    const slug = uniqueSlug('pull-http-rl')
    const fx = await setupHttpDevice(slug)
    const maxPullPerMin = getRateLimitConfig().devicePullPerMin

    // Full resync start: 1st -> 200, 2nd -> 429 with Retry-After
    const fs1 = await handlePullFullStart(makeReq('/api/pos/v1/pull/full/start', fx.credential, {}))
    expect(fs1.status).toBe(200)
    const fs1Json = (await fs1.json()) as { snapshot_token: string }
    const fp1 = await handlePullFullPage(
      makeReq('/api/pos/v1/pull/full/page', fx.credential, {
        snapshot_token: fs1Json.snapshot_token,
        entity: 'outlet',
        after_id: null,
        page_size: 10,
      }),
    )
    expect(fp1.status).toBe(200)

    const fs2 = await handlePullFullStart(makeReq('/api/pos/v1/pull/full/start', fx.credential, {}))
    expect(fs2.status).toBe(429)
    expect(Number(fs2.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)

    resetLimitersForTests()

    // Exhaust devicePull limit
    for (let i = 0; i < maxPullPerMin; i += 1) {
      const ok = await handlePullRequest(
        makeReq('/api/pos/v1/pull', fx.credential, {
          cursor: null,
          cycle: null,
          page_size: 500,
          attention_ids: [],
        }),
      )
      expect(ok.status).toBe(200)
    }
    const overLimit = await handlePullRequest(
      makeReq('/api/pos/v1/pull', fx.credential, {
        cursor: null,
        cycle: null,
        page_size: 500,
        attention_ids: [],
      }),
    )
    expect(overLimit.status).toBe(429)
    expect(Number(overLimit.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)

    // Suspended tenant -> 403 TENANT_SUSPENDED
    resetLimitersForTests()
    __clearDeviceAuthCacheForTests()
    await setTenantStatus(testOp, fx.tenantId, 'SUSPENDED')
    const suspendedRes = await handlePullRequest(
      makeReq('/api/pos/v1/pull', fx.credential, {
        cursor: null,
        cycle: null,
        page_size: 500,
        attention_ids: [],
      }),
    )
    expect(suspendedRes.status).toBe(403)
    const suspJson = (await suspendedRes.json()) as { error: { code: string } }
    expect(suspJson.error.code).toBe('TENANT_SUSPENDED')
  })
})
