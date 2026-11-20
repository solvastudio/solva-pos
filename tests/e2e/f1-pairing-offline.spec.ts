import { expect, test } from '@playwright/test'
import { createPairingCodeViaAdminUi, loginAdminUi, revokeDeviceViaAdminUi } from './helpers/admin'
import { pairDeviceViaUi } from './helpers/device'
import { readE2eState } from './helpers/seed'
import { clearActiveDevicesOnRegister } from './helpers/server'

test.describe('F1-K03 & F1-K08: Device pairing, offline POS shell, and remote revocation', () => {
  test('F1-K03 F1-K08 pairs in admin, reloads login offline with zero network requests, displays app version, and locks on revoke', async ({
    browser,
  }) => {
    const state = readE2eState()
    await clearActiveDevicesOnRegister(state.tenants.acme.id, state.tenants.acme.registerId)

    const adminCtx = await browser.newContext()
    const posCtx = await browser.newContext()

    try {
      const adminPage = await adminCtx.newPage()
      await loginAdminUi(adminPage, 'acme', state.users.budi.email, state.users.budi.password)
      await adminPage.goto('/acme/admin/users')
      const pairCode = await createPairingCodeViaAdminUi(adminPage, 'POS01')

      const posPage = await posCtx.newPage()
      await pairDeviceViaUi(posPage, 'acme', pairCode, 'E2E Cashier K03')

      // K08: footer displays Solva POS v... version
      await expect(posPage.locator('footer')).toContainText(/Solva POS v/i)

      // Wait for initial boot sync cycle to finish before disconnecting network.
      await expect
        .poll(
          async () =>
            (await posPage.evaluate(() => window.__solva?.getSyncState().lastSuccessAt)) !== null,
          { timeout: 10_000 },
        )
        .toBe(true)

      await posCtx.setOffline(true)
      await posPage.close()

      // Fresh load of POS login offline in a new tab must be served purely by SW + Dexie with zero network failures.
      const offlinePage = await posCtx.newPage()
      const nonSwNetworkUrls: string[] = []
      const failedRequests: string[] = []
      offlinePage.on('response', (res) => {
        if (!res.fromServiceWorker() && !res.url().includes('/sw.js')) {
          nonSwNetworkUrls.push(`${res.status()} ${res.url()}`)
        }
      })
      offlinePage.on('requestfailed', (req) => {
        failedRequests.push(`${req.method()} ${new URL(req.url()).pathname}`)
      })

      const docRes = await offlinePage.goto('/acme/pos/login', { waitUntil: 'domcontentloaded' })
      expect(docRes?.fromServiceWorker()).toBe(true)
      expect(docRes?.headers()['x-from-sw']).toBe('1')
      await expect(offlinePage.locator('h1')).toContainText(/PIN/i)
      await expect(offlinePage.locator('footer')).toContainText(/Solva POS/i)

      expect(failedRequests).toEqual([])
      expect(nonSwNetworkUrls).toEqual([])

      // Go back online, revoke device in admin, kick sync -> SCR-P15 revoked screen.
      await posCtx.setOffline(false)
      await offlinePage.waitForFunction(() => Boolean((window as { __solva?: unknown }).__solva), {
        timeout: 15_000,
      })
      await adminPage.reload()
      await revokeDeviceViaAdminUi(adminPage, 'E2E Cashier K03')

      await offlinePage.evaluate(() => {
        window.__solva?.kickSync()
      })
      await offlinePage.waitForURL(/\/acme\/pos\/system/, { timeout: 20_000 })
      await expect(offlinePage.locator('h1')).toContainText(/Perangkat dicabut|Device access revoked/i)
    } finally {
      await clearActiveDevicesOnRegister(state.tenants.acme.id, state.tenants.acme.registerId)
      await adminCtx.close()
      await posCtx.close()
    }
  })
})
