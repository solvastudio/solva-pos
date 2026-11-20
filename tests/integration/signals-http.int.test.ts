import { webcrypto } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
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
import { getSignalsHub, writeMaster } from '~/modules/sync/public'
import { handleSignals } from '~/routes/api/pos/v1/signals'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-signals@example.test' }

async function setupTenantWithDevice(slug: string) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Sig ${slug}`,
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
  const le = await createLegalEntity(actor, { name: 'PT Signal', isPkp: false })
  const out = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 1',
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
    { slug, code: pairing.code, device_name: 'Sig-Dev' },
    '10.6.0.1',
    { minDelayMs: 0 },
  )
  resetLimitersForTests()
  return { tenantId: created.tenantId, credential: enrolled.credential }
}

afterEach(() => {
  getSignalsHub().resetForTests()
  __clearDeviceAuthCacheForTests()
  __clearTenantCacheForTests()
  resetLimitersForTests()
})

afterAll(async () => {
  getSignalsHub().resetForTests()
  resetCompositionForTests()
  await closePools()
})

describe('GET /api/pos/v1/signals (SSE)', () => {
  it('streams coalesced pull signal after writeMaster, isolates tenants, and closes superseded connection', async () => {
    composeServer()
    const tA = await setupTenantWithDevice(uniqueSlug('sig-a'))
    const tB = await setupTenantWithDevice(uniqueSlug('sig-b'))

    const makeReq = (cred: string) =>
      new Request('https://pos.solva.test/api/pos/v1/signals', {
        method: 'GET',
        headers: { Authorization: `Bearer ${cred}` },
      })

    const resA1 = await handleSignals(makeReq(tA.credential))
    expect(resA1.status).toBe(200)
    expect(resA1.headers.get('content-type')).toContain('text/event-stream')
    expect(resA1.headers.get('cache-control')).toBe('no-store')
    expect(resA1.headers.get('x-accel-buffering')).toBe('no')

    // Connecting again for same device must close the previous stream.
    const resA2 = await handleSignals(makeReq(tA.credential))
    const readerA1 = resA1.body!.getReader()
    const a1First = await readerA1.read()
    const a1Second = await readerA1.read()
    expect(a1First.done || a1Second.done).toBe(true)

    const resB = await handleSignals(makeReq(tB.credential))
    const readerA2 = resA2.body!.getReader()
    const readerB = resB.body!.getReader()
    const dec = new TextDecoder()

    // Consume initial ': connected' comment on both streams.
    await readerA2.read()
    await readerB.read()

    // Commit master change on tenant A only.
    const { version } = await withTenant(tA.tenantId, async (tx) =>
      writeMaster(tx, { actorUserId: null }, async () => 'done'),
    )

    // Wait > 500ms coalesce window and read next chunk on tenant A.
    const chunkA = await readerA2.read()
    expect(dec.decode(chunkA.value)).toContain(`"t":"pull","v":${version}`)

    // Tenant B must not receive tenant A's signal.
    const racedB = await Promise.race([
      readerB.read().then((r) => ({ gotData: !r.done, val: dec.decode(r.value) })),
      new Promise<{ gotData: false }>((resolve) => setTimeout(() => resolve({ gotData: false }), 150)),
    ])
    expect(racedB.gotData).toBe(false)

    await readerA2.cancel()
    await readerB.cancel()
  })
})
