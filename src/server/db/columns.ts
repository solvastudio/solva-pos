import { customType } from 'drizzle-orm/pg-core'
import { isUuid, isValidIso, QTY_PATTERN } from '~/lib/kernel'

const MAX_SAFE_BI = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE_BI = -MAX_SAFE_BI
const INT_PATTERN = /^-?\d+$/
const PERCENT_PATTERN = /^\d{1,3}(?:\.\d{1,4})?$/
const PG_UTC_TS_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]00(?::?00)?)$/

/** Parse a Postgres int8 value (string or number) into a safe JS integer. */
export function parseSafeBigint(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`Bigint value outside safe integer range: ${value}`)
    }
    return value === 0 ? 0 : value
  }
  if (typeof value === 'string' && INT_PATTERN.test(value)) {
    const bi = BigInt(value)
    if (bi < MIN_SAFE_BI || bi > MAX_SAFE_BI) {
      throw new RangeError(`Bigint value outside safe integer range: ${value}`)
    }
    const n = Number(bi)
    return n === 0 ? 0 : n
  }
  throw new RangeError(`Invalid bigint value from driver: ${String(value)}`)
}

function serializeSafeBigint(value: number): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new RangeError(`Bigint value must be a safe integer: ${String(value)}`)
  }
  return String(value === 0 ? 0 : value)
}

function parsePgUtcTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value !== 'string') {
    throw new RangeError(`Invalid timestamptz value from driver: ${String(value)}`)
  }
  const m = PG_UTC_TS_PATTERN.exec(value)
  if (!m) {
    throw new RangeError(`Timestamptz value must be UTC (+00/Z), received: "${value}"`)
  }
  const datePart = m[1]!
  const timePart = m[2]!
  const rawFrac = m[3] ?? ''
  const msPart = rawFrac.slice(0, 3).padEnd(3, '0')
  return `${datePart}T${timePart}.${msPart}Z`
}

export const moneyBigint = customType<{ data: number; driverData: string }>({
  dataType() {
    return 'bigint'
  },
  fromDriver(value) {
    return parseSafeBigint(value)
  },
  toDriver(value) {
    return serializeSafeBigint(value)
  },
})

export const qtyNumeric = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'numeric(18, 4)'
  },
  fromDriver(value) {
    return String(value)
  },
  toDriver(value) {
    if (typeof value !== 'string' || !QTY_PATTERN.test(value)) {
      throw new RangeError(`Invalid quantity string for numeric(18,4): "${String(value)}"`)
    }
    return value
  },
})

export const percentNumeric = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'numeric(7, 4)'
  },
  fromDriver(value) {
    return String(value)
  },
  toDriver(value) {
    if (typeof value !== 'string' || !PERCENT_PATTERN.test(value)) {
      throw new RangeError(`Invalid percent string for numeric(7,4): "${String(value)}"`)
    }
    const num = Number(value)
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      throw new RangeError(`Percent out of range 0..100: "${value}"`)
    }
    return value
  },
})

export const isoTimestamptz = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'timestamptz'
  },
  fromDriver(value) {
    return parsePgUtcTimestamp(value)
  },
  toDriver(value) {
    if (typeof value !== 'string' || !isValidIso(value)) {
      throw new RangeError(`Invalid ISO-8601 UTC timestamp: "${String(value)}"`)
    }
    return value
  },
})

export const uuidId = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'uuid'
  },
  fromDriver(value) {
    return String(value).toLowerCase()
  },
  toDriver(value) {
    if (typeof value !== 'string' || !isUuid(value)) {
      throw new RangeError(`Invalid lowercase UUID: "${String(value)}"`)
    }
    return value
  },
})
