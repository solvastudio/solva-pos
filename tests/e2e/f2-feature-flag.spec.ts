import { expect, test } from '@playwright/test'
import { createThreeOutletE2eTenant } from '../../scripts/bench/seed-catalog'
import { loginAdminUi } from './helpers/admin'
import { pairDeviceViaUi } from './helpers/device'
import { createPairingCodeDirect, listAuditLogsByAction } from './helpers/server'

test.describe('F2-K06 tenant feature flags sync, offline read-only, and auditability', () => {
  test('F2-K06 syncs e2e.sample flag, stays cached offline, ignores POS writes, and logs audit trail', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const ownerPassword = 'SolvaE2eOwner#123!'
    const tenant = await createThreeOutletE2eTenant('f2k06', { ownerPassword })
    const code = await createPairingCodeDirect(
      tenant.tenantId,
      tenant.registerAId,
      tenant.actorUserId,
    )

    const adminCtx = await browser.newContext()
    const posCtx = await browser.newContext()
    try {
      const posPage = await posCtx.newPage()
      await pairDeviceViaUi(posPage, tenant.slug, code, 'E2E Cashier K06')

      // Default false when unset + POS has no flag write method
      expect(await posPage.evaluate(() => window.__solva!.featureEnabled('e2e.sample'))).toBe(false)
      const hasFlagWriteApi = await posPage.evaluate(() => {
        const s = window.__solva as unknown as Record<string, unknown>
        return Boolean(s.setFeatureFlag || s.clearFeatureFlag || s.writeFeatureFlag)
      })
      expect(hasFlagWriteApi).toBe(false)

      // Owner enables 'e2e.sample' in /admin/features
      const adminPage = await adminCtx.newPage()
      await loginAdminUi(adminPage, tenant.slug, tenant.ownerEmail, ownerPassword)
      await adminPage.goto(`/${tenant.slug}/admin/features`, { waitUntil: 'networkidle' })
      await expect(adminPage.getByText('e2e.sample')).toBeVisible()

      const flagSwitch = adminPage.getByRole('switch').first()
      await flagSwitch.click()
      await expect(flagSwitch).toHaveAttribute('aria-checked', 'true')

      // Audit log records feature_flag.changed
      const logs = await listAuditLogsByAction(tenant.tenantId, 'feature_flag.changed')
      expect(logs.length).toBeGreaterThanOrEqual(1)

      // Device online receives true after sync cycle
      await expect
        .poll(
          async () => {
            await posPage.evaluate(() => window.__solva!.kickSync())
            return posPage.evaluate(() => window.__solva!.featureEnabled('e2e.sample'))
          },
          { timeout: 20_000, intervals: [500] },
        )
        .toBe(true)

      // Device goes offline -> keeps cached value true even after Owner turns flag OFF
      await posCtx.setOffline(true)
      expect(await posPage.evaluate(() => window.__solva!.featureEnabled('e2e.sample'))).toBe(true)

      await flagSwitch.click()
      await expect(flagSwitch).toHaveAttribute('aria-checked', 'false')

      // Still offline -> stays true until reconnect + pull
      expect(await posPage.evaluate(() => window.__solva!.featureEnabled('e2e.sample'))).toBe(true)

      await posCtx.setOffline(false)
      await expect
        .poll(
          async () => {
            await posPage.evaluate(() => window.__solva!.kickSync())
            return posPage.evaluate(() => window.__solva!.featureEnabled('e2e.sample'))
          },
          { timeout: 20_000, intervals: [500] },
        )
        .toBe(false)
    } finally {
      await adminCtx.close()
      await posCtx.close()
    }
  })
})
