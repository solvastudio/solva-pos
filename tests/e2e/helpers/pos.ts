import { expect, type Page } from '@playwright/test'

/**
 * Pembantu UI kasir F3 (login PIN, shift, scan, bayar, tutup shift).
 * Semua selector memakai teks/label kunci i18n id-ID agar sama dengan yang dilihat kasir.
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

/** Memindai barcode dengan pola pemindai keyboard-wedge (ketikan cepat lalu Enter). */
export async function scanBarcode(page: Page, barcode: string): Promise<void> {
  const search = page.getByLabel('Cari produk atau pindai barcode')
  await search.click()
  await page.keyboard.type(barcode, { delay: 2 })
  await page.keyboard.press('Enter')
}

/** Mengisi kolom uang (MoneyInput terformat): kosongkan lalu ketik digit. */
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

/** Dari layar jual: buka pembayaran, isi metode, selesaikan. Mengembalikan nomor invoice dari layar selesai. */
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

/** Navigasi dalam aplikasi (tanpa reload agar sesi PIN di memori tetap ada). */
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

/** Membaca seluruh baris outbox dari hook E2E (tanpa payload). */
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

/** Menunggu sampai seluruh outbox ACKED (online). Galat menyertakan status tiap baris. */
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

/** Memilih adapter cetak virtual (uji) agar tidak memanggil window.print() di headless. */
export async function selectVirtualPrinter(page: Page): Promise<void> {
  await selectPrinterAdapter(page, 'Virtual (Uji)')
}

/** Memilih jalur cetak berdasarkan label opsi (mis. 'WebUSB') lalu kembali ke Jual. */
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
    // Tunggu konfigurasi tersimpan sebelum mencoba ulang job gagal.
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: 'Cetak ulang', exact: true }).first().click({ timeout: 15_000 })
    return
  }
  await navPos(page, 'Jual')
}

/** Menyetujui aksi di dialog PIN Supervisor: pastikan penyetuju, isi alasan (wajib) dan PIN, konfirmasi. */
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
