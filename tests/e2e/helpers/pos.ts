import { expect, type Page } from '@playwright/test'

/**
 * UI helpers for the F3 cashier flow (PIN login, shift, scan, pay, close shift).
 * All selectors use the id-ID i18n text and labels so they match what the cashier sees.
 */

export interface PaymentEntry {
  method: 'CASH' | 'QRIS'
  amount: number
}

export async function loginStaffPin(page: Page, staffName: string, pin: string): Promise<void> {
  await page.getByRole('option', { name: new RegExp(staffName) }).click()
  for (const digit of pin) {
    await page.getByRole('button', { name: `Angka ${digit}`, exact: true }).click()
  }
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.endsWith('/pos/login'), { timeout: 20_000 })
}

export async function openShiftUi(page: Page, openingCash: number): Promise<void> {
  await expect(page).toHaveURL(/\/pos\/shift\/open/, { timeout: 20_000 })
  await page.getByLabel('Modal kas awal').fill(String(openingCash))
  await page.getByRole('button', { name: 'Buka Shift', exact: true }).click()
  await page.waitForURL(/\/pos\/(sell|shift)/, { timeout: 20_000 })
}

/** Scans a barcode with a keyboard-wedge scanner pattern (fast typing, then Enter). */
export async function scanBarcode(page: Page, barcode: string): Promise<void> {
  const search = page.getByLabel('Cari produk atau pindai barcode')
  await search.click()
  await page.keyboard.type(barcode, { delay: 2 })
  await page.keyboard.press('Enter')
}

/** Fills a money field (formatted MoneyInput): clear it, then type the digits. */
async function fillMoney(page: Page, label: string, amount: number): Promise<void> {
  const input = page.getByLabel(label)
  await input.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(String(amount), { delay: 5 })
}

async function enterPaymentEntries(page: Page, entries: readonly PaymentEntry[]): Promise<void> {
  for (const entry of entries) {
    if (entry.method === 'CASH') {
      await page.getByRole('button', { name: 'Tunai', exact: true }).click()
      await fillMoney(page, 'Uang diterima', entry.amount)
    } else {
      await page.getByRole('button', { name: 'QRIS', exact: true }).click()
      await fillMoney(page, 'Nominal pembayaran', entry.amount)
    }
    await page.getByRole('button', { name: 'Tambah metode', exact: true }).click()
  }
}

/** From the sell screen: open payment, fill in the methods, finish. Returns the invoice number from the finished screen. */
export async function payAndFinish(page: Page, entries: readonly PaymentEntry[]): Promise<string> {
  await page.getByRole('button', { name: /^Bayar/ }).click({ timeout: 15_000 })
  await expect(page).toHaveURL(/\/pos\/pay/, { timeout: 10_000 })
  await enterPaymentEntries(page, entries)
  await page.getByRole('button', { name: 'Selesai', exact: true }).click()
  await page.waitForURL(/\/pos\/done\//, { timeout: 20_000 })
  const invoiceLocator = page.locator('[data-invoice-no]')
  if ((await invoiceLocator.count()) > 0) {
    return (await invoiceLocator.first().textContent())?.trim() ?? ''
  }
  return ''
}

export async function startNewSale(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Transaksi baru', exact: true }).click()
  await page.waitForURL(/\/pos\/sell/, { timeout: 10_000 })
}

/** In-app navigation (no reload, so the in-memory PIN session survives). */
export async function navPos(page: Page, label: 'Jual' | 'Riwayat' | 'Shift' | 'Lain'): Promise<void> {
  await page.getByRole('navigation', { name: 'Navigasi Kasir' }).first().getByRole('link', { name: label, exact: true }).click({ timeout: 15_000 })
}

export async function closeShiftUi(page: Page, counted: number): Promise<void> {
  await navPos(page, 'Lain')
  await page.getByRole('button', { name: /^Tutup Shift/ }).or(page.getByRole('link', { name: /^Tutup Shift/ })).first().click({ timeout: 15_000 })
  await page.getByLabel('Uang fisik terhitung').fill(String(counted))
  await page.getByRole('button', { name: 'Kunci Hitungan & Tutup Shift', exact: true }).click()
  await page.getByRole('button', { name: 'Kunci & Tutup Shift', exact: true }).click()
  await expect(page.getByText('Hitungan terkunci', { exact: false })).toBeVisible({ timeout: 20_000 })
}

interface OutboxRowLite {
  id: string
  type?: string
  status: string
  device_seq?: number
  attempts?: number
  last_error_code?: string | null
  next_retry_at?: string | null
  depends_on?: string[]
}

/** Reads all outbox rows from the E2E hook (without payload). */
export async function readOutbox(page: Page): Promise<OutboxRowLite[]> {
  return page.evaluate(async () => {
    const handle = (window as unknown as { __solva?: { getOutbox: () => Promise<unknown[]> } }).__solva
    if (!handle) return []
    const rows = (await handle.getOutbox()) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      id: String(r.id),
      type: r.type as string | undefined,
      status: String(r.status),
      device_seq: r.device_seq as number | undefined,
      attempts: r.attempts as number | undefined,
      last_error_code: (r.last_error_code as string | null | undefined) ?? null,
      next_retry_at: (r.next_retry_at as string | null | undefined) ?? null,
      depends_on: (r.depends_on as string[] | undefined) ?? [],
    }))
  })
}

