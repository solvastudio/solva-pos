import { describe, expect, it } from 'vitest'
import { BRAND_ADMIN_NAME, BRAND_NAME, formatAppTitle } from './brand'

describe('formatAppTitle', () => {
  it('formats distinct admin and pos titles with tenant name and fallback defaults', () => {
    expect(formatAppTitle('admin', 'PT LIYA')).toBe('Admin · PT LIYA')
    expect(formatAppTitle('pos', 'PT LIYA')).toBe('POS · PT LIYA')
    expect(formatAppTitle('admin', null)).toBe(BRAND_ADMIN_NAME)
    expect(formatAppTitle('pos', '   ')).toBe(BRAND_NAME)
  })
})
