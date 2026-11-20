import { expect, test } from '@playwright/test'
import { loginAdminUi } from './helpers/admin'
import { pairDeviceViaUi } from './helpers/device'
import { readE2eState } from './helpers/seed'
import {
  assertAuditLogImmutableAsAppLogin,
  clearActiveDevicesOnRegister,
  createPairingCodeDirect,
  findIdempotencyCommands,
  listAuditLogsByAction,
} from './helpers/server'

test.describe('F1-K02 K04 K05 K08 & sync resilience (SSE, 429, lie-fi)', () => {
  test('F1-K04 F1-K05 F1-K08 handles idempotent push on dropped response, offline queue, versions, and audit immutability', async ({
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
      await pairDeviceViaUi(page, 'acme', code, 'E2E Cashier K04')

      // Intercept the FIRST /push request: abort response to client immediately, then deliver payload to server out-of-band.
      let droppedOnce = false
      let commitPromise: Promise<void> | null = null
      await page.route('**/api/pos/v1/push', async (route) => {
        if (!droppedOnce) {
          droppedOnce = true
          const req = route.request()
          const url = req.url()
          const method = req.method()
          const headers = new Headers(await req.allHeaders())
          const body = req.postData() ?? undefined
          await route.abort('failed')
          commitPromise = globalThis
            .fetch(url, { method, headers, body })
            .then((res) => {
              expect(res.status).toBe(200)
            })
          return
        }
        await route.continue()
      })

      const actionTag = `E2E_K04_${Date.now()}`
      const cmdIds = await page.evaluate(
        async ({ outletId, registerId, tag }) => {
          const ids: string[] = []
          for (let i = 0; i < 3; i += 1) {
            const row = await window.__solva!.enqueueAudit({
              action: 'drawer.opened',
              entityType: 'outlet',
              entityId: outletId,
              registerId,
              afterData: { tag, idx: i },
              occurredAtIso: new Date().toISOString(),
            })
            ids.push(row.id)
          }
          window.__solva!.kickSync()
          return ids
        },
        {
          outletId: state.tenants.acme.outletId,
          registerId: state.tenants.acme.registerId,
          tag: actionTag,
        },
      )

      await expect.poll(() => droppedOnce, { timeout: 10_000 }).toBe(true)
      await commitPromise
      await page.unroute('**/api/pos/v1/push')

      // Trigger retry once outbox backoff elapses -> server idempotency returns ACK without inserting duplicates.
      await expect
        .poll(
          async () => {
            await page.evaluate(() => window.__solva!.kickSync())
            return page.evaluate(() => window.__solva!.getSyncState().queue.pending)
          },
          { timeout: 15_000, intervals: [1_000] },
        )
        .toBe(0)
      expect(await page.evaluate(() => window.__solva!.getSyncState().queue.attention)).toBe(0)

      const auditRows = await listAuditLogsByAction(state.tenants.acme.id, 'drawer.opened', actionTag)
      expect(auditRows).toHaveLength(3)

      // K08: idempotency_command stores app_version & schema_version
      const idempRows = await findIdempotencyCommands(state.tenants.acme.id, cmdIds)
      expect(idempRows).toHaveLength(3)
      for (const r of idempRows) {
        expect(r.app_version).toBeTruthy()
        expect(r.schema_version).toBeGreaterThanOrEqual(1)
      }

      // K05: solva_app_login cannot UPDATE or DELETE audit_log
      const immutability = await assertAuditLogImmutableAsAppLogin(
        state.tenants.acme.id,
        auditRows[0]!.id,
      )
      expect(immutability.updateRejected).toBe(true)
      expect(immutability.deleteRejected).toBe(true)

      // Offline enqueue -> online recovery
      await ctx.setOffline(true)
      const offlineTag = `E2E_OFFLINE_${Date.now()}`
      await page.evaluate(
        async ({ outletId, registerId, tag }) => {
          await window.__solva!.enqueueAudit({
            action: 'drawer.opened',
            entityType: 'outlet',
            entityId: outletId,
            registerId,
            afterData: { tag },
            occurredAtIso: new Date().toISOString(),
          })
        },
        {
          outletId: state.tenants.acme.outletId,
          registerId: state.tenants.acme.registerId,
          tag: offlineTag,
        },
      )
      const pendingOffline = await page.evaluate(() => window.__solva!.getSyncState().queue.pending)
      expect(pendingOffline).toBe(1)

      await ctx.setOffline(false)
      await page.evaluate(() => window.__solva!.kickSync())
      await expect
        .poll(async () => page.evaluate(() => window.__solva!.getSyncState().queue.pending), {
          timeout: 15_000,
        })
        .toBe(0)
      expect(await listAuditLogsByAction(state.tenants.acme.id, 'drawer.opened', offlineTag)).toHaveLength(1)
    } finally {
      await clearActiveDevicesOnRegister(state.tenants.acme.id, state.tenants.acme.registerId)
      await ctx.close()
    }
  })

  test('F1-K02 receives live master update via SSE and handles 429 & captive-portal lie-fi safely', async ({
    browser,
  }) => {
    const state = readE2eState()
    await clearActiveDevicesOnRegister(state.tenants.acme.id, state.tenants.acme.registerId)
    const code = await createPairingCodeDirect(
      state.tenants.acme.id,
      state.tenants.acme.registerId,
      state.users.budi.acmeAppUserId,
    )

    const adminCtx = await browser.newContext()
    const posCtx = await browser.newContext()
    try {
      const adminPage = await adminCtx.newPage()
      await loginAdminUi(adminPage, 'acme', state.users.budi.email, state.users.budi.password)

      const posPage = await posCtx.newPage()
      await pairDeviceViaUi(posPage, 'acme', code, 'E2E Cashier K02')

      // Wait for initial sync cycle to record baseline cursor
      await posPage.evaluate(() => window.__solva!.kickSync())
      await expect
        .poll(async () => (await posPage.evaluate(() => window.__solva!.getMeta('cursor')))?.version ?? 0)
        .toBeGreaterThan(0)
      const beforeCursor = await posPage.evaluate(() => window.__solva!.getMeta('cursor'))

      // Trigger master change via Admin Roles tab (budi updates CASHIER discount limit)
      await adminPage.goto('/acme/admin/users')
      await adminPage.getByRole('tab', { name: /^Role/i }).click()
      const discountInput = adminPage.getByLabel(/Cashier|Kasir/i).first()
      await discountInput.fill('15')
      await discountInput
        .locator('xpath=ancestor::td[1]')
        .getByRole('button', { name: /Save|Simpan/i })
        .click()

      // Expect SSE signal to advance POS cursor within 5s cleanly!
      await expect
        .poll(async () => (await posPage.evaluate(() => window.__solva!.getMeta('cursor')))?.version ?? 0, {
          timeout: 8_000,
        })
        .toBeGreaterThan(beforeCursor?.version ?? 0)

      // 429 rate-limit neutrality: outbox command stays pending with attempts === 0, not NEEDS_ATTENTION, not OFFLINE
      await posPage.route('**/api/pos/v1/push', async (route) => {
        await route.fulfill({
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '3' },
          body: JSON.stringify({ error: { code: 'RATE_LIMITED' } }),
        })
      })
      const rlCmd = await posPage.evaluate(
        async ({ outletId, registerId }) => {
          const row = await window.__solva!.enqueueAudit({
            action: 'E2E_429_TEST',
            entityType: 'outlet',
            entityId: outletId,
            registerId,
            occurredAtIso: new Date().toISOString(),
          })
          window.__solva!.kickSync()
          return row.id
        },
        { outletId: state.tenants.acme.outletId, registerId: state.tenants.acme.registerId },
      )
      await posPage.waitForTimeout(400)
      const rlRow = await posPage.evaluate(
        async (id) => window.__solva!.db.outbox_command.get(id),
        rlCmd,
      )
      expect(rlRow?.attempts).toBe(0)
      const rlState = await posPage.evaluate(() => window.__solva!.getSyncState())
      expect(rlState.queue.attention).toBe(0)
      expect(rlState.conn).not.toBe('OFFLINE')
      await posPage.unroute('**/api/pos/v1/push')

      // Lie-fi: HTTP 200 HTML without X-App-Version on POS API -> connectivity drops to OFFLINE after 2 fails
      await posPage.route('**/api/pos/v1/**', async (route) => {
        if (route.request().url().includes('/signals')) {
          await route.abort()
          return
        }
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/html' },
          body: '<html>Portal Login</html>',
        })
      })
      await posPage.evaluate(() => window.__solva!.kickSync())
      await posPage.waitForTimeout(250)
      await posPage.evaluate(() => window.__solva!.kickSync())
      await expect
        .poll(async () => posPage.evaluate(() => window.__solva!.getSyncState().conn), {
          timeout: 8_000,
        })
        .toBe('OFFLINE')
      await posPage.unroute('**/api/pos/v1/**')
    } finally {
      await clearActiveDevicesOnRegister(state.tenants.acme.id, state.tenants.acme.registerId)
      await adminCtx.close()
      await posCtx.close()
    }
  })
})
