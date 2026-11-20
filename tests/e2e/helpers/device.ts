import { expect, type Page } from '@playwright/test'

export async function waitForServiceWorkerReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) {
      throw new Error('navigator.serviceWorker is not available')
    }
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 3000)
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => {
            clearTimeout(timer)
            resolve()
          },
          { once: true },
        )
      })
    }
  })
}

export async function pairDeviceViaUi(
  page: Page,
  slug: string,
  code: string,
  deviceName = 'E2E Cashier 01',
  waitTimeoutMs = 20_000,
): Promise<void> {
  await page.goto(`/${slug}/pos/pair`)
  await page.getByLabel(/Pairing code|Kode pairing/i).fill(code)
  await page.getByLabel(/Device name|Nama perangkat/i).fill(deviceName)
  await page.getByRole('button', { name: /Pair Device|^Pasangkan$/i }).click()

  await page.waitForURL(new RegExp(`/${slug}/pos/login`), { timeout: waitTimeoutMs })
  await expect(page.locator('h1')).toContainText(/PIN/i)
  await waitForServiceWorkerReady(page)
  await page.waitForFunction(() => Boolean((window as { __solva?: unknown }).__solva), {
    timeout: 15_000,
  })
}
