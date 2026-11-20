import { expect, test } from '@playwright/test'
import { pairDeviceViaUi } from './helpers/device'
import { readE2eState } from './helpers/seed'
import { clearActiveDevicesOnRegister, createPairingCodeDirect } from './helpers/server'

const VIEWPORTS = [
  { name: 'phone', width: 360, height: 800 },
  { name: 'tablet-portrait', width: 800, height: 1280 },
  { name: 'tablet-landscape', width: 1280, height: 800 },
  { name: 'laptop', width: 1366, height: 768 },
] as const

test.describe('POS responsive viewports (360x800, 800x1280, 1280x800, 1366x768)', () => {
  test('renders pairing and login placeholder across 4 viewports with zero horizontal overflow', async ({
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
      await page.goto('/acme/pos/pair')

      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        )
        expect(overflow, `Pairing screen overflowed at ${vp.name}`).toBe(false)
      }

      await pairDeviceViaUi(page, 'acme', code, 'E2E Viewport POS')

      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        )
        expect(overflow, `POS login screen overflowed at ${vp.name}`).toBe(false)
      }
    } finally {
      await clearActiveDevicesOnRegister(state.tenants.acme.id, state.tenants.acme.registerId)
      await ctx.close()
    }
  })
})
