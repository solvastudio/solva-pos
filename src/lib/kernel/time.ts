export type OutletTimezone = 'Asia/Jakarta' | 'Asia/Makassar' | 'Asia/Jayapura'

export const OUTLET_TIMEZONES: readonly OutletTimezone[] = [
  'Asia/Jakarta',
  'Asia/Makassar',
  'Asia/Jayapura',
]

export type IsoInstant = string
export type BusinessDate = string

const ISO_UTC_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3})\d*)?Z$/
const BUSINESS_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const CUTOFF_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28
    case 4:
    case 6:
    case 9:
    case 11:
      return 30
    default:
      return 31
  }
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false
  if (day < 1 || day > daysInMonth(year, month)) return false
  return true
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function pad4(n: number): string {
  return String(n).padStart(4, '0')
}

export function parseIsoUtcMs(s: string): number {
  if (typeof s !== 'string') {
    throw new RangeError('ISO instant must be a string')
  }
  const m = ISO_UTC_PATTERN.exec(s)
  if (!m) {
    throw new RangeError(`Invalid ISO-8601 UTC format: "${s}"`)
  }
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = Number(m[6])
  const ms = m[7] ? Number(m[7].padEnd(3, '0')) : 0

  if (!isValidCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) {
    throw new RangeError(`Invalid ISO date/time components: "${s}"`)
  }
  return Date.UTC(year, month - 1, day, hour, minute, second, ms)
}

export function isValidIso(s: string): boolean {
  try {
    parseIsoUtcMs(s)
    return true
  } catch {
    return false
  }
}

function prevCalendarDate(year: number, month: number, day: number): BusinessDate {
  if (day > 1) {
    return `${pad4(year)}-${pad2(month)}-${pad2(day - 1)}`
  }
  if (month > 1) {
    const pm = month - 1
    return `${pad4(year)}-${pad2(pm)}-${pad2(daysInMonth(year, pm))}`
  }
  const py = year - 1
  return `${pad4(py)}-12-31`
}

export function businessDate(
  occurredAt: IsoInstant,
  tz: OutletTimezone,
  cutoff: string,
): BusinessDate {
  if (!OUTLET_TIMEZONES.includes(tz)) {
    throw new RangeError(`Invalid outlet timezone: "${String(tz)}"`)
  }
  if (typeof cutoff !== 'string' || !CUTOFF_PATTERN.test(cutoff)) {
    throw new RangeError(`Cutoff time must be HH:MM (00:00..23:59), received: "${String(cutoff)}"`)
  }

  const utcMs = parseIsoUtcMs(occurredAt)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))

  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = p.value
    }
  }

  const year = Number(map.year)
  const month = Number(map.month)
  const day = Number(map.day)
  const hour = map.hour === '24' ? '00' : (map.hour ?? '00')
  const minute = map.minute ?? '00'
  const localHm = `${hour}:${minute}`

  if (localHm < cutoff) {
    return prevCalendarDate(year, month, day)
  }
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`
}

function parseBusinessDateParts(bd: BusinessDate): { year: number; month: number; day: number } {
  if (typeof bd !== 'string') {
    throw new RangeError('BusinessDate must be a YYYY-MM-DD string')
  }
  const m = BUSINESS_DATE_PATTERN.exec(bd)
  if (!m) {
    throw new RangeError(`Invalid BusinessDate format: "${bd}"`)
  }
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!isValidCalendarDate(year, month, day)) {
    throw new RangeError(`Invalid BusinessDate calendar date: "${bd}"`)
  }
  return { year, month, day }
}

export function invoicePeriod(bd: BusinessDate): string {
  const { year, month } = parseBusinessDateParts(bd)
  return `${pad2(month)}${String(year).slice(-2)}`
}

export function returnWindowEnd(bd: BusinessDate, months: number): BusinessDate {
  if (!Number.isSafeInteger(months) || months < 0) {
    throw new RangeError(`Return window months must be an integer >= 0: ${months}`)
  }
  const { year, month, day } = parseBusinessDateParts(bd)
  const totalMonths = year * 12 + (month - 1) + months
  const targetYear = Math.floor(totalMonths / 12)
  const targetMonth = (totalMonths % 12) + 1
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth))
  return `${pad4(targetYear)}-${pad2(targetMonth)}-${pad2(targetDay)}`
}
