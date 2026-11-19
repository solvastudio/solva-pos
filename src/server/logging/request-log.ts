import '@tanstack/react-start/server-only'
import { createLogger } from '../log'
import { runWithContext, type LogContext } from './log-context'
import { resolveRequestId } from './request-id'

const log = createLogger('http')

const MAX_PATH_LEN = 200

export interface RequestLogOptions {
  env?: string
  appVersion?: string
  nowMs?: number
}

function runtimeAppVersion(explicit?: string): string {
  if (explicit) return explicit
  if (typeof __APP_VERSION__ !== 'undefined') return __APP_VERSION__
  return process.env.APP_VERSION ?? 'v0.0.0-dev'
}

function attachRequestIdHeader(response: Response, reqId: string): Response {
  try {
    response.headers.set('X-Request-Id', reqId)
    return response
  } catch {
    const headers = new Headers(response.headers)
    headers.set('X-Request-Id', reqId)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

export async function handleRequestWithLog(
  request: Request,
  next: (req: Request) => Promise<Response> | Response,
  options: RequestLogOptions = {},
): Promise<Response> {
  const startedAt = performance.now()
  const reqId = resolveRequestId(request.headers.get('x-request-id'), options.nowMs)
  const url = new URL(request.url)
  // Hanya pathname yang ditulis (tanpa query string agar token/parameter sensitif tidak bocor)
  const path = url.pathname.slice(0, MAX_PATH_LEN)

  const ctx: LogContext = {
    reqId,
    env: options.env ?? process.env.APP_ENV ?? 'development',
    appVersion: runtimeAppVersion(options.appVersion),
  }

  return runWithContext(ctx, async () => {
    let response: Response
    try {
      response = await next(request)
    } catch (err: unknown) {
      const durationMs = Math.round(performance.now() - startedAt)
      log.error({ err, method: request.method, path, status: 500, durationMs }, 'request failed')
      return Response.json(
        { error: { code: 'INTERNAL_ERROR', ref: reqId } },
        { status: 500, headers: { 'X-Request-Id': reqId } },
      )
    }

    const finished = attachRequestIdHeader(response, reqId)
    const durationMs = Math.round(performance.now() - startedAt)

    if (path !== '/health') {
      log.info(
        {
          method: request.method,
          path,
          status: finished.status,
          durationMs,
        },
        'access',
      )
    }

    return finished
  })
}
