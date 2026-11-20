import { describe, expect, it } from 'vitest'
import { deriveValueCode, generateSkus, VariantLimitError } from './variants'

describe('catalog/domain/variants (BR-CAT-002 & BR-CAT-005)', () => {
  it('derives <= 3-char uppercase alphanumeric value codes', () => {
    expect(deriveValueCode('Merah')).toBe('MER')
    expect(deriveValueCode('S')).toBe('S')
    expect(deriveValueCode('XL')).toBe('XL')
    expect(deriveValueCode('Caffè Latte!')).toBe('CAF')
  })

  it('generates 6 SKUs for {S,M,L} x {Merah,Hitam}, then appends only 2 SKUs when XL is added', () => {
    const first = generateSkus({
      productCode: 'KAOS01',
      attributes: [
        {
          name: 'Ukuran',
          values: [
            { id: 'v-s', value: 'S' },
            { id: 'v-m', value: 'M' },
            { id: 'v-l', value: 'L' },
          ],
        },
        {
          name: 'Warna',
          values: [
            { id: 'v-mer', value: 'Merah' },
            { id: 'v-htm', value: 'Hitam' },
          ],
        },
      ],
      existing: [],
    })

    expect(first.create).toHaveLength(6)
    expect(first.create.map((s) => s.skuCode)).toEqual([
      'KAOS01-S-MER',
      'KAOS01-S-HIT',
      'KAOS01-M-MER',
      'KAOS01-M-HIT',
      'KAOS01-L-MER',
      'KAOS01-L-HIT',
    ])
    expect(first.create[0]!.variantLabel).toBe('S / Merah')

    const addedXl = generateSkus({
      productCode: 'KAOS01',
      attributes: [
        {
          name: 'Ukuran',
          values: [
            { id: 'v-s', value: 'S' },
            { id: 'v-m', value: 'M' },
            { id: 'v-l', value: 'L' },
            { id: 'v-xl', value: 'XL' },
          ],
        },
        {
          name: 'Warna',
          values: [
            { id: 'v-mer', value: 'Merah' },
            { id: 'v-htm', value: 'Hitam' },
          ],
        },
      ],
      existing: first.create.map((s) => ({ combo: s.valueIds, skuCode: s.skuCode })),
    })

    expect(addedXl.create).toHaveLength(2)
    expect(addedXl.create.map((s) => s.skuCode)).toEqual(['KAOS01-XL-MER', 'KAOS01-XL-HIT'])
  })

  it('disambiguates colliding SKU codes with -2, -3 and caps code length at 40', () => {
    const res = generateSkus({
      productCode: 'VERY_LONG_PRODUCT_CODE_1234567890_ABC',
      attributes: [
        {
          name: 'Variant',
          values: [
            { id: '1', value: 'Blue' },
            { id: '2', value: 'Blur' },
            { id: '3', value: 'Blush' },
          ],
        },
      ],
      existing: [],
    })

    expect(res.create).toHaveLength(3)
    const codes = res.create.map((s) => s.skuCode)
    expect(new Set(codes).size).toBe(3)
    for (const c of codes) {
      expect(c.length).toBeLessThanOrEqual(40)
    }
    expect(codes[1]).toMatch(/-2$/)
    expect(codes[2]).toMatch(/-3$/)
  })

  it('rejects > 3 attributes and > 100 active SKUs with VariantLimitError', () => {
    expect(() =>
      generateSkus({
        productCode: 'P4',
        attributes: [
          { name: 'A', values: [{ id: 'a1', value: '1' }] },
          { name: 'B', values: [{ id: 'b1', value: '1' }] },
          { name: 'C', values: [{ id: 'c1', value: '1' }] },
          { name: 'D', values: [{ id: 'd1', value: '1' }] },
        ],
        existing: [],
      }),
    ).toThrow(VariantLimitError)

    const values101 = Array.from({ length: 101 }, (_, i) => ({
      id: `v-${i}`,
      value: `V${i}`,
    }))
    expect(() =>
      generateSkus({
        productCode: 'P101',
        attributes: [{ name: 'Num', values: values101 }],
        existing: [],
      }),
    ).toThrow(/100/)
  })
})
