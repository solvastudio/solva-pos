import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError } from './error-classify'
import { parseOrThrow } from './parse-or-throw'

describe('parseOrThrow', () => {
  const schema = z.object({ n: z.number().min(1, 'too small') })

  it('returns parsed data on success', () => {
    expect(parseOrThrow(schema, { n: 2 }, 'fallback')).toEqual({ n: 2 })
  })

  it('throws VALIDATION_FAILED with the first issue message', () => {
    expect(() => parseOrThrow(schema, { n: 0 }, 'fallback')).toThrowError(
      expect.objectContaining({ message: 'too small' }),
    )
    try {
      parseOrThrow(schema, { n: 0 }, 'fallback')
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).code).toBe('VALIDATION_FAILED')
    }
  })
})
