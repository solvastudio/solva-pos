import { describe, expect, it } from 'vitest'
import { normalizeSlug, RESERVED_SLUGS, SLUG_PATTERN, validateSlug } from './slug'

describe('kernel/slug (V-33)', () => {
  it('accepts valid slugs and normalizes lowercase', () => {
    expect(SLUG_PATTERN.test('toko-maju-7')).toBe(true)
    expect(normalizeSlug('  ACME  ')).toBe('acme')
    expect(validateSlug('acme')).toEqual({ ok: true, slug: 'acme' })
    expect(validateSlug('toko-maju-7')).toEqual({ ok: true, slug: 'toko-maju-7' })
    expect(validateSlug('beta')).toEqual({ ok: true, slug: 'beta' })
  })

  it('rejects invalid slugs, reserved words, and uppercase letters per V-33', () => {
    expect(validateSlug('ab')).toEqual({ ok: false, reason: 'FORMAT' })
    expect(validateSlug('-acme')).toEqual({ ok: false, reason: 'FORMAT' })
    expect(validateSlug('acme-')).toEqual({ ok: false, reason: 'FORMAT' })
    expect(validateSlug('Acme_1')).toEqual({ ok: false, reason: 'FORMAT' })
    expect(validateSlug('a'.repeat(31))).toEqual({ ok: false, reason: 'FORMAT' })
    expect(validateSlug('admin')).toEqual({ ok: false, reason: 'RESERVED' })
    expect(validateSlug('pos')).toEqual({ ok: false, reason: 'RESERVED' })
    expect(validateSlug('platform')).toEqual({ ok: false, reason: 'RESERVED' })
    expect(validateSlug('ACME')).toEqual({ ok: false, reason: 'UPPERCASE' })
  })

  it('includes top-level static segments in RESERVED_SLUGS', () => {
    expect(RESERVED_SLUGS).toContain('platform')
    expect(RESERVED_SLUGS).toContain('health')
    expect(RESERVED_SLUGS).toContain('_serverfn')
    expect(RESERVED_SLUGS).toContain('_build')
  })
})
