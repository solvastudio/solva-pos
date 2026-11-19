import '@tanstack/react-start/server-only'
import type { Limiter } from '~/lib/ratelimit/limiter'
import { getRateLimitConfig } from '~/server/rate-limit-config'
import { createWindowLimiter } from './window-limiter'

export interface ConcurrencySemaphore {
  tryAcquire(key: string): (() => void) | null
  activeCount(key?: string): number
}

function createGlobalSemaphore(maxConcurrent: number): ConcurrencySemaphore {
  let active = 0
  return {
    tryAcquire(): (() => void) | null {
      if (active >= maxConcurrent) {
        return null
      }
      active += 1
      let released = false
      return () => {
        if (!released) {
          released = true
          active = Math.max(0, active - 1)
        }
      }
    },
    activeCount(): number {
      return active
    },
  }
}

function createKeyedSemaphore(maxPerKey: number): ConcurrencySemaphore {
  const counts = new Map<string, number>()
  return {
    tryAcquire(key: string): (() => void) | null {
      const current = counts.get(key) ?? 0
      if (current >= maxPerKey) {
        return null
      }
      counts.set(key, current + 1)
      let released = false
      return () => {
        if (!released) {
          released = true
          const next = (counts.get(key) ?? 1) - 1
          if (next <= 0) {
            counts.delete(key)
          } else {
            counts.set(key, next)
          }
        }
      }
    },
    activeCount(key?: string): number {
      if (key === undefined) {
        let sum = 0
        for (const v of counts.values()) sum += v
        return sum
      }
      return counts.get(key) ?? 0
    },
  }
}

export interface RateLimitersRegistry {
  loginIpSlug: Limiter
  slugProbe: Limiter
  enrollIp: Limiter
  enrollSlug: Limiter
  redeemEmail: Limiter
  redeemSlug: Limiter
  redeemIpSlug: Limiter
  issueTenant: Limiter
  issueEmail: Limiter
  badCredentialIp: Limiter
  devicePush: Limiter
  devicePull: Limiter
  devicePullFullPage: Limiter
  devicePing: Limiter
  deviceHandover: Limiter
  deviceLog: Limiter
  fullResync: Limiter
  pushSemaphore: ConcurrencySemaphore
  reportSemaphore: ConcurrencySemaphore
}

let cachedLimiters: RateLimitersRegistry | null = null

export function getLimiters(): RateLimitersRegistry {
  if (cachedLimiters) {
    return cachedLimiters
  }

  const cfg = getRateLimitConfig()
  cachedLimiters = {
    loginIpSlug: createWindowLimiter({
      name: 'login_ip_slug',
      points: cfg.loginIpSlugPoints,
      durationSec: cfg.loginIpSlugWindowSec,
      blockDurationSec: cfg.loginIpSlugBlockSec,
    }),
    slugProbe: createWindowLimiter({
      name: 'slug_probe',
      points: cfg.slugProbePoints,
      durationSec: cfg.slugProbeWindowSec,
    }),
    enrollIp: createWindowLimiter({
      name: 'enroll_ip',
      points: cfg.enrollIpPoints,
      durationSec: cfg.enrollIpWindowSec,
    }),
    enrollSlug: createWindowLimiter({
      name: 'enroll_slug',
      points: cfg.enrollSlugPoints,
      durationSec: cfg.enrollSlugWindowSec,
    }),
    redeemEmail: createWindowLimiter({
      name: 'redeem_email',
      points: cfg.redeemEmailPoints,
      durationSec: cfg.redeemEmailWindowSec,
    }),
    redeemSlug: createWindowLimiter({
      name: 'redeem_slug',
      points: cfg.redeemSlugPoints,
      durationSec: cfg.redeemSlugWindowSec,
    }),
    redeemIpSlug: createWindowLimiter({
      name: 'redeem_ip_slug',
      points: cfg.redeemIpSlugPoints,
      durationSec: cfg.redeemIpSlugWindowSec,
    }),
    issueTenant: createWindowLimiter({
      name: 'issue_tenant',
      points: cfg.issueTenantPerHour,
      durationSec: 3600,
    }),
    issueEmail: createWindowLimiter({
      name: 'issue_email',
      points: cfg.issueEmailPerHour,
      durationSec: 3600,
    }),
    badCredentialIp: createWindowLimiter({
      name: 'bad_credential_ip',
      points: cfg.badCredentialIpPoints,
      durationSec: cfg.badCredentialIpWindowSec,
    }),
    devicePush: createWindowLimiter({
      name: 'device_push',
      points: cfg.devicePushPerMin,
      durationSec: 60,
    }),
    devicePull: createWindowLimiter({
      name: 'device_pull',
      points: cfg.devicePullPerMin,
      durationSec: 60,
    }),
    devicePullFullPage: createWindowLimiter({
      name: 'device_pull_full_page',
      points: cfg.devicePullPerMin * 20,
      durationSec: 60,
    }),
    devicePing: createWindowLimiter({
      name: 'device_ping',
      points: cfg.devicePingPerMin,
      durationSec: 60,
    }),
    deviceHandover: createWindowLimiter({
      name: 'device_handover',
      points: cfg.deviceHandoverPerMin,
      durationSec: 60,
    }),
    deviceLog: createWindowLimiter({
      name: 'device_log',
      points: cfg.deviceLogPer10Min,
      durationSec: 600,
    }),
    fullResync: createWindowLimiter({
      name: 'full_resync',
      points: cfg.fullResyncPerHour,
      durationSec: 3600,
    }),
    pushSemaphore: createGlobalSemaphore(cfg.pushConcurrency),
    reportSemaphore: createKeyedSemaphore(cfg.reportConcurrencyPerTenant),
  }

  return cachedLimiters
}

export function resetLimitersForTests(): void {
  cachedLimiters = null
}
