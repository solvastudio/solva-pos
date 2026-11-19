import { randomBytes } from 'node:crypto'

/** 31-character alphabet excluding look-alike letters/digits (i, l, o, 0, 1). */
const REF_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export const REF_ID_PATTERN = /^\d{8}-\d{6}-[a-hj-km-np-z2-9]{5}$/
export const LOG_ID_PATTERN = /^(?:job-)?\d{8}-\d{6}-[a-hj-km-np-z2-9]{5}$/

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatUtcIso(date: Date): string {
  return date.toISOString()
}

export function todayUtc(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export function formatRefId(date: Date, rand: string): string {
  const y = date.getUTCFullYear()
  const m = pad2(date.getUTCMonth() + 1)
  const d = pad2(date.getUTCDate())
  const h = pad2(date.getUTCHours())
  const min = pad2(date.getUTCMinutes())
  const sec = pad2(date.getUTCSeconds())
  return `${y}${m}${d}-${h}${min}${sec}-${rand}`
}

function randomSuffix(length = 5): string {
  const bytes = randomBytes(length)
  let out = ''
  for (const byte of bytes) {
    out += REF_ALPHABET[byte % REF_ALPHABET.length]!
  }
  return out
}

export function newRefId(nowMs = Date.now()): string {
  return formatRefId(new Date(nowMs), randomSuffix(5))
}

export function jobRefId(nowMs = Date.now()): string {
  return `job-${newRefId(nowMs)}`
}
