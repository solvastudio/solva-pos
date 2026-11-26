import { describe, expect, it } from 'vitest'
import {
  APP_VERSION,
  compareSemver,
  formatVersionFooter,
  isAppVersion,
  normalizeSemverAppVersion,
  parseSemver,
} from './index'

describe('app-version semver utilities', () => {
  it('parses and validates SemVer strings matching vMAJOR.MINOR.PATCH[-pre][+build]', () => {
    expect(APP_VERSION.length).toBeGreaterThan(0)
    expect(parseSemver('v1.6.2')).toEqual({ major: 1, minor: 6, patch: 2, pre: [] })
    expect(parseSemver('v1.6.2-rc.1')).toEqual({
      major: 1,
      minor: 6,
      patch: 2,
      pre: ['rc', '1'],
    })
    expect(isAppVersion('v0.0.1')).toBe(true)
    expect(isAppVersion('1.6.2')).toBe(false)
    expect(isAppVersion('v1.6')).toBe(false)
    expect(isAppVersion(`v1.0.0-${'x'.repeat(25)}`)).toBe(false)
  })

  it('compares SemVer versions numerically rather than lexicographically', () => {
    expect(compareSemver('v1.10.0', 'v1.9.9')).toBe(1)
    expect(compareSemver('v1.9.9', 'v1.10.0')).toBe(-1)
    expect(compareSemver('v1.6.2-rc.1', 'v1.6.2')).toBe(-1)
    expect(compareSemver('v1.6.2', 'v1.6.2-rc.1')).toBe(1)
    expect(compareSemver('v1.6.2-rc.2', 'v1.6.2-rc.10')).toBe(-1)
    expect(compareSemver('v1.6.2+build.1', 'v1.6.2+build.99')).toBe(0)
    expect(() => compareSemver('invalid', 'v1.0.0')).toThrow(RangeError)
  })

  it('formats footer display string with optional contract number (V-32)', () => {
    expect(formatVersionFooter('v1.6.0', 8)).toBe('Solva POS v1.6.0')
    expect(formatVersionFooter('v1.6.0', 8, { withContract: true })).toBe(
      'Solva POS v1.6.0 · kontrak 8',
    )
  })

  it('normalizes reported app versions: optional v prefix, trimmed, max 30 chars, otherwise null', () => {
    expect(normalizeSemverAppVersion('v1.6.2')).toBe('v1.6.2')
    expect(normalizeSemverAppVersion('1.6.2-rc.1')).toBe('1.6.2-rc.1')
    expect(normalizeSemverAppVersion('  v1.6.2  ')).toBe('v1.6.2')
    expect(normalizeSemverAppVersion(null)).toBeNull()
    expect(normalizeSemverAppVersion('')).toBeNull()
    expect(normalizeSemverAppVersion('dev')).toBeNull()
    expect(normalizeSemverAppVersion(`v1.0.0-${'a'.repeat(30)}`)).toBeNull()
  })
})
