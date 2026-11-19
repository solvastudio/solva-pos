import { describe, expect, it } from 'vitest'
import { isLocale, resolveLocale } from './resolve-locale'

describe('i18n/resolve-locale (BR-I18N-002)', () => {
  it('memvalidasi locale sah dan mengurutkan prioritas user > register > tenant > id-ID', () => {
    expect(isLocale('id-ID')).toBe(true)
    expect(isLocale('en-US')).toBe(true)
    expect(isLocale('fr-FR')).toBe(false)

    const cases: Array<{
      label: string
      input: { user?: string | null; register?: string | null; tenant?: string | null }
      expected: string
    }> = [
      {
        label: 'user menang atas register & tenant',
        input: { user: 'en-US', register: 'id-ID', tenant: 'id-ID' },
        expected: 'en-US',
      },
      {
        label: 'register menang bila user null',
        input: { user: null, register: 'en-US', tenant: 'id-ID' },
        expected: 'en-US',
      },
      {
        label: 'tenant menang bila user & register null',
        input: { user: null, register: null, tenant: 'en-US' },
        expected: 'en-US',
      },
      {
        label: 'semua kosong jatuh ke id-ID',
        input: {},
        expected: 'id-ID',
      },
      {
        label: 'nilai tak dikenal dilewati ke tingkat berikutnya',
        input: { user: 'fr-FR', register: 'ja-JP', tenant: 'en-US' },
        expected: 'en-US',
      },
      {
        label: 'semua tak dikenal jatuh ke id-ID',
        input: { user: 'fr-FR', register: 'ms-MY', tenant: 'xx' },
        expected: 'id-ID',
      },
    ]

    for (const c of cases) {
      expect(resolveLocale(c.input), c.label).toBe(c.expected)
    }
  })
})
