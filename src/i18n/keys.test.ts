import { describe, expect, it } from 'vitest'
import { ERROR_CODES } from '~/lib/contracts'
import { i18next } from './index'
import en from './locales/en.json'
import id from './locales/id.json'

function flattenDict(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flattenDict(value as Record<string, unknown>, fullKey))
    } else {
      out[fullKey] = String(value)
    }
  }
  return out
}

function extractPlaceholders(text: string): string[] {
  const matches = text.match(/\{\{([^}]+)\}\}/g) ?? []
  return Array.from(new Set(matches.map((m) => m.slice(2, -2).trim()))).sort()
}

describe('i18n/keys (dictionary parity, plurals, placeholders, 22 error codes)', () => {
  const idFlat = flattenDict(id)
  const enFlat = flattenDict(en)
  const idKeys = Object.keys(idFlat).sort()
  const enKeys = Object.keys(enFlat).sort()

  it('has identical flattened keys between id.json and en.json', () => {
    const enSet = new Set(enKeys)
    const idSet = new Set(idKeys)
    const missingInEn = idKeys.filter((k) => !enSet.has(k))
    const missingInId = enKeys.filter((k) => !idSet.has(k))
    expect(missingInEn, `Keys missing in en.json: ${missingInEn.join(', ')}`).toEqual([])
    expect(missingInId, `Keys missing in id.json: ${missingInId.join(', ')}`).toEqual([])
  })

  it('provides both _one and _other forms for every pluralized key in both locales', () => {
    for (const [name, flat] of [
      ['id.json', idFlat],
      ['en.json', enFlat],
    ] as const) {
      const keys = Object.keys(flat)
      for (const k of keys) {
        if (k.endsWith('_one')) {
          const other = `${k.slice(0, -4)}_other`
          expect(Object.hasOwn(flat, other), `${name} is missing ${other}`).toBe(true)
        } else if (k.endsWith('_other')) {
          const one = `${k.slice(0, -6)}_one`
          expect(Object.hasOwn(flat, one), `${name} is missing ${one}`).toBe(true)
        }
      }
    }
  })

  it('uses identical {{placeholder}} sets across both locales for every key', () => {
    for (const k of idKeys) {
      const pId = extractPlaceholders(idFlat[k] ?? '')
      const pEn = extractPlaceholders(enFlat[k] ?? '')
      expect(pEn, `Mismatched placeholders for key "${k}"`).toEqual(pId)
    }
  })

  it('provides error.<CODE>.action in both locales for every code in ERROR_CODES', () => {
    for (const code of Object.keys(ERROR_CODES)) {
      const key = `error.${code}.action`
      expect(Object.hasOwn(idFlat, key), `id.json is missing ${key}`).toBe(true)
      expect(Object.hasOwn(enFlat, key), `en.json is missing ${key}`).toBe(true)
    }
  })

  it('renders banner.pending distinctly and accurately for 1 vs 3 transactions (id & en)', () => {
    const tId = i18next.getFixedT('id-ID')
    const id1 = tId('banner.pending', { count: 1, durasi: '2 jam' })
    const id3 = tId('banner.pending', { count: 3, durasi: '2 jam' })
    expect(id1).toBe('Ada 1 transaksi belum terkirim sejak 2 jam.')
    expect(id3).toBe('Ada 3 transaksi belum terkirim sejak 2 jam.')
    expect(id1).not.toBe(id3)

    const tEn = i18next.getFixedT('en-US')
    const en1 = tEn('banner.pending', { count: 1, durasi: '2 hours' })
    const en3 = tEn('banner.pending', { count: 3, durasi: '2 hours' })
    expect(en1).toBe("1 transaction hasn't been sent for 2 hours.")
    expect(en3).toBe("3 transactions haven't been sent for 2 hours.")
    expect(en1).not.toBe(en3)
  })
})
