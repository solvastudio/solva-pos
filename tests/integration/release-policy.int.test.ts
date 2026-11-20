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
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import {
  __clearReleasePolicyCacheForTests,
  defaultReleasePolicy,
  getReleasePolicy,
} from '~/modules/sync/public'
import { handlePullRequest } from '~/routes/api/pos/v1/pull'
import { handlePush } from '~/routes/api/pos/v1/push'
import { handleGetRelease } from '~/routes/api/pos/v1/release'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { __resetPushLimitsForTests } from '~/server/auth/rate-limit/push-limits'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
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

const testOp = { platformUserId: testIdGen.newId(), email: 'op-release@example.test' }

async function setupDevice(slug: string) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Rel ${slug}`,
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
  const le = await createLegalEntity(actor, { name: 'PT Rel', isPkp: false })
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
    { slug, code: pair.code, device_name: 'Dev-Rel' },
    '10.8.0.1',
    { minDelayMs: 0 },
  )
  return {
    tenantId: created.tenantId,
    credential: enrolled.credential,
  }
}

describe('app_release policy & version enforcement integration', () => {
  beforeEach(async () => {
    resetCompositionForTests()
    composeServer()
    resetLimitersForTests()
    __resetPushLimitsForTests()
    __clearDeviceAuthCacheForTests()
    __clearTenantCacheForTests()
    __clearReleasePolicyCacheForTests()
    await withClient(ownerClient, async (c) => {
      await c.query('DELETE FROM app_release')
    })
  })

  afterEach(async () => {
    resetCompositionForTests()
    __clearReleasePolicyCacheForTests()
    await withClient(ownerClient, async (c) => {
      await c.query('DELETE FROM app_release')
    })
  })

  afterAll(async () => {
    await closePools()
  })

  it('returns default policy when app_release is empty and selects latest released_at row otherwise', async () => {
    expect(await getReleasePolicy()).toEqual(defaultReleasePolicy())

    await withClient(ownerClient, async (c) => {
      await c.query(
        `INSERT INTO app_release (app_version, schema_version, released_at, is_mandatory, min_supported_schema_version, min_supported_app_version)
         VALUES
           ('v1.5.0', 2, '2026-11-01T00:00:00Z', false, 1, 'v1.4.0'),
           ('v1.8.0', 3, '2026-12-01T00:00:00Z', true, 1, 'v1.6.0')`,
      )
    })

    __clearReleasePolicyCacheForTests()
    const policy = await getReleasePolicy()
    expect(policy.latest).toBe('v1.8.0')
    expect(policy.min_supported_app_version).toBe('v1.6.0')
    expect(policy.is_mandatory).toBe(true)
  })

  it('enforces min_supported_schema_version and min_supported_app_version with 426 + release block, and serves GET /release', async () => {
    const slug = uniqueSlug('rel-policy')
    const fx = await setupDevice(slug)

    // Case 1: min_supported_schema_version = 2 rejects X-Schema-Version: 1 with 426 + zero DB writes
    await withClient(ownerClient, async (c) => {
      await c.query(
        `INSERT INTO app_release (app_version, schema_version, released_at, is_mandatory, min_supported_schema_version, min_supported_app_version, accept_previous_until)
         VALUES ('v1.7.0', 2, '2026-12-01T00:00:00Z', true, 2, NULL, '2026-12-31T00:00:00Z')`,
      )
    })
    __clearReleasePolicyCacheForTests()

    const blockedCmdId = testIdGen.newId()
    const nowIso = new Date().toISOString()
    const pushSchemaOld = await handlePush(
      new Request('https://app.solva.test/api/pos/v1/push', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${fx.credential}`,
          'Content-Type': 'application/json',
          'X-Schema-Version': '1',
          'X-App-Version': 'v1.7.0',
        },
        body: JSON.stringify({
          sent_at_device: nowIso,
          clock_offset_ms: 0,
          commands: [
            {
              id: blockedCmdId,
              type: 'AppendAudit',
              schema_version: 1,
              device_seq: 1,
              depends_on: [],
              created_at_device: nowIso,
              payload: {
                entry: {
                  id: testIdGen.newId(),
                  action: 'drawer.opened',
                  entity_type: 'cash_drawer',
                  occurred_at: nowIso,
                },
              },
            },
          ],
        }),
      }),
    )
    expect(pushSchemaOld.status).toBe(426)
    expect(pushSchemaOld.headers.get('X-App-Version')).toBeTruthy()
    const schemaOldJson = (await pushSchemaOld.json()) as {
      error: { code: string; class: string }
      release: { latest: string; min_supported_schema_version: number }
    }
    expect(schemaOldJson.error.code).toBe('UPDATE_REQUIRED')
    expect(schemaOldJson.error.class).toBe('schema')
    expect(schemaOldJson.release.latest).toBe('v1.7.0')
    expect(schemaOldJson.release.min_supported_schema_version).toBe(2)

    await withTenant(fx.tenantId, async (tx) => {
      const idem = await tx.execute(
        sql`SELECT 1 FROM idempotency_command WHERE command_id = ${blockedCmdId}::uuid`,
      )
      expect(idem.rows).toHaveLength(0)
    })

    // Case 2: min_supported_app_version = v1.6.0 blocks v1.5.9 on BOTH push & pull, allows v1.6.0
    await withClient(ownerClient, async (c) => {
      await c.query(
        `UPDATE app_release
         SET min_supported_schema_version = 1, min_supported_app_version = 'v1.6.0'
         WHERE app_version = 'v1.7.0'`,
      )
    })
    __clearReleasePolicyCacheForTests()

    const pushOldApp = await handlePush(
      new Request('https://app.solva.test/api/pos/v1/push', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${fx.credential}`,
          'Content-Type': 'application/json',
          'X-Schema-Version': '1',
          'X-App-Version': 'v1.5.9',
        },
        body: JSON.stringify({ sent_at_device: nowIso, clock_offset_ms: 0, commands: [] }),
      }),
    )
    expect(pushOldApp.status).toBe(426)

    const pullOldApp = await handlePullRequest(
      new Request('https://app.solva.test/api/pos/v1/pull', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${fx.credential}`,
          'Content-Type': 'application/json',
          'X-Schema-Version': '1',
          'X-App-Version': 'v1.5.9',
        },
        body: JSON.stringify({ cursor: null, cycle: null, page_size: 100, attention_ids: [] }),
      }),
    )
    expect(pullOldApp.status).toBe(426)

    const pushValidApp = await handlePush(
      new Request('https://app.solva.test/api/pos/v1/push', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${fx.credential}`,
          'Content-Type': 'application/json',
          'X-Schema-Version': '1',
          'X-App-Version': 'v1.6.0',
        },
        body: JSON.stringify({ sent_at_device: nowIso, clock_offset_ms: 0, commands: [] }),
      }),
    )
    expect(pushValidApp.status).toBe(200)
    const pushValidJson = (await pushValidApp.json()) as { release: { latest: string } }
    expect(pushValidJson.release.latest).toBe('v1.7.0')

    const pullValidApp = await handlePullRequest(
      new Request('https://app.solva.test/api/pos/v1/pull', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${fx.credential}`,
          'Content-Type': 'application/json',
          'X-Schema-Version': '1',
          'X-App-Version': 'v1.6.0',
        },
        body: JSON.stringify({ cursor: null, cycle: null, page_size: 100, attention_ids: [] }),
      }),
    )
    expect(pullValidApp.status).toBe(200)
    const pullValidJson = (await pullValidApp.json()) as { release: { latest: string } }
    expect(pullValidJson.release.latest).toBe('v1.7.0')

    const releaseEndpointRes = await handleGetRelease(
      new Request('https://app.solva.test/api/pos/v1/release', {
        method: 'GET',
        headers: { Authorization: `Bearer ${fx.credential}` },
      }),
    )
    expect(releaseEndpointRes.status).toBe(200)
    expect(releaseEndpointRes.headers.get('X-App-Version')).toBeTruthy()
    const releaseEndpointJson = (await releaseEndpointRes.json()) as {
      release: { latest: string; min_supported_app_version: string }
    }
    expect(releaseEndpointJson.release.latest).toBe('v1.7.0')
    expect(releaseEndpointJson.release.min_supported_app_version).toBe('v1.6.0')
  })

  it('prevents solva_app_login from inserting or updating app_release directly', async () => {
    await expect(
      withClient(appClient, async (c) => {
        await c.query(
          `INSERT INTO app_release (app_version, schema_version, min_supported_schema_version)
           VALUES ('v9.9.9', 1, 1)`,
        )
      }),
    ).rejects.toThrow(/permission denied/i)
  })
})
