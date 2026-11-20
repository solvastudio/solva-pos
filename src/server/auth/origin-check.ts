import '@tanstack/react-start/server-only'
import { getEnv, getPublicBaseUrl } from '~/server/env'

export type OriginCheckResult =
  | { ok: true }
  | { ok: false; reason: string; origin: string | null }

function getConfiguredOriginAndMode(): { origin: string; isNonDev: boolean } {
  const appEnv = process.env.APP_ENV
  if (appEnv) {
    const parsed = getEnv()
    const isNonDev = parsed.APP_ENV === 'staging' || parsed.APP_ENV === 'production'
    const baseUrl = getPublicBaseUrl()
    return { origin: new URL(baseUrl).origin, isNonDev }
  }
  const fallbackRaw = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
  return { origin: new URL(fallbackRaw).origin, isNonDev: false }
}

/**
 * Returns trusted origins for Better Auth (`trustedOrigins`) and CSRF origin checks.
 * - In `staging` and `production`: strictly returns ONLY the configured `PUBLIC_BASE_URL` origin.
 * - In `development`: returns `PUBLIC_BASE_URL` (default `http://localhost:3000`) plus optional
 *   `Host` fallback for local dev ports. Never reads untrusted `X-Forwarded-Host`.
 */
export function getTrustedOrigins(request?: Request): string[] {
  const { origin: configuredOrigin, isNonDev } = getConfiguredOriginAndMode()
  if (isNonDev) {
    return [configuredOrigin]
  }

  const origins = new Set<string>([configuredOrigin])
  if (request) {
    const url = new URL(request.url)
    const host = request.headers.get('host')?.trim()
    const rawProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
    const proto = rawProto === 'http' || rawProto === 'https'
      ? rawProto
      : url.protocol.replace(/:$/, '') || 'http'
    if (host) {
      try {
        origins.add(new URL(`${proto}://${host}`).origin)
      } catch {
        // Ignore malformed Host header in dev.
      }
    }
    origins.add(url.origin)
  }

  return [...origins]
}

/**
 * Enforces same-origin verification on mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`).
 */
export function checkSameOrigin(request: Request): OriginCheckResult {
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { ok: true }
  }

  const trustedOrigins = new Set(getTrustedOrigins(request))

  const secFetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase()
  if (secFetchSite === 'cross-site') {
    return {
      ok: false,
      reason: 'cross-site fetch metadata',
      origin: request.headers.get('origin'),
    }
  }

  const originHeader = request.headers.get('origin')
  if (originHeader !== null) {
    const trimmed = originHeader.trim()
    if (!trimmed || trimmed === 'null') {
      return { ok: false, reason: 'null origin header', origin: trimmed || null }
    }
    try {
      const parsedOrigin = new URL(trimmed).origin
      if (!trustedOrigins.has(parsedOrigin)) {
        return { ok: false, reason: 'origin mismatch', origin: parsedOrigin }
      }
      return { ok: true }
    } catch {
      return { ok: false, reason: 'malformed origin header', origin: trimmed }
    }
  }

  const refererHeader = request.headers.get('referer')
  if (refererHeader !== null) {
    const trimmed = refererHeader.trim()
    if (!trimmed) {
      return { ok: false, reason: 'empty referer header', origin: null }
    }
    try {
      const parsedReferer = new URL(trimmed).origin
      if (!trustedOrigins.has(parsedReferer)) {
        return { ok: false, reason: 'referer mismatch', origin: parsedReferer }
      }
      return { ok: true }
    } catch {
      return { ok: false, reason: 'malformed referer header', origin: trimmed }
    }
  }

  return { ok: true }
}
