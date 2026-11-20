import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { loginAdminUi } from './helpers/admin'
import { readE2eState } from './helpers/seed'

test.describe('F1-K07 K11 K12: Request ID logging, rate limits, global identity & multi-tenant sessions', () => {
  test('F1-K07 emits X-Request-Id header matching structured JSON log file reqId without leaking secrets', async ({
    request,
  }) => {
    const state = readE2eState()
    const res = await request.get('/acme')
    expect(res.status()).toBe(200)
    const reqId = res.headers()['x-request-id']
    expect(reqId).toBeTruthy()

    // Wait briefly for buffered pino stream flush, then locate reqId across E2E logs.
    await expect
      .poll(() => {
        const files = readdirSync(state.logDir).filter((f) => f.endsWith('.log') || f.includes('app'))
        for (const f of files) {
          const lines = readFileSync(join(state.logDir, f), 'utf8').split(/\r?\n/).filter(Boolean)
          for (const line of lines) {
            const obj = JSON.parse(line) as { reqId?: string; password?: unknown }
            if (obj.reqId === reqId) {
              expect(obj.password).toBeUndefined()
              return true
            }
          }
        }
        return false
      }, { timeout: 8_000 })
      .toBe(true)
  })

  test('F1-K11 shows uniform minute-based rate-limit message after 4 wrong logins on an isolated email', async ({
    browser,
  }) => {
    const ctx = await browser.newContext()
    try {
      const page = await ctx.newPage()
      await page.goto('/acme/admin/login', { waitUntil: 'networkidle' })
      const probeEmail = `rl-${Date.now()}@example.test`
      const emailInput = page.locator('input[type="email"]')
      const passInput = page.locator('input[type="password"]')
      await emailInput.fill(probeEmail)
      await passInput.fill('WrongPassword99!')
      await expect(emailInput).toHaveValue(probeEmail)
      await expect(passInput).toHaveValue('WrongPassword99!')

      for (let i = 0; i < 5; i += 1) {
        const resPromise = page.waitForResponse((res) =>
          res.url().includes('/api/auth/sign-in/email'),
        )
        await page.getByRole('button', { name: /Sign In|Masuk/i }).click()
        const res = await resPromise
        await expect(page.locator('[role="alert"]')).toBeVisible()
        if (res.status() === 429) break
      }

      // After 4 failed attempts, the 5th attempt hits RATE_LIMITED minute message
      await expect(page.locator('[role="alert"]')).toContainText(/minute|menit/i)
    } finally {
      await ctx.close()
    }
  })

  test('F1-K12 enforces isolated per-tenant sessions, uniform wrong-tenant login error, invite->join, reset guard, remove member, and global reset session revocation', async ({
    browser,
  }) => {
    const state = readE2eState()

    // 1. Wrong tenant error parity: citra@ (member of acme only) on /beta vs nonexistent account -> identical message.
    const checkCtx = await browser.newContext()
    try {
      const checkPage = await checkCtx.newPage()
      await checkPage.goto('/beta/admin/login', { waitUntil: 'networkidle' })
      await checkPage.locator('input[type="email"]').fill(state.users.citra.email)
      await checkPage.locator('input[type="password"]').fill(state.users.citra.password)
      await checkPage.getByRole('button', { name: /Sign In|Masuk/i }).click()
      const msgCitra = ((await checkPage.locator('[role="alert"]').textContent()) ?? '').trim()

      await checkPage.locator('input[type="email"]').fill(`ghost-${Date.now()}@example.test`)
      await checkPage.locator('input[type="password"]').fill('AnyWrongPass123!')
      await checkPage.getByRole('button', { name: /Sign In|Masuk/i }).click()
      const msgGhost = ((await checkPage.locator('[role="alert"]').textContent()) ?? '').trim()

      expect(msgCitra.length).toBeGreaterThan(0)
      expect(msgCitra).toBe(msgGhost)
    } finally {
      await checkCtx.close()
    }

    // 2. ani@ logs into acme and beta simultaneously; signing out beta keeps acme session active.
    const aniCtx = await browser.newContext()
    try {
      const pageAcme = await aniCtx.newPage()
      await loginAdminUi(pageAcme, 'acme', state.users.ani.email, state.users.ani.password)
      const pageBeta = await aniCtx.newPage()
      await loginAdminUi(pageBeta, 'beta', state.users.ani.email, state.users.ani.password)

      await pageBeta.getByRole('button', { name: /Sign out|Keluar/i }).click()
      await pageBeta.waitForURL(/\/beta\/admin\/login/)

      // acme stays authenticated
      await pageAcme.reload()
      await expect(pageAcme).toHaveURL(/\/acme\/admin(?:\?|$|\/)/)
    } finally {
      await aniCtx.close()
    }

    // 3. Budi invites Dewi -> Dewi redeems via /acme/join -> logs in -> Budi fails to reset multi-tenant ani@ -> removes Dewi -> Dewi session rejected.
    const adminCtx = await browser.newContext()
    const dewiCtx = await browser.newContext()
    const dewiEmail = `dewi-${Date.now()}@example.test`
    const dewiPassword = `Dewi-${randomBytes(8).toString('base64url')}!`

    try {
      const adminPage = await adminCtx.newPage()
      await loginAdminUi(adminPage, 'acme', state.users.budi.email, state.users.budi.password)
      await adminPage.goto('/acme/admin/users')

      // Check reset guard against multi-tenant member ani@ in Users tab
      const aniRow = adminPage.locator('tr', { hasText: 'ani@example.test' }).first()
      await expect(aniRow).toBeVisible()
      await aniRow.getByRole('button', { name: /reset|atur ulang/i }).click()
      await adminPage
        .getByRole('button', { name: /Issue reset code|Terbitkan kode atur ulang/i })
        .last()
        .click()
      await expect(adminPage.locator('body')).toContainText(/Platform Operator|Operator Platform/i)
      await adminPage.keyboard.press('Escape')

      // Invite Dewi
      await adminPage.getByRole('button', { name: /Invite member|Undang anggota/i }).click()
      const modalInputs = adminPage.locator('[role="dialog"] input')
      await modalInputs.nth(0).fill(dewiEmail)
      await modalInputs.nth(1).fill('Dewi Staff')
      const roleSelect = adminPage.locator('[role="dialog"] select').first()
      const roleOpts = await roleSelect.locator('option').all()
      for (const opt of roleOpts) {
        const val = await opt.getAttribute('value')
        if (val) {
          await roleSelect.selectOption(val)
          break
        }
      }
      await adminPage.getByRole('button', { name: /Create invitation code|Buat kode undangan/i }).click()

      const inviteDialog = adminPage.getByRole('dialog').last()
      const inviteCodeEl = inviteDialog
        .locator('p', { hasText: /^[A-Z0-9]{5}-[A-Z0-9]{5}$/ })
        .first()
      await expect(inviteCodeEl).toBeVisible()
      const inviteCodeText = ((await inviteCodeEl.textContent()) ?? '').trim()
      expect(inviteCodeText).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/)
      await inviteDialog.getByRole('button', { name: /Close|Tutup/i }).first().click()

      // Dewi opens /acme/join, redeems invite, and logs in
      const dewiPage = await dewiCtx.newPage()
      await dewiPage.goto('/acme/join', { waitUntil: 'networkidle' })
      const dewiInputs = dewiPage.locator('form input')
      await dewiInputs.nth(0).fill(dewiEmail)
      await dewiInputs.nth(1).fill(inviteCodeText)
      await dewiInputs.nth(2).fill(dewiPassword)
      await expect(dewiInputs.nth(0)).toHaveValue(dewiEmail)
      const joinResPromise = dewiPage.waitForResponse(
        (res) => res.url().includes('/api/join') && res.request().method() === 'POST',
      )
      await dewiPage.locator('form button[type="submit"]').click()
      expect((await joinResPromise).status()).toBe(200)
      await dewiPage.waitForURL(
        (url) => url.pathname.startsWith('/acme/admin') && !url.pathname.endsWith('/login'),
        { timeout: 10_000 },
      )

      // Remove Dewi from Acme
      await adminPage.reload()
      const dewiRow = adminPage.locator('tr', { hasText: dewiEmail }).first()
      await expect(dewiRow).toBeVisible()
      await dewiRow.getByRole('button', { name: /Remove|Keluarkan/i }).click()
      await adminPage.getByRole('button', { name: /Remove member|Keluarkan anggota/i }).last().click()
      await expect(dewiRow).toBeHidden()

      // Dewi's next request is rejected -> redirected to login
      await dewiPage.reload()
      await dewiPage.waitForURL(/\/acme\/admin\/login/, { timeout: 10_000 })
    } finally {
      await adminCtx.close()
      await dewiCtx.close()
    }

    // 4. Platform Operator reset on multi-tenant ani@ -> /beta/reset revokes active sessions.
    const resetCtx = await browser.newContext()
    try {
      const origin = state.baseUrl
      const opLoginRes = await resetCtx.request.post(`${origin}/platform/api/auth/login`, {
        headers: { 'Content-Type': 'application/json', Origin: origin },
        data: {
          email: state.platformAdmin.email,
          password: state.platformAdmin.password,
        },
      })
      expect(opLoginRes.status()).toBe(200)

      const resetIssueRes = await resetCtx.request.post(
        `${origin}/platform/api/tenants/${state.tenants.beta.id}/reset-code`,
        {
          headers: { 'Content-Type': 'application/json', Origin: origin },
          data: { appUserId: state.users.ani.betaAppUserId },
        },
      )
      expect(resetIssueRes.status()).toBe(200)
      const resetCodeRes = (await resetIssueRes.json()) as { code: string }

      const aniSessionPage = await resetCtx.newPage()
      await loginAdminUi(aniSessionPage, 'acme', state.users.ani.email, state.users.ani.password)

      const resetPage = await resetCtx.newPage()
      await resetPage.goto('/beta/reset', { waitUntil: 'networkidle' })
      const newAniPw = `AniReset-${randomBytes(8).toString('base64url')}!`
      const rInputs = resetPage.locator('form input')
      await rInputs.nth(0).fill(state.users.ani.email)
      await rInputs.nth(1).fill(resetCodeRes.code)
      await rInputs.nth(2).fill(newAniPw)
      await expect(rInputs.nth(0)).toHaveValue(state.users.ani.email)
      const resetResPromise = resetPage.waitForResponse(
        (res) => res.url().includes('/api/reset') && res.request().method() === 'POST',
      )
      await resetPage.locator('form button[type="submit"]').click()
      expect((await resetResPromise).status()).toBe(200)
      await expect(resetPage.locator('body')).toContainText(/Sign In|Masuk/i, { timeout: 10_000 })

      // Previous ani@ session in /acme/admin is revoked across all tenants!
      await aniSessionPage.reload()
      await aniSessionPage.waitForURL(/\/acme\/admin\/login/, { timeout: 10_000 })
    } finally {
      await resetCtx.close()
    }
  })
})
