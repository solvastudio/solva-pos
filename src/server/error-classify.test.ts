import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError, classifyError } from './error-classify'
import { toPublicError } from './public-error'

describe('server/error-classify & public-error', () => {
  it('classifies AppError, pg codes, ZodError, cause chains, and generic errors', () => {
    const zodErr = z.object({ id: z.number() }).safeParse({ id: 'x' }).error

    const cases: Array<{ label: string; err: unknown; code: string; status: number; retriable: boolean }> = [
      {
        label: 'AppError UNAUTHORIZED',
        err: new AppError('UNAUTHORIZED', 'internal secret'),
        code: 'UNAUTHORIZED',
        status: 401,
        retriable: false,
      },
      {
        label: 'pg 57014 statement_timeout',
        err: Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }),
        code: 'TIMEOUT',
        status: 504,
        retriable: true,
      },
      {
        label: 'pg 55P03 lock_timeout',
        err: Object.assign(new Error('lock'), { code: '55P03' }),
        code: 'DB_UNAVAILABLE',
        status: 503,
        retriable: true,
      },
      {
        label: 'pg 40001 serialization_failure',
        err: Object.assign(new Error('ser'), { code: '40001' }),
        code: 'DB_UNAVAILABLE',
        status: 503,
        retriable: true,
      },
      {
        label: 'pg 40P01 deadlock_detected',
        err: Object.assign(new Error('deadlock'), { code: '40P01' }),
        code: 'DB_UNAVAILABLE',
        status: 503,
        retriable: true,
      },
      {
        label: 'pg 08006 connection_failure',
        err: Object.assign(new Error('conn'), { code: '08006' }),
        code: 'DB_UNAVAILABLE',
        status: 503,
        retriable: true,
      },
      {
        label: 'pg 57P01 / 53300',
        err: Object.assign(new Error('admin shutdown'), { code: '57P01' }),
        code: 'DB_UNAVAILABLE',
        status: 503,
        retriable: true,
      },
      {
        label: 'ZodError',
        err: zodErr,
        code: 'VALIDATION_FAILED',
        status: 400,
        retriable: false,
      },
      {
        label: 'nested cause pg 57014',
        err: new Error('drizzle wrapper', {
          cause: Object.assign(new Error('timeout'), { code: '57014' }),
        }),
        code: 'TIMEOUT',
        status: 504,
        retriable: true,
      },
      {
        label: 'unknown Error -> INTERNAL_ERROR',
        err: new Error('secret SQL pin=9999'),
        code: 'INTERNAL_ERROR',
        status: 500,
        retriable: false,
      },
    ]

    for (const c of cases) {
      const actual = classifyError(c.err)
      expect(actual.code, c.label).toBe(c.code)
      expect(actual.status, c.label).toBe(c.status)
      expect(actual.retriable, c.label).toBe(c.retriable)
    }
  })

  it('toPublicError returns CODE#ref only without leaking raw error messages', () => {
    const pub = toPublicError(new Error('secret SQL password'), '20261119-140500-k7q2m')
    expect(pub).toEqual({
      code: 'INTERNAL_ERROR',
      ref: '20261119-140500-k7q2m',
      class: 'system',
      status: 500,
      message: 'INTERNAL_ERROR#20261119-140500-k7q2m',
    })
    expect(pub.message).not.toContain('password')
  })
})
