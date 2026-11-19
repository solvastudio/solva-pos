import { isNotFound, isRedirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
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
