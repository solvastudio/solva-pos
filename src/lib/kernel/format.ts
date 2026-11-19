import { toMoney, type Money } from './money'
import { normalizeQty, parseQty, type Qty } from './qty'
import { OUTLET_TIMEZONES, parseIsoUtcMs, type IsoInstant, type OutletTimezone } from './time'

export type LocaleId = 'id-ID' | 'en-US'

const MINUS_SIGN = '\u2212'

function getLocaleSeparators(locale: LocaleId): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(1111.1)
  let group = locale === 'id-ID' ? '.' : ','
  let decimal = locale === 'id-ID' ? ',' : '.'
  for (const part of parts) {
    if (part.type === 'group') group = part.value
    if (part.type === 'decimal') decimal = part.value
  }
  return { group, decimal }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cleanLocalizedNumberString(raw: string, locale: LocaleId): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/^Rp\s*/i, '').replace(/^IDR\s*/i, '')
  if (trimmed.length === 0) return null

  let sign = ''
  let body = trimmed
  if (body.startsWith(MINUS_SIGN) || body.startsWith('-')) {
    sign = '-'
    body = body.slice(1).trim()
  }
  if (body.length === 0) return null

  const { group, decimal } = getLocaleSeparators(locale)
  if (body.startsWith(group) || body.endsWith(group) || body.includes(group + group)) {
    return null
  }

  const withoutGroup = body.replace(new RegExp(escapeRegExp(group), 'g'), '')
  const canonical = withoutGroup.replace(new RegExp(escapeRegExp(decimal), 'g'), '.')
  return `${sign}${canonical}`
}

/** Format uang integer ke `"Rp112.476"` (`id-ID`) / `"Rp112,476"` (`en-US`); negatif memakai `−Rp...`. */
export function formatMoney(m: Money, locale: LocaleId): string {
  const formattedAbs = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
    .format(Math.abs(m))
    .replace(/(?:Rp|IDR)[\s\u00a0]*/g, 'Rp')
  return m < 0 ? `${MINUS_SIGN}${formattedAbs}` : formattedAbs
}

/** Mengurai input uang terlokalisasi menjadi `Money`, atau `null` bila tidak sah / pecahan. */
export function parseMoneyInput(s: string, locale: LocaleId): Money | null {
  const cleaned = cleanLocalizedNumberString(s, locale)
  if (!cleaned || !/^-?\d+$/.test(cleaned)) {
    return null
  }
  if ((cleaned.startsWith('-') ? cleaned.slice(1) : cleaned).length > 1 && cleaned.replace('-', '').startsWith('0')) {
    return null
  }
  const num = Number(cleaned)
  if (!Number.isSafeInteger(num)) {
    return null
  }
  try {
    return toMoney(num)
  } catch {
    return null
  }
}

export function formatQty(q: Qty, locale: LocaleId): string {
  const canonical = normalizeQty(q) as string
  const neg = canonical.startsWith('-')
  const unsigned = neg ? canonical.slice(1) : canonical
  const dotIdx = unsigned.indexOf('.')
  const intPart = dotIdx === -1 ? unsigned : unsigned.slice(0, dotIdx)
  const fracPart = dotIdx === -1 ? '' : unsigned.slice(dotIdx + 1)

  const intFormatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(Number(intPart))

  const { decimal } = getLocaleSeparators(locale)
  const prefix = neg ? MINUS_SIGN : ''
  return fracPart.length > 0 ? `${prefix}${intFormatted}${decimal}${fracPart}` : `${prefix}${intFormatted}`
}

export function parseQtyInput(s: string, locale: LocaleId): Qty | null {
  const cleaned = cleanLocalizedNumberString(s, locale)
  if (!cleaned) {
    return null
  }
  try {
    return parseQty(cleaned)
  } catch {
    return null
  }
}

export function formatPercent(p: string, locale: LocaleId): string {
  const q = parseQty(p)
  return `${formatQty(q, locale)}%`
}

export function formatDateTime(iso: IsoInstant, tz: OutletTimezone, locale: LocaleId): string {
  if (!OUTLET_TIMEZONES.includes(tz)) {
    throw new RangeError(`Zona waktu outlet tidak valid: "${String(tz)}"`)
  }
  const ms = parseIsoUtcMs(iso)
  const d = new Date(ms)

  const dateStr = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)

  const timeStr =
    locale === 'id-ID'
      ? new Intl.DateTimeFormat('id-ID', {
          timeZone: tz,
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(d)
      : new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
          .format(d)
          .replace(/[\u00a0\u202f]/g, ' ')

  return `${dateStr} ${timeStr}`
}
