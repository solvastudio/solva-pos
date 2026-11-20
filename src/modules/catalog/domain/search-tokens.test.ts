import { describe, expect, it } from 'vitest'
import { buildSearchTokens } from './search-tokens'

describe('catalog/domain/search-tokens', () => {
  it('folds diacritics, splits non-alphanumeric name tokens, and retains full lowercase code', () => {
    expect(buildSearchTokens('Kopi Bubuk 200g', 'KP-200')).toEqual([
      'kopi',
      'bubuk',
      '200g',
      'kp-200',
    ])

    expect(buildSearchTokens('Café Crème', 'CAF01')).toEqual(['cafe', 'creme', 'caf01'])
  })
})
