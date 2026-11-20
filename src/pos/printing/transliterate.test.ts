import { describe, expect, it } from 'vitest'
import { transliterateToAscii } from './transliterate'

describe('pos/printing/transliterate', () => {
  it('folds Latin diacritics to ASCII and replaces non-Latin characters with ?', () => {
    expect(transliterateToAscii('Café Crème')).toBe('Cafe Creme')
    expect(transliterateToAscii('−5.370 × 2')).toBe('-5.370 x 2')
    expect(transliterateToAscii('Matcha 抹茶')).toBe('Matcha ??')
    expect(transliterateToAscii('Kopi “Susu”')).toBe('Kopi "Susu"')
  })
})
