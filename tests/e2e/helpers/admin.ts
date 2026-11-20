import { expect, type Page } from '@playwright/test'

export async function loginAdminUi(
  page: Page,
  slug: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(`/${slug}/admin/login`, { waitUntil: 'networkidle' })
  const emailInput = page.locator('input[type="email"]')
  const passInput = page.locator('input[type="password"]')
  await emailInput.fill(email)
  await passInput.fill(password)
  await expect(emailInput).toHaveValue(email)
  await expect(passInput).toHaveValue(password)
  await page.getByRole('button', { name: /Sign In|Masuk/i }).click()
  await page.waitForURL(
    (url) => url.pathname.startsWith(`/${slug}/admin`) && !url.pathname.endsWith('/login'),
    { timeout: 15_000 },
  )
}

export async function createPairingCodeViaAdminUi(
  page: Page,
  registerCode = 'POS01',
): Promise<string> {
  await page.getByRole('tab', { name: /^Device|Perangkat/i }).click()
  await page.getByRole('button', { name: /Create pairing code|Buat kode pairing/i }).click()

  const dialog = page.getByRole('dialog').last()
  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: new RegExp(registerCode, 'i') }).first().click()
  await dialog.getByRole('button', { name: /Generate code|Buat kode/i }).click()

  const codeEl = page.locator('p.select-all')
  await expect(codeEl).toBeVisible()
  const rawCode = (await codeEl.textContent())?.trim() ?? ''
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(rawCode)) {
    throw new Error(`Unexpected pairing code format in dialog: "${rawCode}"`)
  }

  await page.getByRole('button', { name: /Close|Tutup/i }).first().click()
  return rawCode
}

export async function revokeDeviceViaAdminUi(
  page: Page,
  deviceNameSubstring: string,
): Promise<void> {
  await page.getByRole('tab', { name: /^Device|Perangkat/i }).click()
  const row = page.locator('tr', { hasText: deviceNameSubstring }).first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: /Revoke|Cabut/i }).click()
  await page.getByRole('button', { name: /Revoke device|Cabut perangkat|Confirm|Ya/i }).last().click()
  await expect(row).toContainText(/Revoked|Dicabut/i)
}
