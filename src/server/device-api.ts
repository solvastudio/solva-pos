import '@tanstack/react-start/server-only'
import type { ZodType } from 'zod'
import {
  HEADER_APP_VERSION,
  HEADER_SCHEMA_VERSION,
  HEADER_SYNC_PROTOCOL,
} from '~/lib/contracts'
import {
  authenticateDevice,
  EnrollConflictError,
  RateLimitRejectedError,
  type DeviceContext,
} from '~/modules/identity/public'
import { PullRateLimitedError } from '~/modules/sync/public'
import { getClientIp } from './auth/rate-limit/client-ip'
import { getLimiters, type RateLimitersRegistry } from './auth/rate-limit/limiters'
import { rateLimitedResponse } from './auth/rate-limit/rate-limited-response'
import { AppError } from './error-classify'
import { createLogger } from './log'
import { getContext, setContextField } from './logging/log-context'
import { newRefId } from './logging/log-time'
import { handleRequestWithLog } from './logging/request-log'
import { toPublicError } from './public-error'

const log = createLogger('device.api')

export interface DeviceRequestMeta {
  ip: string
  reqId: string
  schemaVersion: number | null
  syncProtocolVersion: number | null
  appVersion: string | null
}

export interface DeviceRouteOptions {
  auth: boolean
  rateLimiter?: Exclude<
    keyof RateLimitersRegistry,
    'pushSemaphore' | 'reportSemaphore'
  >
  nowMs?: () => number
}

function parsePositiveIntHeader(raw: string | null): number | null {
  if (!raw) return null
  const num = Number(raw.trim())
  return Number.isSafeInteger(num) && num > 0 ? num : null
}

export function serverAppVersion(): string {
  if (typeof __APP_VERSION__ !== 'undefined') return __APP_VERSION__
  return process.env.APP_VERSION ?? 'v0.0.0-dev'
}

function readDeviceHeaders(request: Request): {
  schemaVersion: number | null
  syncProtocolVersion: number | null
  appVersion: string | null
} {
  const schemaVersion = parsePositiveIntHeader(request.headers.get(HEADER_SCHEMA_VERSION))
  const syncProtocolVersion = parsePositiveIntHeader(request.headers.get(HEADER_SYNC_PROTOCOL))
  const rawAppVer = request.headers.get(HEADER_APP_VERSION)?.trim() || null
  const appVersion = rawAppVer ? rawAppVer.slice(0, 64) : null

  if (schemaVersion !== null) {
    setContextField('schemaVersion', schemaVersion)
  }
  if (appVersion !== null) {
    setContextField('appVersion', appVersion)
  }

  return { schemaVersion, syncProtocolVersion, appVersion }
}

export function deviceRoute(
  handler: (input: {
    request: Request
    device: DeviceContext | null
    meta: DeviceRequestMeta
  }) => Promise<Response>,
  options: DeviceRouteOptions,
): (request: Request) => Promise<Response> {
  return (request: Request) =>
    handleRequestWithLog(request, async (req) => {
      const reqId = getContext()?.reqId ?? newRefId()
      const nowMs = (options.nowMs ?? (() => Date.now()))()
      const ip = getClientIp(req) ?? '0.0.0.0'
      const headersMeta = readDeviceHeaders(req)

      try {
        let device: DeviceContext | null = null
        if (options.auth) {
          device = await authenticateDevice(req, { nowMs: () => nowMs })
          if (options.rateLimiter) {
            const decision = await getLimiters()[options.rateLimiter].consume(
              device.deviceId,
              nowMs,
            )
            if (!decision.allowed) {
              log.warn(
                {
                  deviceId: device.deviceId,
                  tenantId: device.tenantId,
                  scope: `device:${String(options.rateLimiter)}`,
                  outcome: 'RATE_LIMITED',
                },
                'device API rate limited',
              )
              return rateLimitedResponse(decision.retryAfterMs, 'transient', { ref: reqId })
            }
          }
        }

        return await handler({
          request: req,
          device,
          meta: {
            ip,
            reqId,
            ...headersMeta,
          },
        })
      } catch (err: unknown) {
        if (err instanceof RateLimitRejectedError) {
          return rateLimitedResponse(err.retryAfterMs, err.kind, { ref: reqId })
        }
        if (err instanceof PullRateLimitedError) {
          return rateLimitedResponse(err.retryAfterMs, 'transient', { ref: reqId })
        }
        if (err instanceof EnrollConflictError) {
          return Response.json(
            {
              reason: err.reason,
              error: {
                code: err.reason,
                ref: reqId,
                class: 'business',
              },
            },
            { status: 409 },
          )
        }

        const pub = toPublicError(err, reqId)
        return Response.json(
          {
            error: {
              code: pub.code,
              ref: pub.ref,
              class: pub.class,
            },
          },
          { status: pub.status },
        )
      }
    })
}

export async function parseDeviceJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Malformed JSON body')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid request payload')
  }
  return parsed.data
}

export function noStoreJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
