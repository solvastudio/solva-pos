import { describe, expect, it } from 'vitest'
import { validatePin } from './pin-policy'

describe('identity/domain/pin-policy', () => {
  it.each([
    ['', 'LENGTH'],
    ['123', 'LENGTH'],
    ['1234567', 'LENGTH'],
    ['12a4', 'NOT_DIGITS'],
    ['12 4', 'NOT_DIGITS'],
    ['0000', 'WEAK'],
    ['11111', 'WEAK'],
    ['999999', 'WEAK'],
    ['1234', 'WEAK'],
    ['23456', 'WEAK'],
    ['012345', 'WEAK'],
    ['4321', 'WEAK'],
    ['987654', 'WEAK'],
  ] as const)('rejects %j with %s', (pin, reason) => {
    expect(validatePin(pin)).toEqual({ ok: false, reason })
  })

  it.each(['4827', '1357', '1123', '48271', '482719', '9081', '1235'])('accepts %s', (pin) => {
    expect(validatePin(pin)).toEqual({ ok: true })
  })
})
