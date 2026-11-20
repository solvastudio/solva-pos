import { expect, test } from '@playwright/test'
import { pairDeviceViaUi } from './helpers/device'
import { readE2eState } from './helpers/seed'
import { clearActiveDevicesOnRegister, createPairingCodeDirect } from './helpers/server'

test.describe('Offline cold start latency', () => {
  test('measures offline boot latency to POS login placeholder (soft <= 3000ms, hard <= 6000ms)', async ({
    browser,
  }, testInfo) => {
    const state = readE2eState()
    await clearActiveDevicesOnRegister(state.tenants.acme.id, state.tenants.acme.registerId)
    const code = await createPairingCodeDirect(
      state.tenants.acme.id,
      state.tenants.acme.registerId,
      state.users.budi.acmeAppUserId,
    )

    const ctx = await browser.newContext()
    try {
      const warmPage = await ctx.newPage()
      await pairDeviceViaUi(warmPage, 'acme', code, 'E2E Cold Start POS')
      await warmPage.close()

      await ctx.setOffline(true)
      const coldPage = await ctx.newPage()

      const t0 = Date.now()
      await coldPage.goto('/acme/pos/login', { waitUntil: 'domcontentloaded' })
      await expect(coldPage.locator('h1')).toContainText(/PIN/i)
      const durationMs = Date.now() - t0

      testInfo.annotations.push({
        type: 'cold_start_ms',
        description: `${durationMs}ms`,
      })
      process.stdout.write(`[f1-cold-start] Offline POS cold start: ${durationMs}ms\n`)

      if (durationMs > 3000) {
        process.stderr.write(
          `[f1-cold-start] WARNING: cold start exceeded soft target 3000ms (${durationMs}ms)\n`,
        )
      }
      expect(durationMs).toBeLessThanOrEqual(6000)
    } finally {
      await clearActiveDevicesOnRegister(state.tenants.acme.id, state.tenants.acme.registerId)
      await ctx.close()
    }
  })
})
