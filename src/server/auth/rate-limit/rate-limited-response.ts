import '@tanstack/react-start/server-only'
import { retryMinutes } from '~/lib/ratelimit/login-policy'
import { getContext } from '~/server/logging/log-context'
import { newRefId } from '~/server/logging/log-time'

export type RateLimitedKind = 'interactive' | 'transient'

export interface RateLimitedOptions {
  ref?: string
  random?: () => number
}

function applyTransientJitter(baseSec: number, random: () => number): number {
  const factor = 0.8 + random() * 0.4
  return Math.max(1, Math.round(baseSec * factor))
}

/**
 * Builds a HTTP 429 response with `Retry-After` seconds.
 * Interactive paths emit `retry_after_minutes` without jitter so UI wait messages stay exact;
 * device/sync transient paths jitter `Retry-After` ±20% to prevent thundering herds.
 */
export function rateLimitedResponse(
  retryAfterMs: number,
  kind: RateLimitedKind,
  opts?: RateLimitedOptions,
): Response {
  const baseSec = Math.max(1, Math.ceil(retryAfterMs / 1000))
  const retryAfterSec =
    kind === 'transient'
      ? applyTransientJitter(baseSec, opts?.random ?? Math.random)
      : baseSec
  const ref = opts?.ref ?? getContext()?.reqId ?? newRefId()

  if (kind === 'interactive') {
    return Response.json(
      {
        error: {
          code: 'RATE_LIMITED',
          class: 'authorization',
          ref,
        },
        retry_after_minutes: retryMinutes(retryAfterMs),
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSec),
        },
      },
    )
  }

  return Response.json(
    {
      error: {
        code: 'RATE_LIMITED',
        ref,
      },
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
      },
    },
  )
}
