import { expect, test } from '@playwright/test'
import { listDevices, revokeDevice } from '../../src/modules/identity/public'
import { loginAdminUi } from './helpers/admin'
import { pairDeviceViaUi } from './helpers/device'
import { loginStaffPin, waitOutboxAllAcked } from './helpers/pos'
import {
  createF5Tenant,
  F5_OWNER_PASSWORD,
  F5_WAITER_NAME,
  F5_WAITER_PIN,
  f5PairingCodeFor,
} from './helpers/seed-f5'

test.use({ locale: 'id-ID' })

test.describe('F5-L07 R-04 orphan bill on revoked device (RSK-04)', () => {
  test('f5-rsk04: waiter opens bill, device is revoked, admin sees orphan bill without takeover or force-close actions', async ({
    browser,
  }) => {
    test.setTimeout(240_000)
    const t = await createF5Tenant('f5rsk')
    const wCode = await f5PairingCodeFor(t, t.waiterRegId)

    const wCtx = await browser.newContext()
    const wPage = await wCtx.newPage()
    await pairDeviceViaUi(wPage, t.slug, wCode, 'HP Waiter Hilang')
    await loginStaffPin(wPage, F5_WAITER_NAME, F5_WAITER_PIN)

    await wPage.getByRole('button', { name: /M05/ }).click()
    await wPage.getByRole('button', { name: 'Buka bill baru di meja ini' }).click()
    await wPage.getByRole('region', { name: 'Katalog produk' }).getByRole('button', { name: /Es Teh/ }).click()
    await waitOutboxAllAcked(wPage, 60_000)

    // Revoke the waiter device from server identity module (lost device RSK-04)
    const devices = await listDevices(t.ownerActor)
    const waiterDevice = devices.find((d) => d.registerId === t.waiterRegId)!
    await revokeDevice(t.ownerActor, {
      deviceId: waiterDevice.id,
      reasonCode: 'LOST',
    })

    // Manager views /admin/tables -> anomaly tab -> sees revoked device orphan bill
    const aCtx = await browser.newContext()
    const aPage = await aCtx.newPage()
    await loginAdminUi(aPage, t.slug, `owner-${t.slug}@example.test`, F5_OWNER_PASSWORD)
    await aPage.goto(`/${t.slug}/admin/tables`, { waitUntil: 'networkidle' })
    await aPage.getByRole('tab', { name: /Bill Orphan/i }).click()

    await expect(aPage.getByText('HP Waiter Hilang').first()).toBeVisible({ timeout: 15_000 })
    await expect(aPage.getByText('Perangkat dicabut').first()).toBeVisible()
    await expect(aPage.getByRole('button', { name: /ambil alih|tutup paksa/i })).toHaveCount(0)
  })
})
