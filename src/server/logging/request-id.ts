import { LOG_ID_PATTERN, newRefId } from './log-time'

const SAFE_HEADER_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

export function resolveRequestId(headerValue: string | null | undefined, nowMs?: number): string {
  if (typeof headerValue === 'string' && SAFE_HEADER_ID_PATTERN.test(headerValue)) {
    return headerValue
  }
  return newRefId(nowMs)
}

export function isLogId(value: string): boolean {
  return LOG_ID_PATTERN.test(value)
}

export function dayOfLogId(id: string): string | null {
  const m = /^(?:job-)?(\d{4})(\d{2})(\d{2})-\d{6}-/.exec(id)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}
