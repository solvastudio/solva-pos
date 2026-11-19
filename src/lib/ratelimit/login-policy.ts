import { LOGIN_DELAY_SCHEDULE_MS } from './progressive'
import { sha256Hex } from './sha256'

export interface AccountFailureState {
  failures: number
  blockedUntilMs: number
  lastFailureMs: number
}

export interface EvaluateLoginInput {
  accountState?: AccountFailureState
  slugAlert: boolean
  ipSlugBlockedUntilMs: number
  resetAfterMs: number
  nowMs: number
}

export interface EvaluateLoginResult {
  allowed: boolean
  retryAfterMs: number
  reason: 'ACCOUNT_DELAY' | 'IP_SLUG' | null
}

/**
 * Global account key derived strictly from normalized email truncated to 64 chars.
 * Slug-independent and indistinguishable between existing and nonexistent emails.
 */
export function keyForAccount(emailNormalized: string): string {
  const canonical = emailNormalized.trim().toLowerCase().slice(0, 64)
  return sha256Hex(canonical).slice(0, 16)
}

const DEFAULT_SCHEDULE_MS: readonly number[] = LOGIN_DELAY_SCHEDULE_MS.slice(1)

export function parseDelayScheduleSec(rawCsv: string): readonly number[] {
  const parts = rawCsv
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0)
  if (parts.length === 0) {
    return DEFAULT_SCHEDULE_MS
  }
  return parts.map((sec) => Math.round(sec * 1000))
}

export function delayForFailureCount(
  failures: number,
  slugAlert: boolean,
  scheduleMs: readonly number[] = DEFAULT_SCHEDULE_MS,
): number {
  if (!Number.isFinite(failures) || failures <= 0 || scheduleMs.length === 0) {
    return 0
  }
  // Schedule entries map 1-to-1 to failures 1..N+. In slug alert mode, shift by +2
  // so delay starts on the 2nd failure rather than the 4th.
  const index = Math.floor(failures) - 1 + (slugAlert ? 2 : 0)
  if (index >= scheduleMs.length) {
    return scheduleMs[scheduleMs.length - 1] ?? 0
  }
  return scheduleMs[index] ?? 0
}

export function applyLoginFailure(
  prevState: AccountFailureState | undefined,
  slugAlert: boolean,
  scheduleMs: readonly number[],
  resetAfterMs: number,
  nowMs: number,
): AccountFailureState {
  const isExpired = !prevState || nowMs - prevState.lastFailureMs > resetAfterMs
  const failures = isExpired ? 1 : prevState.failures + 1
  const delayMs = delayForFailureCount(failures, slugAlert, scheduleMs)
  return {
    failures,
    blockedUntilMs: nowMs + delayMs,
    lastFailureMs: nowMs,
  }
}

export function applyLoginSuccess(): AccountFailureState {
  return { failures: 0, blockedUntilMs: 0, lastFailureMs: 0 }
}

export function evaluateLogin(input: EvaluateLoginInput): EvaluateLoginResult {
  const accountActive =
    input.accountState !== undefined &&
    input.nowMs - input.accountState.lastFailureMs <= input.resetAfterMs

  const accountRemaining =
    accountActive && input.accountState
      ? Math.max(0, input.accountState.blockedUntilMs - input.nowMs)
      : 0

  const ipSlugRemaining = Math.max(0, input.ipSlugBlockedUntilMs - input.nowMs)

  if (accountRemaining <= 0 && ipSlugRemaining <= 0) {
    return { allowed: true, retryAfterMs: 0, reason: null }
  }

  if (accountRemaining >= ipSlugRemaining) {
    return { allowed: false, retryAfterMs: accountRemaining, reason: 'ACCOUNT_DELAY' }
  }
  return { allowed: false, retryAfterMs: ipSlugRemaining, reason: 'IP_SLUG' }
}

export function retryMinutes(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 1
  }
  return Math.max(1, Math.ceil(ms / 60_000))
}
