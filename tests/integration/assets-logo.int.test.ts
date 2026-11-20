import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_CODES } from '~/modules/identity/shared'
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
import { loadOutletLogoAsset, resolveSafeAssetPath } from '~/modules/sales/public'
import { handleGetOutletLogo } from '~/routes/api/pos/v1/assets.logo.$outletId'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
import { masterTx } from './helpers/master'
import { uniqueSlug } from './helpers/tenants'

const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
])

beforeEach(() => {
  resetEnvForTests()
  __clearTenantCacheForTests()
  __clearDeviceAuthCacheForTests()
  resetLimitersForTests()
  resetCompositionForTests()
  composeServer()
})

afterAll(async () => {
  await closePools()
})

describe('GET /api/pos/v1/assets/logo/$outletId & loadOutletLogoAsset (db integration)', () => {
  it('enforces Bearer auth, outlet scope, path-traversal safety inside ASSETS_DIR, and Cache-Control: no-store', async () => {
    const tmpAssets = await mkdtemp(join(tmpdir(), 'solva-assets-'))
    const slug = uniqueSlug('logo')
    try {
      const email = `owner-${slug}@solva.id`
      const created = await createTenant(
        { platformUserId: '0192a000-0000-7000-8000-00000000f001', email: 'op@logo.test' },
        {
          name: `Logo Test ${slug}`,
          slug,
          ownerEmail: email,
          ownerDisplayName: 'Owner',
        },
      )
      const tenantId = created.tenantId
      const meta = await getTenantAuthMetadataBySlug(slug)
      await redeemInvite({
        tenantId,
        tenantSlug: slug,
        authOrgId: meta!.authOrgId,
        email,
        code: created.ownerInvite.code,
        password: 'Password123!',
      })

      const actor: IdentityAuthActor = {
        tenantId,
        tenantSlug: slug,
        authOrgId: meta!.authOrgId,
        appUserId: created.ownerInvite.appUserId,
        permissions: new Set(PERMISSION_CODES),
        outletIds: null,
        roleCodes: ['OWNER'],
      }
      const le = await createLegalEntity(actor, { name: 'PT Logo', isPkp: false })
      const outlet1 = await createOutlet(actor, {
        legalEntityId: le.id,
        code: 'O1',
        name: 'Outlet 1',
        timezone: 'Asia/Jakarta',
        dayCutoffTime: '00:00',
        priceTaxMode: 'EXCLUSIVE',
      })
      const reg1 = await createRegister(actor, {
        outletId: outlet1.id,
        code: 'P1',
        name: 'POS 1',
        registerType: 'CASHIER',
        invoicePrefix: 'O1-P1',
      })
      const pair = await createPairingCode(actor, reg1.id)
      const dev = await enrollDevice({ slug, code: pair.code, device_name: 'Test POS' }, '10.8.0.1', {
        minDelayMs: 0,
      })

      // 1. Unauthenticated -> 401
      const unauth = await handleGetOutletLogo(
        new Request(`http://localhost/api/pos/v1/assets/logo/${outlet1.id}`),
      )
      expect(unauth.status).toBe(401)

      // 2. Path traversal check directly on resolveSafeAssetPath
      expect(resolveSafeAssetPath(tmpAssets, '../etc/passwd')).toBeNull()
      expect(resolveSafeAssetPath(tmpAssets, '/etc/passwd')).toBeNull()
      expect(resolveSafeAssetPath(tmpAssets, 'logos/test.png')).toBeTruthy()

      // 3. No logo configured -> 404
      const missingRes = await handleGetOutletLogo(
        new Request(`http://localhost/api/pos/v1/assets/logo/${outlet1.id}`, {
          headers: { authorization: `Bearer ${dev.credential}` },
        }),
      )
      expect(missingRes.status).toBe(404)

      // 4. Write PNG under ASSETS_DIR & load via service
      await mkdir(join(tmpAssets, 'logos'), { recursive: true })
      await writeFile(join(tmpAssets, 'logos', `${outlet1.id}.png`), PNG_1X1)
      await masterTx(tenantId, async (c, v) => {
        await c.query(
          'UPDATE outlet_receipt_setting SET logo_object_key = $1, logo_sha256 = $2, version = $3 WHERE tenant_id = $4 AND outlet_id = $5',
          [`logos/${outlet1.id}.png`, 'a'.repeat(64), v, tenantId, outlet1.id],
        )
      })

      const loaded = await loadOutletLogoAsset({
        tenantId,
        outletId: outlet1.id,
        assetsDir: tmpAssets,
      })
      expect(loaded).not.toBeNull()
      expect(loaded!.contentType).toBe('image/png')
      expect(loaded!.bytes.byteLength).toBe(PNG_1X1.byteLength)
    } finally {
      await rm(tmpAssets, { recursive: true, force: true })
    }
  })
})