/** Waits until the whole outbox is ACKED (online). The error includes each row's status. */
export async function waitOutboxAllAcked(page: Page, timeoutMs = 60_000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let rows: OutboxRowLite[] = []
  while (Date.now() < deadline) {
    rows = await readOutbox(page)
    if (rows.length > 0 && rows.every((r) => r.status === 'ACKED')) {
      return rows.length
    }
    await page.waitForTimeout(1000)
  }
  throw new Error(`Outbox belum ACKED semua: ${JSON.stringify(rows.map((r) => [r.type, r.status, r.device_seq, r.attempts, r.last_error_code, r.depends_on?.map((d) => { const x = rows.find((y) => y.id === d); return x ? `${x.type}:${x.status}` : `MISSING:${d}` })]))}`)
}

export async function readPrintJobs(page: Page): Promise<Array<{ status: string; kind?: string }>> {
  return page.evaluate(async () => {
    const handle = (window as unknown as { __solva?: { getPrintJobs: () => Promise<unknown[]> } }).__solva
    if (!handle) return []
    const rows = (await handle.getPrintJobs()) as Array<Record<string, unknown>>
    return rows.map((r) => ({ status: String(r.status), kind: r.kind as string | undefined }))
  })
}

/** Selects the virtual (test) print adapter so window.print() is not called in headless mode. */
export async function selectVirtualPrinter(page: Page): Promise<void> {
  await selectPrinterAdapter(page, 'Virtual (Uji)')
}

/** Selects a print path by option label (e.g. 'WebUSB'), then returns to Sell. */
export async function selectPrinterAdapter(
  page: Page,
  optionLabel: string,
  opts?: { retryFailed?: boolean },
): Promise<void> {
  await navPos(page, 'Lain')
  await page.getByRole('button', { name: /Pengaturan Perangkat/ }).or(page.getByRole('link', { name: /Pengaturan Perangkat/ })).first().click({ timeout: 15_000 })
  await page.locator('#printer-adapter-select').click({ timeout: 10_000 })
  await page.getByRole('option', { name: optionLabel, exact: true }).click({ timeout: 10_000 })
  await expect(page.locator('#printer-adapter-select')).toHaveText(optionLabel, { timeout: 10_000 })
  if (opts?.retryFailed) {
    // Wait until the configuration is saved before retrying the failed job.
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: 'Cetak ulang', exact: true }).first().click({ timeout: 15_000 })
    return
  }
  await navPos(page, 'Jual')
}

/** Approves an action in the supervisor PIN dialog: confirm the approver, fill in the reason (required) and PIN, then confirm. */
export async function approveWithSupervisor(
  page: Page,
  approverName: string,
  pin: string,
  reason = 'Uji E2E F3',
): Promise<void> {
  const dialog = page.getByRole('dialog')
  const approver = dialog.getByRole('combobox').first()
  if (!((await approver.textContent()) ?? '').includes(approverName)) {
    await approver.click({ timeout: 10_000 })
    await page.getByRole('option', { name: new RegExp(approverName) }).click({ timeout: 10_000 })
  }
  const reasonInput = dialog.getByLabel('Alasan', { exact: true })
  if ((await reasonInput.count()) > 0) {
    await reasonInput.fill(reason)
  }
  await dialog.getByLabel('PIN terminal (4–6 digit)').fill(pin)
  await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click({ timeout: 10_000 })
}
