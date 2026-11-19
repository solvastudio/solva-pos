import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  applyLoginFailure,
  delayForFailureCount,
  evaluateLogin,
  keyForAccount,
  parseDelayScheduleSec,
  retryMinutes,
  type AccountFailureState,
} from './login-policy'
import { sha256Hex } from './sha256'

const DEFAULT_SCHEDULE = parseDelayScheduleSec('0,0,0,30,60,120,300,900')
const RESET_AFTER_MS = 900_000

describe('login-policy (V-40, V-46)', () => {
  it('computes RFC SHA-256 digest and slug-independent account keys', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(keyForAccount('  Dewi@Example.Test ')).toBe(keyForAccount('dewi@example.test'))
    expect(keyForAccount('dewi@example.test')).toHaveLength(16)
  })

  it('V-40: enforces 0/0/0/30s/1m/2m/5m/15m schedule cleanly', () => {
    expect(delayForFailureCount(1, false, DEFAULT_SCHEDULE)).toBe(0)
    expect(delayForFailureCount(2, false, DEFAULT_SCHEDULE)).toBe(0)
    expect(delayForFailureCount(3, false, DEFAULT_SCHEDULE)).toBe(0)
    expect(delayForFailureCount(4, false, DEFAULT_SCHEDULE)).toBe(30_000)
    expect(delayForFailureCount(5, false, DEFAULT_SCHEDULE)).toBe(60_000)
    expect(delayForFailureCount(6, false, DEFAULT_SCHEDULE)).toBe(120_000)
    expect(delayForFailureCount(7, false, DEFAULT_SCHEDULE)).toBe(300_000)
    expect(delayForFailureCount(8, false, DEFAULT_SCHEDULE)).toBe(900_000)
    expect(delayForFailureCount(15, false, DEFAULT_SCHEDULE)).toBe(900_000)
  })

  it('V-46: global account delay applies across tenants with identical minute messaging', () => {
    let state: AccountFailureState | undefined
    const t0 = 1_000_000
    for (let i = 0; i < 8; i += 1) {
      state = applyLoginFailure(state, false, DEFAULT_SCHEDULE, RESET_AFTER_MS, t0 + i * 100)
    }
    const decisionOtherTenant = evaluateLogin({
      accountState: state,
      slugAlert: false,
      ipSlugBlockedUntilMs: 0,
      resetAfterMs: RESET_AFTER_MS,
      nowMs: t0 + 1000,
    })
    expect(decisionOtherTenant.allowed).toBe(false)
    expect(decisionOtherTenant.reason).toBe('ACCOUNT_DELAY')
    expect(retryMinutes(decisionOtherTenant.retryAfterMs)).toBe(15)
  })

  it('slug alert mode shifts schedule earlier (delay begins on 2nd failure)', () => {
    const t0 = 500_000
    const s1 = applyLoginFailure(undefined, true, DEFAULT_SCHEDULE, RESET_AFTER_MS, t0)
    expect(s1.blockedUntilMs).toBe(t0)
    const s2 = applyLoginFailure(s1, true, DEFAULT_SCHEDULE, RESET_AFTER_MS, t0 + 10)
    expect(s2.blockedUntilMs).toBe(t0 + 10 + 30_000)
  })

  it('resets automatically after resetAfterMs idle (no permanent lockout)', () => {
    const t0 = 100_000
    let state: AccountFailureState | undefined
    for (let i = 0; i < 8; i += 1) {
      state = applyLoginFailure(state, false, DEFAULT_SCHEDULE, RESET_AFTER_MS, t0)
    }
    expect(
      evaluateLogin({
        accountState: state,
        slugAlert: false,
        ipSlugBlockedUntilMs: 0,
        resetAfterMs: RESET_AFTER_MS,
        nowMs: t0 + RESET_AFTER_MS + 1,
      }),
    ).toEqual({ allowed: true, retryAfterMs: 0, reason: null })

    const nextFailure = applyLoginFailure(
      state,
      false,
      DEFAULT_SCHEDULE,
      RESET_AFTER_MS,
      t0 + RESET_AFTER_MS + 1,
    )
    expect(nextFailure.failures).toBe(1)
    expect(nextFailure.blockedUntilMs).toBe(t0 + RESET_AFTER_MS + 1)
  })

  it('property: no sequence of failures produces retryAfterMs > 900_000', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 50 }),
        (alertFlags) => {
          let state: AccountFailureState | undefined
          let nowMs = 1_000_000
          for (const alert of alertFlags) {
            nowMs += 500
            state = applyLoginFailure(state, alert, DEFAULT_SCHEDULE, RESET_AFTER_MS, nowMs)
            const evalRes = evaluateLogin({
              accountState: state,
              slugAlert: alert,
              ipSlugBlockedUntilMs: 0,
              resetAfterMs: RESET_AFTER_MS,
              nowMs,
            })
            expect(evalRes.retryAfterMs).toBeLessThanOrEqual(900_000)
            expect(evalRes.retryAfterMs).toBeGreaterThanOrEqual(0)
          }
        },
      ),
    )
  })
})
