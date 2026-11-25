import { expect, test } from '@playwright/test'
import { pairDeviceViaUi } from './helpers/device'
import { loginStaffPin } from './helpers/pos'
import { createF5Tenant, F5_WAITER_NAME, F5_WAITER_PIN, f5PairingCodeFor } from './helpers/seed-f5'

test.use({ locale: 'id-ID' })

test.describe('F5-K05 WAITER register mode', () => {
  test('f5-pelayan: waiter opens bill without shift, restricted navigation, and forbidden routes redirect to tables', async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const t = await createF5Tenant('f5wtr')
    const code = await f5PairingCodeFor(t, t.waiterRegId)

    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await pairDeviceViaUi(page, t.slug, code, 'HP Pelayan')
    await loginStaffPin(page, F5_WAITER_NAME, F5_WAITER_PIN)

    // Lands directly on /pos/tables without requiring open shift
    await expect(page).toHaveURL(/\/pos\/tables/, { timeout: 15_000 })

    const nav = page.getByRole('navigation', { name: 'Navigasi Kasir' }).first()
    await expect(nav.getByRole('link', { name: 'Meja' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Bill' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Lain' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Jual' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Shift' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Riwayat' })).toHaveCount(0)

    // Client-side navigation to forbidden cashier route redirects back to tables while keeping active PIN session
    await page.evaluate((slug) => {
      window.history.pushState({}, '', `/${slug}/pos/sell`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, t.slug)
    await expect(page).toHaveURL(/\/pos\/tables/, { timeout: 15_000 })
  })
})
