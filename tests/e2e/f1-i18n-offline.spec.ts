import { expect, test } from '@playwright/test'
import { pairDeviceViaUi } from './helpers/device'
import { readE2eState } from './helpers/seed'
import { clearActiveDevicesOnRegister, createPairingCodeDirect } from './helpers/server'

test.describe('F1-K06: Instant offline i18n language switch without reload', () => {
  test('F1-K06 toggles ID|EN offline <= 200ms without page reload or network traffic', async ({
    browser,
  }) => {
    const state = readE2eState()
    await clearActiveDevicesOnRegister(state.tenants.acme.id, state.tenants.acme.registerId)
    const code = await createPairingCodeDirect(
      state.tenants.acme.id,
      state.tenants.acme.registerId,
      state.users.budi.acmeAppUserId,
    )

    const ctx = await browser.newContext()
    try {
      const page = await ctx.newPage()
      await pairDeviceViaUi(page, 'acme', code, 'E2E Cashier K06')

      // Wait for post-paint sync engine startup requests to settle before switching offline.
      await expect
        .poll(
          async () => (await page.evaluate(() => window.__solva?.getSyncState().lastSuccessAt)) !== null,
          { timeout: 10_000 },
        )
        .toBe(true)

      await ctx.setOffline(true)
      await page.waitForTimeout(200)

      let networkCount = 0
      let loadEvents = 0
      page.on('request', () => {
        networkCount += 1
      })
      page.on('load', () => {
        loadEvents += 1
      })

      await page.evaluate(() => {
        ;(window as unknown as { __solvaLangMarker?: number }).__solvaLangMarker = 42
      })

      const tStart = await page.evaluate(() => performance.now())
      await page.getByRole('button', { name: 'EN', exact: true }).click()
      await expect(page.locator('h1')).toContainText('Sign in with PIN')
      const tMid = await page.evaluate(() => performance.now())
      expect(tMid - tStart).toBeLessThanOrEqual(200)

      await page.getByRole('button', { name: 'ID', exact: true }).click()
      await expect(page.locator('h1')).toContainText('Masuk dengan PIN')
      const tEnd = await page.evaluate(() => performance.now())
      expect(tEnd - tMid).toBeLessThanOrEqual(200)

      expect(networkCount).toBe(0)
      expect(loadEvents).toBe(0)
      expect(
        await page.evaluate(
          () => (window as unknown as { __solvaLangMarker?: number }).__solvaLangMarker,
        ),
      ).toBe(42)

      // Locale persisted offline in Dexie meta.locale
      const storedLocale = await page.evaluate(() => window.__solva?.getMeta('locale'))
      expect(storedLocale).toBe('id-ID')
    } finally {
      await clearActiveDevicesOnRegister(state.tenants.acme.id, state.tenants.acme.registerId)
      await ctx.close()
    }
  })
})
