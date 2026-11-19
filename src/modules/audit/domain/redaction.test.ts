import { describe, expect, it } from 'vitest'
import { assertNoSensitive, SensitiveAuditDataError } from './redaction'

describe('audit/domain redaction guard', () => {
  it('rejects sensitive keys at top-level and nested paths', () => {
    for (const payload of [
      { pin: '1234' },
      { pin_hash: 'abc' },
      { nested: { token: 'xyz' } },
      { items: [{ secret_key: '1' }] },
      { customer_name: 'Budi' },
      { customer_phone: '0812345' },
      { phone: '0812345' },
      { password: 'pw' },
    ]) {
      expect(() => assertNoSensitive(payload)).toThrowError(SensitiveAuditDataError)
    }
  })

  it('accepts safe business audit payloads', () => {
    expect(() => assertNoSensitive(null)).not.toThrow()
    expect(() => assertNoSensitive(undefined)).not.toThrow()
    expect(() =>
      assertNoSensitive({
        price: 19000,
        method_code: 'QRIS',
        outlet: { name: 'Main Outlet', reason_code: 'MANUAL' },
      }),
    ).not.toThrow()
  })
})
