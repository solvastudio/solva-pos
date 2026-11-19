import { isNotFound, isRedirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
import type { MutationActionResult } from '~/modules/identity/shared'
import { AppError } from '~/server/error-classify'
import { createLogger } from '~/server/log'
import { getContext } from '~/server/logging/log-context'
import { newRefId } from '~/server/logging/log-time'
import { toPublicError } from '~/server/public-error'

const log = createLogger('fn')

export const publicErrorMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    try {
      return await next()
    } catch (err: unknown) {
      if (isRedirect(err) || isNotFound(err) || err instanceof Response) {
        throw err
      }
      const reqId = getContext()?.reqId ?? newRefId()
      const pub = toPublicError(err, reqId)
      log.error({ err, publicCode: pub.code }, 'server function failed')
      const out = new Error(pub.message)
      delete out.stack
      throw out
    }
  },
)

/**
 * Wraps domain mutations so expected `VALIDATION_FAILED` i18n keys reach form handlers cleanly
 * while all unexpected or authorization errors continue flowing through `publicErrorMiddleware`.
 */
export async function runValidatedAction<T>(
  fn: () => Promise<T>,
): Promise<MutationActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err: unknown) {
    if (err instanceof AppError && err.code === 'VALIDATION_FAILED') {
      return { ok: false, errorKey: err.message }
    }
    throw err
  }
}
