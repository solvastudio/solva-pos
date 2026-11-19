import { describe, expect, it } from 'vitest'
import { isLocale, resolveLocale } from './resolve-locale'

describe('i18n/resolve-locale (BR-I18N-002)', () => {
  it('validates supported locales and enforces user > register > tenant > id-ID priority', () => {
    expect(isLocale('id-ID')).toBe(true)
    expect(isLocale('en-US')).toBe(true)
    expect(isLocale('fr-FR')).toBe(false)

    const cases: Array<{
      label: string
      input: { user?: string | null; register?: string | null; tenant?: string | null }
      expected: string
    }> = [
      {
        label: 'user overrides register and tenant',
        input: { user: 'en-US', register: 'id-ID', tenant: 'id-ID' },
        expected: 'en-US',
      },
      {
        label: 'register overrides tenant when user is null',
        input: { user: null, register: 'en-US', tenant: 'id-ID' },
        expected: 'en-US',
      },
      {
        label: 'tenant applies when user and register are null',
        input: { user: null, register: null, tenant: 'en-US' },
        expected: 'en-US',
      },
      {
        label: 'all empty falls back to id-ID',
        input: {},
        expected: 'id-ID',
      },
      {
        label: 'unknown values fall through to the next level',
        input: { user: 'fr-FR', register: 'ja-JP', tenant: 'en-US' },
        expected: 'en-US',
      },
      {
        label: 'all unknown values fall back to id-ID',
        input: { user: 'fr-FR', register: 'ms-MY', tenant: 'xx' },
        expected: 'id-ID',
      },
    ]

    for (const c of cases) {
      expect(resolveLocale(c.input), c.label).toBe(c.expected)
    }
  })
})
