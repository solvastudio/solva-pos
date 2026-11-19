import {
  formatInvoiceNo,
  validateInvoicePrefix,
  type BusinessDate,
} from '~/lib/kernel'

export interface InvoiceNumberPreview {
  invoice: string
  creditNote: string
}

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Generates an uppercase default invoice prefix suggestion (`OUT01-POS02`),
 * clamped cleanly to the 16-character database limit without trailing hyphens.
 */
export function suggestPrefix(outletCode: string, registerCode: string): string {
  const outlet = outletCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  const register = registerCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  const raw = outlet && register ? `${outlet}-${register}` : outlet || register
  return raw.slice(0, 16).replace(/-+$/g, '')
}

/**
 * Extracts `MMYY` period string from a `YYYY-MM-DD` business date.
 */
export function formatPeriodMmYy(date: BusinessDate): string {
  if (!BUSINESS_DATE_PATTERN.test(date)) {
    throw new RangeError(`Invalid business date format: "${date}"`)
  }
  const yy = date.slice(2, 4)
  const mm = date.slice(5, 7)
  return `${mm}${yy}`
}

/**
 * Returns the first day of the month containing `date` (`YYYY-MM-01`).
 */
export function currentMonthFirstDay(date: BusinessDate): BusinessDate {
  if (!BUSINESS_DATE_PATTERN.test(date)) {
    throw new RangeError(`Invalid business date format: "${date}"`)
  }
  return `${date.slice(0, 7)}-01`
}

/**
 * Returns the first day of the calendar month immediately following `date`.
 */
export function nextMonthFirstDay(date: BusinessDate): BusinessDate {
  if (!BUSINESS_DATE_PATTERN.test(date)) {
    throw new RangeError(`Invalid business date format: "${date}"`)
  }
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  if (month === 12) {
    return `${String(year + 1).padStart(4, '0')}-01-01`
  }
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`
}

/**
 * Formats sample `INVOICE` and `CREDIT_NOTE` document numbers for seq 1
 * on the given `todayBusinessDate`.
 */
export function previewInvoiceNumbers(
  prefix: string,
  todayBusinessDate: BusinessDate,
): InvoiceNumberPreview {
  const check = validateInvoicePrefix(prefix)
  if (!check.ok) {
    throw new RangeError(`Invalid invoice prefix (${check.reason}): "${prefix}"`)
  }
  const period = formatPeriodMmYy(todayBusinessDate)
  return {
    invoice: formatInvoiceNo({
      prefix,
      kind: 'INVOICE',
      period,
      seq: 1,
    }),
    creditNote: formatInvoiceNo({
      prefix,
      kind: 'CREDIT_NOTE',
      period,
      seq: 1,
    }),
  }
}
