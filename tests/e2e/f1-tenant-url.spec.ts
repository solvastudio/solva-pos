import { expect, test } from '@playwright/test'
import { loginAdminUi } from './helpers/admin'
import { pairDeviceViaUi } from './helpers/device'
import { readE2eState } from './helpers/seed'
import {
  clearActiveDevicesOnRegister,
  createPairingCodeDirect,
} from './helpers/server'

test.describe('F1-K01 K09 K10: Tenant URL routing, cross-tenant rejection, multi-tenant IndexedDB, and error boundary', () => {
  test('F1-K01 F1-K09 validates 404 root/unknown parity, 308 slug canonicalization, picker, suspended status, cross-tenant isolation, two tenants in one browser, and platform login', async ({
    browser,
    request,
    baseURL,
  }) => {
    const state = readE2eState()
    await clearActiveDevicesOnRegister(state.tenants.acme.id, state.tenants.acme.registerId)
    await clearActiveDevicesOnRegister(state.tenants.beta.id, state.tenants.beta.registerId)

    // 1. Root "/" and unknown slug "/xyz" must both return 404 with identical visible body.
    const rootRes = await request.get('/')
    const xyzRes = await request.get('/xyz')
    expect(rootRes.status()).toBe(404)
    expect(xyzRes.status()).toBe(404)
    const stripSsrScripts = (html: string) =>
      html
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<link rel="modulepreload"[^>]*>/g, '')
    expect(stripSsrScripts(await rootRes.text())).toBe(stripSsrScripts(await xyzRes.text()))

    // 2. Uppercase "/ACME/pos" canonicalizes with 308 to "/acme/pos".
    const canonRes = await request.get(`${baseURL}/ACME/pos`, { maxRedirects: 0 })
    expect(canonRes.status()).toBe(308)
    expect(canonRes.headers()['location']).toMatch(/\/acme\/pos$/)

    const ctx = await browser.newContext()
    try {
      const page = await ctx.newPage()

      // 3. Tenant picker "/acme" renders Acme Coffee with POS & Admin links.
      await page.goto('/acme')
      await expect(page.getByText('Acme Coffee')).toBeVisible()
      await expect(page.locator('a[href="/acme/pos"]')).toBeVisible()
      await expect(page.locator('a[href="/acme/admin"]')).toBeVisible()

      // 4. Suspended tenant "/beta" -> SCR-S01 suspended screen, then restored cleanly via /platform API.
      const opCtx = await browser.newContext()
      try {
        const opLoginRes = await opCtx.request.post(`${baseURL}/platform/api/auth/login`, {
          headers: { 'Content-Type': 'application/json', Origin: baseURL! },
          data: {
            email: state.platformAdmin.email,
            password: state.platformAdmin.password,
          },
        })
        expect(opLoginRes.status()).toBe(200)

        const suspendRes = await opCtx.request.post(
          `${baseURL}/platform/api/tenants/${state.tenants.beta.id}/status`,
          {
            headers: { 'Content-Type': 'application/json', Origin: baseURL! },
            data: { status: 'SUSPENDED' },
          },
        )
        expect(suspendRes.status()).toBe(200)

        await page.goto('/beta')
        await expect(page.locator('h1')).toContainText(/Suspended|Ditangguhkan|tidak tersedia/i)
      } finally {
        await opCtx.request.post(
          `${baseURL}/platform/api/tenants/${state.tenants.beta.id}/status`,
          {
            headers: { 'Content-Type': 'application/json', Origin: baseURL! },
            data: { status: 'ACTIVE' },
          },
        )
        await opCtx.close()
      }

      // 5. Cross-tenant admin isolation: budi@ logged into acme cannot access /beta/admin.
      await loginAdminUi(page, 'acme', state.users.budi.email, state.users.budi.password)
      await page.goto('/beta/admin')
      await page.waitForURL(/\/beta\/admin\/login/)

      // 6. Two tenants in ONE browser context: pair both acme and beta, verify isolated Dexie DBs.
      const codeAcme = await createPairingCodeDirect(
        state.tenants.acme.id,
        state.tenants.acme.registerId,
        state.users.budi.acmeAppUserId,
      )
      await pairDeviceViaUi(page, 'acme', codeAcme, 'E2E Dual Acme')

      const codeBeta = await createPairingCodeDirect(
        state.tenants.beta.id,
        state.tenants.beta.registerId,
        state.users.ani.betaAppUserId,
      )
      await pairDeviceViaUi(page, 'beta', codeBeta, 'E2E Dual Beta')

      const dbNames = await page.evaluate(async () => {
        const list = await indexedDB.databases()
        return list.map((d) => d.name ?? '').filter(Boolean)
      })
      expect(dbNames).toContain(`solva-pos:${state.tenants.acme.id}`)
      expect(dbNames).toContain(`solva-pos:${state.tenants.beta.id}`)

      // Check each route reads strictly its own tenant metadata
      const betaDev = await page.evaluate(() => window.__solva?.getMeta('device'))
      expect(betaDev?.tenant_id).toBe(state.tenants.beta.id)

      await page.goto('/acme/pos/login')
      await page.waitForFunction(
        (acmeId) => window.__solva?.db.name === `solva-pos:${acmeId}`,
        state.tenants.acme.id,
        { timeout: 10_000 },
      )
      const acmeDev = await page.evaluate(() => window.__solva?.getMeta('device'))
      expect(acmeDev?.tenant_id).toBe(state.tenants.acme.id)

      // 7. Platform operator login -> create new temp tenant (V-33 / V-39).
      await page.goto('/platform/login')
      await page.locator('input[type="email"]').fill(state.platformAdmin.email)
      await page.locator('input[type="password"]').fill(state.platformAdmin.password)
      await page.getByRole('button', { name: /Sign In|Masuk/i }).click()
      await page.waitForURL(
        (url) => url.pathname === '/platform' || url.pathname === '/platform/',
        { timeout: 15_000 },
      )

      await page.goto('/platform/tenants/new')
      const tempSlug = `e2e-${Date.now().toString(36)}`
      const inputs = page.locator('form input')
      await inputs.nth(0).fill('E2E Temp Cafe')
      await inputs.nth(1).fill(tempSlug)
      await inputs.nth(2).fill('Temp Owner')
      await inputs.nth(3).fill(`owner-${tempSlug}@example.test`)
      await page.locator('form button[type="submit"]').click()
      await expect(page.locator('body')).toContainText(tempSlug, { timeout: 10_000 })
    } finally {
      await clearActiveDevicesOnRegister(state.tenants.acme.id, state.tenants.acme.registerId)
      await clearActiveDevicesOnRegister(state.tenants.beta.id, state.tenants.beta.registerId)
      await ctx.close()
    }
  })

  test('F1-K10 renders ErrorBoundaryArea with copyable APP_ERROR#D-... ref on /_dev/error without page reload', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    })
    try {
      const page = await ctx.newPage()
      await page.goto('/error')
      await expect(page.locator('h1')).toBeVisible()

      await page.evaluate(() => {
        ;(window as unknown as { __solvaErrMarker?: number }).__solvaErrMarker = 99
      })
      await page.getByRole('button', { name: /Trigger render error|Picu error render/i }).click()

      const codeTextEl = page.locator('code', { hasText: /APP_ERROR#d-[a-z0-9-]+/i }).first()
      await expect(codeTextEl).toBeVisible()
      const displayedCode = ((await codeTextEl.textContent()) ?? '').trim()
      expect(displayedCode.toLowerCase()).toMatch(/^app_error#d-/)

      await page.getByRole('button', { name: /Copy|Salin/i }).first().click()
      const copied = await page.evaluate(() => navigator.clipboard.readText())
      expect(copied.toLowerCase()).toContain('app_error#d-')

      // No full reload occurred.
      expect(
        await page.evaluate(
          () => (window as unknown as { __solvaErrMarker?: number }).__solvaErrMarker,
        ),
      ).toBe(99)
    } finally {
      await ctx.close()
    }
  })
})
