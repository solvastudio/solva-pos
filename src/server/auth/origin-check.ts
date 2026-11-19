import '@tanstack/react-start/server-only'

export type OriginCheckResult =
  | { ok: true }
  | { ok: false; reason: string; origin: string | null }

function resolveTargetOrigin(request: Request): string {
  const url = new URL(request.url)
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || request.headers.get('host')?.trim()
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const proto = forwardedProto || url.protocol.replace(/:$/, '') || 'http'

  if (host) {
    return `${proto}://${host}`
  }
  return url.origin
}

/**
 * Enforces same-origin verification on mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`).
 */
export function checkSameOrigin(request: Request): OriginCheckResult {
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { ok: true }
  }

  const targetOrigin = resolveTargetOrigin(request)

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
      if (parsedOrigin !== targetOrigin) {
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
      if (parsedReferer !== targetOrigin) {
        return { ok: false, reason: 'referer mismatch', origin: parsedReferer }
      }
      return { ok: true }
    } catch {
      return { ok: false, reason: 'malformed referer header', origin: trimmed }
    }
  }

  return { ok: true }
}
