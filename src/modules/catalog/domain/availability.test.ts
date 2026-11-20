import { describe, expect, it } from 'vitest'
import {
  effectiveAvailability,
  productVisible,
  visibleSkusForOutlet,
} from './availability'
import {
  BR_CAT_016_TRUTH_TABLE,
  KAOS_WITH_XL_SKUS,
  V27_AVAILABILITY_VECTORS,
} from './availability.vectors'

describe('catalog/domain/availability (V-27 & BR-CAT-016)', () => {
  it('satisfies every vector in V-27 across outlets A/B/C', () => {
    for (const vec of V27_AVAILABILITY_VECTORS) {
      const a = visibleSkusForOutlet([vec.product], vec.skus, vec.outletARows)
      const b = visibleSkusForOutlet([vec.product], vec.skus, vec.outletBRows)
      const c = visibleSkusForOutlet([vec.product], vec.skus, vec.outletCRows)

      expect(a.length, `${vec.name} (A)`).toBe(vec.expectedCounts.A)
      expect(b.length, `${vec.name} (B)`).toBe(vec.expectedCounts.B)
      expect(c.length, `${vec.name} (C)`).toBe(vec.expectedCounts.C)

      expect(productVisible(vec.product, vec.skus, vec.outletARows)).toBe(
        vec.expectedCounts.A > 0,
      )
      expect(productVisible(vec.product, vec.skus, vec.outletCRows)).toBe(
        vec.expectedCounts.C > 0,
      )
    }
  })

  it('matches all 5 rows of BR-CAT-016 precedence truth table', () => {
    for (const row of BR_CAT_016_TRUTH_TABLE) {
      expect(effectiveAvailability(row.input), row.label).toBe(row.expected)
    }

    // Default when neither row exists (or both deleted) is true
    expect(
      effectiveAvailability({
        productActive: true,
        skuActive: true,
        productRow: { productId: 'p1', skuId: null, status: 'UNAVAILABLE', deleted: true },
      }),
    ).toBe(true)
    expect(KAOS_WITH_XL_SKUS).toHaveLength(8)
  })
})
