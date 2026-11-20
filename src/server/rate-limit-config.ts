import '@tanstack/react-start/server-only'
import { parseDelayScheduleSec } from '~/lib/ratelimit/login-policy'
import { getEnv } from './env'

export const RATE_LIMIT_ENV_KEYS = [
  'RL_LOGIN_SCHEDULE_SEC',
  'RL_LOGIN_RESET_AFTER_SEC',
  'RL_LOGIN_SLUG_ALERT_THRESHOLD',
  'RL_LOGIN_SLUG_ALERT_WINDOW_SEC',
  'RL_LOGIN_SLUG_TARPIT_MS',
  'RL_LOGIN_IPSLUG_POINTS',
  'RL_LOGIN_IPSLUG_WINDOW_SEC',
  'RL_LOGIN_IPSLUG_BLOCK_SEC',
  'RL_LOGIN_KEY_MAX',
  'RL_ENROLL_IP_POINTS',
  'RL_ENROLL_IP_WINDOW_SEC',
  'RL_ENROLL_SLUG_POINTS',
  'RL_ENROLL_SLUG_WINDOW_SEC',
  'RL_REDEEM_EMAIL_POINTS',
  'RL_REDEEM_EMAIL_WINDOW_SEC',
  'RL_REDEEM_SLUG_POINTS',
  'RL_REDEEM_SLUG_WINDOW_SEC',
  'RL_REDEEM_IPSLUG_POINTS',
  'RL_REDEEM_IPSLUG_WINDOW_SEC',
  'RL_ISSUE_TENANT_PER_HOUR',
  'RL_ISSUE_EMAIL_PER_HOUR',
  'RL_SLUG_PROBE_POINTS',
  'RL_SLUG_PROBE_WINDOW_SEC',
  'RL_BAD_CREDENTIAL_IP_POINTS',
  'RL_BAD_CREDENTIAL_IP_WINDOW_SEC',
  'RL_DEVICE_PUSH_PER_MIN',
  'RL_DEVICE_PULL_PER_MIN',
  'RL_DEVICE_PING_PER_MIN',
  'RL_DEVICE_HANDOVER_PER_MIN',
  'RL_DEVICE_LOG_PER_10MIN',
  'RL_DEVICE_INVOICE_PER_MIN',
  'RL_FULL_RESYNC_PER_HOUR',
  'RL_PUSH_CONCURRENCY',
  'RL_REPORT_CONCURRENCY_PER_TENANT',
] as const

export interface RateLimitConfig {
  loginScheduleMs: readonly number[]
  loginResetAfterMs: number
  loginSlugAlertThreshold: number
  loginSlugAlertWindowMs: number
  loginSlugTarpitMs: number
  loginIpSlugPoints: number
  loginIpSlugWindowSec: number
  loginIpSlugBlockSec: number
  loginKeyMax: number
  enrollIpPoints: number
  enrollIpWindowSec: number
  enrollSlugPoints: number
  enrollSlugWindowSec: number
  redeemEmailPoints: number
  redeemEmailWindowSec: number
  redeemSlugPoints: number
  redeemSlugWindowSec: number
  redeemIpSlugPoints: number
  redeemIpSlugWindowSec: number
  issueTenantPerHour: number
  issueEmailPerHour: number
  slugProbePoints: number
  slugProbeWindowSec: number
  badCredentialIpPoints: number
  badCredentialIpWindowSec: number
  devicePushPerMin: number
  devicePullPerMin: number
  devicePingPerMin: number
  deviceHandoverPerMin: number
  deviceLogPer10Min: number
  deviceInvoicePerMin: number
  fullResyncPerHour: number
  pushConcurrency: number
  reportConcurrencyPerTenant: number
  trustedProxyCidrs: readonly string[]
}

export function getRateLimitConfig(): RateLimitConfig {
  const env = getEnv()
  const trustedProxyCidrs = env.TRUSTED_PROXY_CIDR
    ? env.TRUSTED_PROXY_CIDR.split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
    : []

  return {
    loginScheduleMs: parseDelayScheduleSec(env.RL_LOGIN_SCHEDULE_SEC),
    loginResetAfterMs: env.RL_LOGIN_RESET_AFTER_SEC * 1000,
    loginSlugAlertThreshold: env.RL_LOGIN_SLUG_ALERT_THRESHOLD,
    loginSlugAlertWindowMs: env.RL_LOGIN_SLUG_ALERT_WINDOW_SEC * 1000,
    loginSlugTarpitMs: env.RL_LOGIN_SLUG_TARPIT_MS,
    loginIpSlugPoints: env.RL_LOGIN_IPSLUG_POINTS,
    loginIpSlugWindowSec: env.RL_LOGIN_IPSLUG_WINDOW_SEC,
    loginIpSlugBlockSec: env.RL_LOGIN_IPSLUG_BLOCK_SEC,
    loginKeyMax: env.RL_LOGIN_KEY_MAX,
    enrollIpPoints: env.RL_ENROLL_IP_POINTS,
    enrollIpWindowSec: env.RL_ENROLL_IP_WINDOW_SEC,
    enrollSlugPoints: env.RL_ENROLL_SLUG_POINTS,
    enrollSlugWindowSec: env.RL_ENROLL_SLUG_WINDOW_SEC,
    redeemEmailPoints: env.RL_REDEEM_EMAIL_POINTS,
    redeemEmailWindowSec: env.RL_REDEEM_EMAIL_WINDOW_SEC,
    redeemSlugPoints: env.RL_REDEEM_SLUG_POINTS,
    redeemSlugWindowSec: env.RL_REDEEM_SLUG_WINDOW_SEC,
    redeemIpSlugPoints: env.RL_REDEEM_IPSLUG_POINTS,
    redeemIpSlugWindowSec: env.RL_REDEEM_IPSLUG_WINDOW_SEC,
    issueTenantPerHour: env.RL_ISSUE_TENANT_PER_HOUR,
    issueEmailPerHour: env.RL_ISSUE_EMAIL_PER_HOUR,
    slugProbePoints: env.RL_SLUG_PROBE_POINTS,
    slugProbeWindowSec: env.RL_SLUG_PROBE_WINDOW_SEC,
    badCredentialIpPoints: env.RL_BAD_CREDENTIAL_IP_POINTS,
    badCredentialIpWindowSec: env.RL_BAD_CREDENTIAL_IP_WINDOW_SEC,
    devicePushPerMin: env.RL_DEVICE_PUSH_PER_MIN,
    devicePullPerMin: env.RL_DEVICE_PULL_PER_MIN,
    devicePingPerMin: env.RL_DEVICE_PING_PER_MIN,
    deviceHandoverPerMin: env.RL_DEVICE_HANDOVER_PER_MIN,
    deviceLogPer10Min: env.RL_DEVICE_LOG_PER_10MIN,
    deviceInvoicePerMin: env.RL_DEVICE_INVOICE_PER_MIN,
    fullResyncPerHour: env.RL_FULL_RESYNC_PER_HOUR,
    pushConcurrency: env.RL_PUSH_CONCURRENCY,
    reportConcurrencyPerTenant: env.RL_REPORT_CONCURRENCY_PER_TENANT,
    trustedProxyCidrs,
  }
}
