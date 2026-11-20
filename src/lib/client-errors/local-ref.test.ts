import { describe, expect, it } from 'vitest'
import { LOCAL_REF_PATTERN } from '~/lib/contracts'
import { formatPublicCode } from '~/lib/contracts/error-codes'
import { newLocalRef } from './local-ref'
import {
  clearClientErrorBufferForTests,
  getClientErrorBufferForTests,
  logClientError,
  scrubClientContext,
} from './report-schema'

describe('client-errors local-ref and scrubbing', () => {
  it('generates UTC D-YYYYMMDD-HHmmss-xxxxx matching V-37 and deterministic with fixed RNG', () => {
    const ms = Date.UTC(2026, 10, 18, 14, 3, 22)
    const ref = newLocalRef(ms, () => 0.5)
    expect(ref).toMatch(LOCAL_REF_PATTERN)
    expect(ref.startsWith('D-20261118-140322-')).toBe(true)
    expect(newLocalRef(ms, () => 0.5)).toBe(ref)

    const formatted = formatPublicCode('PRINT_FAILED', ref)
    expect(formatted).toMatch(/^PRINT_FAILED#D-\d{8}-\d{6}-[a-hj-km-np-z2-9]{5}$/)
  })

  it('scrubs sensitive keys and nested objects from client error reports', () => {
    clearClientErrorBufferForTests()
    const safe = scrubClientContext({
      pin: '1234',
      customerName: 'Alice',
      token: 'secret',
      nested: { cart: [] },
      retryCount: 3,
      screen: 'pos',
    })
    expect(safe).toEqual({ retryCount: 3, screen: 'pos' })

    const logged = logClientError({
      code: 'APP_ERROR',
      route: '/toko/pos',
      ctx: { pin: '9999', step: 'render' },
    })
    expect(logged.ctx).toEqual({ step: 'render' })
    expect(getClientErrorBufferForTests()).toHaveLength(1)
  })
})
