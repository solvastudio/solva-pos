import { z } from 'zod'

/** Safe integer IDR currency amount (may be negative, e.g. rounding or clock offset). */
export const zMoney = z
  .number()
  .int()
  .refine(Number.isSafeInteger, 'Amount must be a safe integer')

/** Non-negative safe integer IDR currency amount (>= 0). */
export const zMoneyNonNeg = z
  .number()
  .int()
  .min(0)
  .refine(Number.isSafeInteger, 'Amount must be a safe non-negative integer')

/** Positive safe integer IDR currency amount (> 0). */
export const zMoneyPositive = z
  .number()
  .int()
  .min(1)
  .refine(Number.isSafeInteger, 'Amount must be a safe positive integer')

/** Safe non-negative integer (counts, cursors). */
export const zSafeNonNegInt = z
  .number()
  .int()
  .min(0)
  .refine(Number.isSafeInteger, 'Value must be a safe non-negative integer')

/** Safe positive integer (>= 1, e.g. line_no, seq). */
export const zSafePosInt = z
  .number()
  .int()
  .min(1)
  .refine(Number.isSafeInteger, 'Value must be a safe positive integer')

const QTY_PATTERN = /^-?\d+(\.\d{1,4})?$/
const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,4})?$/
const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const PERIOD_PATTERN = /^(0[1-9]|1[0-2])\d{2}$/
const CASH_ROUNDING_UNITS = new Set([0, 100, 500, 1000])

/** Fixed-scale (up to 4 decimals) quantity string matching PG `numeric(18,4)`. */
export const zQty = z.string().regex(QTY_PATTERN, 'Invalid quantity format (expected numeric scale <= 4)')

/** Strictly positive fixed-scale quantity string (> 0). */
export const zQtyPositive = zQty.refine(
  (s) => !s.startsWith('-') && /[1-9]/.test(s),
  'Quantity must be greater than zero',
)

/** Fixed-scale percentage string between 0 and 100 inclusive (`numeric(7,4)`). */
export const zPercent = z
  .string()
  .regex(PERCENT_PATTERN, 'Invalid percent format')
  .refine((s) => {
    const n = Number(s)
    return Number.isFinite(n) && n >= 0 && n <= 100
  }, 'Percent must be between 0 and 100')

/** Strict UTC ISO-8601 datetime string (trailing `Z`). */
export const zIso = z.iso.datetime()

/** Business date (`YYYY-MM-DD`) validated against Gregorian calendar bounds. */
export const zBusinessDate = z
  .string()
  .regex(BUSINESS_DATE_PATTERN, 'Business date must match YYYY-MM-DD')
  .refine((s) => {
    const [yStr, mStr, dStr] = s.split('-')
    const y = Number(yStr)
    const m = Number(mStr)
    const d = Number(dStr)
    if (m < 1 || m > 12 || d < 1 || d > 31) return false
    const maxDays = [
      31,
      (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ]
    return d <= maxDays[m - 1]!
  }, 'Business date is not a valid calendar date')

/** Document sequence period (`MMYY`), months `01`..`12`. */
export const zPeriod = z.string().regex(PERIOD_PATTERN, 'Period must match MMYY with month 01..12')

/** Lowercase RFC-compliant UUID string. */
export const zUuid = z.uuid().refine((v) => v === v.toLowerCase(), 'UUID must be lowercase')

/** Cash rounding unit enum (`0 | 100 | 500 | 1000`). */
export const zCashRoundingUnit = z
  .number()
  .int()
  .refine((n): n is 0 | 100 | 500 | 1000 => CASH_ROUNDING_UNITS.has(n), 'Cash rounding unit must be 0, 100, 500, or 1000')

/** Supported receipt locale literals (`id-ID` | `en-US`). */
export const zReceiptLocale = z.enum(['id-ID', 'en-US'])

/** POS currency literal (currently IDR only). */
export const zCurrencyIdr = z.literal('IDR')

export type SafeMoney = z.infer<typeof zMoney>
