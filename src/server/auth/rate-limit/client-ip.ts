import '@tanstack/react-start/server-only'
import { getRequestIP } from '@tanstack/react-start/server'
import { resolveClientIp } from '~/lib/ratelimit/ip'
import { getRateLimitConfig } from '~/server/rate-limit-config'

function tryStartRequestIp(): string | undefined {
  try {
    return getRequestIP({ xForwardedFor: false })
  } catch {
    return undefined
  }
}

/**
 * Resolves the client IP using socket remote address (or explicit `remoteAddress`
 * when supplied) and `X-Real-IP` only when the remote address belongs to
 * `TRUSTED_PROXY_CIDR`. Never reads `X-Forwarded-For`.
 */
export function getClientIp(request: Request, remoteAddress?: string): string | undefined {
  const { trustedProxyCidrs } = getRateLimitConfig()
  const resolvedRemote = remoteAddress ?? tryStartRequestIp()
  return resolveClientIp({
    remoteAddress: resolvedRemote,
    xRealIp: request.headers.get('x-real-ip'),
    trustedCidrs: trustedProxyCidrs,
  })
}
