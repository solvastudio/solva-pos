import { describe, expect, it } from 'vitest'
import { deriveRoleCode } from './role-code'

const CODE_PATTERN = /^[A-Z_]{2,30}$/

describe('deriveRoleCode', () => {
  it('uppercases, joins words with underscores and drops digits', () => {
    expect(deriveRoleCode('Kepala Dapur', new Set())).toBe('KEPALA_DAPUR')
    expect(deriveRoleCode('Kasir 2', new Set())).toBe('KASIR')
    expect(deriveRoleCode('  Gudang -- Utama!  ', new Set())).toBe('GUDANG_UTAMA')
  })

  it('strips accents', () => {
    expect(deriveRoleCode('Pelayan Café', new Set())).toBe('PELAYAN_CAFE')
  })

  it('falls back to ROLE when no letters remain', () => {
    expect(deriveRoleCode('1234', new Set())).toBe('ROLE')
    expect(deriveRoleCode('日本', new Set())).toBe('ROLE')
  })

  it('appends a letter suffix when the code is taken', () => {
    expect(deriveRoleCode('Kasir', new Set(['KASIR']))).toBe('KASIR_A')
    expect(deriveRoleCode('Kasir', new Set(['KASIR', 'KASIR_A']))).toBe('KASIR_B')
    const taken = new Set([
      'KASIR',
      ...Array.from({ length: 26 }, (_, i) => `KASIR_${String.fromCharCode(65 + i)}`),
    ])
    expect(deriveRoleCode('Kasir', taken)).toBe('KASIR_AA')
  })

  it('never exceeds 30 characters and always matches the database check', () => {
    const long = 'Penanggung Jawab Operasional Harian Seluruh Cabang'
    const base = deriveRoleCode(long, new Set())
    expect(base.length).toBeLessThanOrEqual(30)
    expect(base).toMatch(CODE_PATTERN)
    const suffixed = deriveRoleCode(long, new Set([base]))
    expect(suffixed.length).toBeLessThanOrEqual(30)
    expect(suffixed).toMatch(CODE_PATTERN)
    expect(suffixed).not.toBe(base)
  })
})
