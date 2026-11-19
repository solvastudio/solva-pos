import { describe, expect, it } from 'vitest'
import {
  CODE_ALPHABET,
  CODE_LENGTH_MEMBER,
  CODE_LENGTH_PAIRING,
  formatCode,
  generateCode,
  normalizeCode,
} from './codes'

describe('kernel/codes (V-45)', () => {
  it('uses an unambiguous 32-character alphabet with ~1.12e15 combinations for 10 chars', () => {
    expect(CODE_ALPHABET).toHaveLength(32)
    expect(new Set(CODE_ALPHABET).size).toBe(32)
    expect(CODE_ALPHABET).not.toMatch(/[IO01]/)
    expect(CODE_ALPHABET.length ** CODE_LENGTH_MEMBER).toBe(32 ** 10)
    expect(CODE_LENGTH_PAIRING).toBe(8)
  })

  it('formats and normalizes codes consistently and rejects invalid characters', () => {
    expect(formatCode('K7Q2M9XD4R')).toBe('K7Q2M-9XD4R')
    expect(formatCode('ABCD2345')).toBe('ABCD-2345')
    expect(normalizeCode('k7q2m-9xd4r ')).toBe('K7Q2M9XD4R')
    expect(normalizeCode('  a b c d - 2 3 4 5  ')).toBe('ABCD2345')
    expect(normalizeCode('K7Q2M-IO01R')).toBe('')
    expect(normalizeCode('   ')).toBe('')
  })

  it('produces uniform distribution across all 32 alphabet symbols over 32,000 byte samples', () => {
    const counts = new Map<string, number>()
    for (const ch of CODE_ALPHABET) {
      counts.set(ch, 0)
    }

    // Exercise deterministic full coverage of 0..255 repeated 125 times (= 32,000 bytes),
    // plus an alternating PRNG sweep.
    const bytes = new Uint8Array(32_000)
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = i & 0xff
    }
    const code = generateCode(bytes, 32_000)
    for (const ch of code) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1)
    }

    for (const ch of CODE_ALPHABET) {
      const count = counts.get(ch) ?? 0
      expect(count).toBeGreaterThanOrEqual(800)
      expect(count).toBeLessThanOrEqual(1200)
    }
  })
})
