import { describe, expect, it } from 'vitest'
import {
  availabilityMatrixSearchSchema,
  priceMatrixSearchSchema,
  productListSearchSchema,
} from './catalog'

describe('lib/filters/catalog', () => {
  it('normalizes empty query strings, invalid pages, and booleans safely', () => {
    expect(
      productListSearchSchema.parse({ q: '   ', categoryId: '', type: 'UNKNOWN', page: '0' }),
    ).toEqual({
      q: undefined,
      categoryId: undefined,
      type: 'ALL',
      page: 1,
    })

    const catId = '01950000-0000-7000-8000-000000000001'
    expect(
      productListSearchSchema.parse({ q: 'kopi', categoryId: catId, type: 'MENU_FNB', page: '3' }),
    ).toEqual({
      q: 'kopi',
      categoryId: catId,
      type: 'MENU_FNB',
      page: 3,
    })

    expect(priceMatrixSearchSchema.parse({ onlyMissing: 'true', page: '2' })).toEqual({
      q: undefined,
      categoryId: undefined,
      onlyMissing: true,
      page: 2,
    })

    expect(availabilityMatrixSearchSchema.parse({ onlyExceptions: '1', page: 4 })).toEqual({
      q: undefined,
      categoryId: undefined,
      onlyExceptions: true,
      page: 4,
    })
  })
})
