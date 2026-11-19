import '@tanstack/react-start/server-only'
import { normalizeSlug } from '~/lib/kernel'
import { BoundedStore } from '~/lib/ratelimit/bounded-store'
import {
  applyLoginFailure,
  evaluateLogin,
  keyForAccount,
  type AccountFailureState,
} from '~/lib/ratelimit/login-policy'
import { createLogger } from '~/server/log'
import { getRateLimitConfig } from '~/server/rate-limit-config'
import { getLimiters } from './limiters'

const log = createLogger('auth.ratelimit')

interface SlugFailureCounter {
  count: number
  windowStartMs: number
  alertUntilMs: number
}

export interface CheckLoginParams {
  email: string
  slug: string
  ip?: string
  nowMs?: number
}

export interface CheckLoginResult {
  allowed: boolean
  retryAfterMs: number
  alert: boolean
  reason: 'ACCOUNT_DELAY' | 'IP_SLUG' | null
}

export interface RecordFailureParams {
  email: string
  slug: string
  ip?: string
  nowMs?: number
}

export interface RecordFailureResult {
  alert: boolean
  tarpitMs: number
}

let currentNowMs = () => Date.now()
let accountStore: BoundedStore<AccountFailureState> | null = null
let slugAlertStore: BoundedStore<SlugFailureCounter> | null = null

function getAccountStore(): BoundedStore<AccountFailureState> {
  if (!accountStore) {
    const cfg = getRateLimitConfig()
    accountStore = new BoundedStore<AccountFailureState>({
      maxKeys: cfg.loginKeyMax,
      ttlMs: cfg.loginResetAfterMs,
      now: () => currentNowMs(),
      isProtected: (v, nowMs) => v.blockedUntilMs > nowMs,
    })
  }
  return accountStore
}

function getSlugAlertStore(): BoundedStore<SlugFailureCounter> {
  if (!slugAlertStore) {
    const cfg = getRateLimitConfig()
    slugAlertStore = new BoundedStore<SlugFailureCounter>({
      maxKeys: cfg.loginKeyMax,
      ttlMs: cfg.loginSlugAlertWindowMs,
      now: () => currentNowMs(),
      isProtected: (v, nowMs) => v.alertUntilMs > nowMs,
    })
  }
  return slugAlertStore
}

function isSlugAlertActive(slug: string, nowMs: number): boolean {
  const entry = getSlugAlertStore().get(slug)
  return entry !== undefined && entry.alertUntilMs > nowMs
}

export async function checkLogin(params: CheckLoginParams): Promise<CheckLoginResult> {
  const cfg = getRateLimitConfig()
  const nowMs = params.nowMs ?? currentNowMs()
  const slug = normalizeSlug(params.slug)
  const accountKey = keyForAccount(params.email)
  const slugAlert = isSlugAlertActive(slug, nowMs)

  let ipSlugBlockedUntilMs = 0
  if (params.ip) {
    const ipSlugDecision = await getLimiters().loginIpSlug.peek(`${params.ip}:${slug}`, nowMs)
    if (!ipSlugDecision.allowed) {
      ipSlugBlockedUntilMs = nowMs + ipSlugDecision.retryAfterMs
    }
  }

  const evalRes = evaluateLogin({
    accountState: getAccountStore().get(accountKey),
    slugAlert,
    ipSlugBlockedUntilMs,
    resetAfterMs: cfg.loginResetAfterMs,
    nowMs,
  })

  if (!evalRes.allowed) {
    log.warn(
      {
        outcome: 'RATE_LIMITED',
        usernameHash: accountKey,
        ...(params.ip ? { ip: params.ip } : {}),
        scope: evalRes.reason === 'IP_SLUG' ? 'login:ip_slug' : 'login:account',
      },
      'login attempt blocked by rate limit',
    )
    return {
      allowed: false,
      retryAfterMs: evalRes.retryAfterMs,
      alert: slugAlert,
      reason: evalRes.reason,
    }
  }

  return {
    allowed: true,
    retryAfterMs: 0,
    alert: slugAlert,
    reason: null,
  }
}

export async function recordLoginFailure(params: RecordFailureParams): Promise<RecordFailureResult> {
  const cfg = getRateLimitConfig()
  const nowMs = params.nowMs ?? currentNowMs()
  const slug = normalizeSlug(params.slug)
  const accountKey = keyForAccount(params.email)

  const sStore = getSlugAlertStore()
  const prevSlug = sStore.get(slug)
  const withinWindow = prevSlug && nowMs - prevSlug.windowStartMs < cfg.loginSlugAlertWindowMs
  const nextCount = withinWindow ? prevSlug.count + 1 : 1
  const windowStartMs = withinWindow ? prevSlug.windowStartMs : nowMs
  const wasAlert = Boolean(prevSlug && prevSlug.alertUntilMs > nowMs)
  const alertUntilMs =
    nextCount >= cfg.loginSlugAlertThreshold
      ? nowMs + cfg.loginSlugAlertWindowMs
      : prevSlug && prevSlug.alertUntilMs > nowMs
        ? prevSlug.alertUntilMs
        : 0
  const alert = alertUntilMs > nowMs

  if (alert && !wasAlert) {
    log.warn({ outcome: 'RATE_LIMITED', scope: 'login:slug_alert' }, 'login slug entered alert mode')
  }

  sStore.set(
    slug,
    { count: nextCount, windowStartMs, alertUntilMs },
    Math.max(cfg.loginSlugAlertWindowMs, alertUntilMs - nowMs),
  )

  const aStore = getAccountStore()
  const nextAccount = applyLoginFailure(
    aStore.get(accountKey),
    alert,
    cfg.loginScheduleMs,
    cfg.loginResetAfterMs,
    nowMs,
  )
  aStore.set(accountKey, nextAccount)

  if (params.ip) {
    const decision = await getLimiters().loginIpSlug.consume(`${params.ip}:${slug}`, nowMs)
    if (!decision.allowed) {
      log.warn(
        {
          outcome: 'RATE_LIMITED',
          usernameHash: accountKey,
          ip: params.ip,
          scope: 'login:ip_slug',
        },
        'ip+slug safety net triggered on failed logins',
      )
    }
  }

  return {
    alert,
    tarpitMs: alert ? cfg.loginSlugTarpitMs : 0,
  }
}

export function recordLoginSuccess(email: string): void {
  const accountKey = keyForAccount(email)
  getAccountStore().delete(accountKey)
}

export function __setLoginLimiterClockForTests(nowFn: () => number): void {
  currentNowMs = nowFn
  accountStore = null
  slugAlertStore = null
}

export function resetLoginLimiterForTests(): void {
  currentNowMs = () => Date.now()
  accountStore?.clear()
  slugAlertStore?.clear()
  accountStore = null
  slugAlertStore = null
}
