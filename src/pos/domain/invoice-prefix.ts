import type { RegisterInvoicePrefixRecord } from '../db/types'

/**
 * Selects the active `register_invoice_prefix` row for `businessDate` (BR-INV-003, V-29):
 * greatest `effective_month <= YYYY-MM-01` of `businessDate`.
 */
export function effectivePrefix(
  rows: readonly RegisterInvoicePrefixRecord[],
  businessDate: string,
): RegisterInvoicePrefixRecord | null {
  const monthStart = `${businessDate.slice(0, 7)}-01`
  let best: RegisterInvoicePrefixRecord | null = null
  for (const row of rows) {
    if (row.deleted_at) continue
    if (row.effective_month > monthStart) continue
    if (!best || row.effective_month > best.effective_month) {
      best = row
    }
  }
  return best
}
