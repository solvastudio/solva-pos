import { webcrypto } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import { __clearTenantCacheForTests, createTenant, setTenantStatus } from '~/modules/identity/public'
import { handleTenantManifestRequest } from '~/routes/$tenant/pos/manifest[.]webmanifest'
import { resetCompositionForTests } from '~/server/composition'
import { closePools } from '~/server/db'
import { PWA_THEME_COLOR } from '~/server/pwa/manifest'
import { uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-manifest@example.test' }

afterEach(() => {
  __clearTenantCacheForTests()
})

afterAll(async () => {
  resetCompositionForTests()
  await closePools()
})

describe('GET /<slug>/pos/manifest.webmanifest', () => {
  it('returns active tenant manifest with application/manifest+json and 404 for unknown/non-active tenants', async () => {
    const slug = uniqueSlug('pwa-manifest')
    const created = await createTenant(testOp, {
      name: 'Kopi Pagi Berseri',
      slug,
      ownerEmail: `owner-${slug}@example.test`,
      ownerDisplayName: 'Owner',
    })

    const reqOk = new Request(`https://pos.solva.test/${slug}/pos/manifest.webmanifest`)
    const resOk = await handleTenantManifestRequest(reqOk, slug)
    expect(resOk.status).toBe(200)
    expect(resOk.headers.get('content-type')).toContain('application/manifest+json')
    expect(resOk.headers.get('cache-control')).toBe('no-cache')

    const body = (await resOk.json()) as Record<string, unknown>
    expect(body.scope).toBe(`/${slug}/pos/`)
    expect(body.start_url).toBe(`/${slug}/pos/`)
    expect(body.id).toBe(`/${slug}/pos/`)
    expect(body.name).toBe('Kopi Pagi Berseri')
    expect(body.theme_color).toBe(PWA_THEME_COLOR)
    expect(body.background_color).toBe(PWA_THEME_COLOR)
    expect('color' in body).toBe(false)
    expect('logo' in body).toBe(false)

    // Unknown tenant returns 404
    const resUnknown = await handleTenantManifestRequest(
      new Request('https://pos.solva.test/non-existent-tenant-xyz/pos/manifest.webmanifest'),
      'non-existent-tenant-xyz',
    )
    expect(resUnknown.status).toBe(404)

    // Suspended tenant returns generic 404
    await setTenantStatus(testOp, created.tenantId, 'SUSPENDED')
    __clearTenantCacheForTests()
    const resSuspended = await handleTenantManifestRequest(reqOk, slug)
    expect(resSuspended.status).toBe(404)
  })
})
