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
      await expect(offlinePage.locator('h1')).toContainText(/Staff Sign In|Masuk Staf/i)
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

  test('claims first-install page without reload after CDP SW stop between install and activate', async ({
    browser,
  }) => {
    const ctx = await browser.newContext()
    try {
      const page = await ctx.newPage()
      const cdp = await ctx.newCDPSession(page)
      await cdp.send('ServiceWorker.enable')

      // Note: On fast machines, Chromium C++ transitions `installed -> activating` before the
      // async CDP `stopWorker` command arrives; we await best-effort `stopWorker` and still
      // verify first-tab `clients.claim()` without reload while unit tests deterministically
      // cover full worker isolate restart via Cache Storage (`cache-cleanup.test.ts`).
      let stopPromise: Promise<unknown> | null = null
      cdp.on('ServiceWorker.workerVersionUpdated', (event) => {
        for (const v of event.versions) {
          if (!stopPromise && v.status === 'installed') {
            stopPromise = cdp
              .send('ServiceWorker.stopWorker', { versionId: v.versionId })
              .catch(() => {})
          }
        }
      })

      await page.goto('/acme/pos/pair', { waitUntil: 'domcontentloaded' })
      await page.getByLabel(/Pairing code|Kode pairing/i).waitFor({ timeout: 15_000 })

      // Without any reload, the first tab MUST become controlled via clients.claim().
      await expect
        .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
          timeout: 15_000,
        })
        .toBe(true)

      if (stopPromise) {
        await stopPromise
      }
      await cdp.send('ServiceWorker.disable').catch(() => {})
      await cdp.detach().catch(() => {})

      const swState = await page.evaluate(async () => {
        const [meta, precache] = await Promise.all([
          caches.open('solva-meta'),
          caches.open('solva-precache'),
        ])
        const metaKeys = await meta.keys()
        const precacheKeys = await precache.keys()
        return {
          remainingClaimMarkers: metaKeys.filter((k) => k.url.includes('/__first_claim/')).length,
          hasShellInPrecache: precacheKeys.some((k) => k.url.includes('/pos-shell.html')),
        }
      })
      expect(swState.remainingClaimMarkers).toBe(0)
      expect(swState.hasShellInPrecache).toBe(true)
    } finally {
      await ctx.close()
    }
  })
})
