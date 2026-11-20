import { describe, expect, it } from 'vitest'
import { parsePairInput } from './pair-fragment'

describe('pos/boot/pair-fragment', () => {
  it('accepts raw code, #pair=CODE, #CODE, and same-tenant full QR URLs', () => {
    expect(parsePairInput('ab23-cd45', 'acme')).toEqual({ ok: true, code: 'AB23CD45' })
    expect(parsePairInput('#pair=AB23-CD45', 'acme')).toEqual({ ok: true, code: 'AB23CD45' })
    expect(parsePairInput('#AB23-CD45', 'acme')).toEqual({ ok: true, code: 'AB23CD45' })
    expect(
      parsePairInput('https://app.solva.id/ACME/pos#pair=AB23-CD45', 'acme'),
    ).toEqual({ ok: true, code: 'AB23CD45' })
    expect(
      parsePairInput('https://app.solva.id/acme/pos#AB23CD45', 'acme'),
    ).toEqual({ ok: true, code: 'AB23CD45' })
  })

  it('rejects QR URLs for another tenant with WRONG_ADDRESS and invalid lengths/characters with INVALID', () => {
    expect(
      parsePairInput('https://app.solva.id/other-shop/pos#pair=AB23-CD45', 'acme'),
    ).toEqual({ ok: false, reason: 'WRONG_ADDRESS' })

    expect(parsePairInput('#pair=TOO-SHORT', 'acme')).toEqual({
      ok: false,
      reason: 'INVALID',
    })
    // Forbidden ambiguous chars 0, 1, I, O
    expect(parsePairInput('#pair=AB01-IO23', 'acme')).toEqual({
      ok: false,
      reason: 'INVALID',
    })
  })
})
