import { expect, test } from '@playwright/test'
import { pairDeviceViaUi } from './helpers/device'
import { readE2eState } from './helpers/seed'
import { clearActiveDevicesOnRegister, createPairingCodeDirect } from './helpers/server'

test.describe('Two-tab exclusive instance lock', () => {
  test('second POS tab shows duplicate_instance SCR-P15 and promotes automatically when first tab closes', async ({
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
      const page1 = await ctx.newPage()
      await pairDeviceViaUi(page1, 'acme', code, 'E2E Two Tabs')

      const page2 = await ctx.newPage()
      await page2.goto('/acme/pos/login')
      await page2.waitForURL(/\/acme\/pos\/system\?variant=duplicate_instance/, { timeout: 15_000 })
      await expect(page2.locator('h1')).toContainText(
        /Already open in another tab|Sudah (dibuka|terbuka) di tab lain/i,
      )

      // Closing primary tab promotes page2 automatically to /acme/pos/login!
      await page1.close()
      await page2.waitForURL(/\/acme\/pos\/login/, { timeout: 15_000 })
      await expect(page2.locator('h1')).toContainText(/Staff Sign In|Masuk Staf/i)
    } finally {
      await clearActiveDevicesOnRegister(state.tenants.acme.id, state.tenants.acme.registerId)
      await ctx.close()
    }
  })
})
