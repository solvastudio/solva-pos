import { DrizzleQueryError } from 'drizzle-orm/errors'
import { describe, expect, it } from 'vitest'
import { safeFailureDetail } from './push.service'

describe('safeFailureDetail', () => {
  it('never exposes SQL text or bound parameters from Drizzle query errors', () => {
    const cause = Object.assign(new Error('duplicate key value violates unique constraint "uq_sale"'), {
      code: '23505',
      severity: 'ERROR',
    })
    const err = new DrizzleQueryError(
      'insert into "sale" ("customer_name", "customer_phone") values ($1, $2)',
      ['Budi Santoso', '081234567890'],
      cause,
    )

    const detail = safeFailureDetail(err)

    expect(detail).toContain('DrizzleQueryError')
    expect(detail).toContain('23505')
    expect(detail).not.toContain('Budi')
    expect(detail).not.toContain('0812')
    expect(detail).not.toMatch(/insert into|params:|customer_phone/i)
  })

  it('keeps a plain handler error readable and bounds the cause chain depth', () => {
    const deep = new Error('level-4', { cause: new Error('level-5') })
    const err = new TypeError('level-1', {
      cause: new Error('level-2', { cause: new Error('level-3', { cause: deep }) }),
    })

    const detail = safeFailureDetail(err)

    expect(detail.startsWith('TypeError: level-1')).toBe(true)
    expect(detail).toContain('level-3')
    expect(detail).not.toContain('level-4')
  })

  it('describes non-Error throwables without leaking structure', () => {
    expect(safeFailureDetail('boom')).toBe('NonError: boom')
    expect(safeFailureDetail({ secret: 'x' })).toBe('NonError: [object]')
  })
})
