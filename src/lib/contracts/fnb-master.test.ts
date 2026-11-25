import { describe, expect, it } from 'vitest'
import {
  createFnbTableSchema,
  createModifierGroupSchema,
  createModifierSchema,
  saveRecipeSchema,
} from './fnb-master'

const U1 = '01950000-0000-7000-8000-000000000001'
const U2 = '01950000-0000-7000-8000-000000000002'
const U3 = '01950000-0000-7000-8000-000000000003'

describe('contracts/fnb-master', () => {
  it('validates table code format and capacity > 0', () => {
    expect(createFnbTableSchema.parse({ outletId: U1, code: 'M05', area: 'Indoor', capacity: 4 })).toMatchObject({
      code: 'M05',
      capacity: 4,
    })
    expect(() => createFnbTableSchema.parse({ outletId: U1, code: 'BAD CODE!', capacity: 4 })).toThrow()
    expect(() => createFnbTableSchema.parse({ outletId: U1, code: 'M05', capacity: 0 })).toThrow()
  })

  it('validates modifier group bounds and modifier ingredient qty invariant', () => {
    expect(
      createModifierGroupSchema.parse({ name: 'Topping', selectionType: 'MULTI', minSelect: 0, maxSelect: 3 }),
    ).toBeDefined()
    expect(() =>
      createModifierGroupSchema.parse({ name: 'Topping', selectionType: 'MULTI', minSelect: 3, maxSelect: 1 }),
    ).toThrow()

    expect(
      createModifierSchema.parse({
        modifierGroupId: U1,
        name: 'Tanpa Kecap',
        priceDelta: -1000,
        ingredients: [{ ingredientSkuId: U2, adjustType: 'REMOVE', qty: null }],
      }),
    ).toBeDefined()
    expect(() =>
      createModifierSchema.parse({
        modifierGroupId: U1,
        name: 'Bad Remove',
        priceDelta: 0,
        ingredients: [{ ingredientSkuId: U2, adjustType: 'REMOVE', qty: '1' }],
      }),
    ).toThrow()
    expect(() =>
      createModifierSchema.parse({
        modifierGroupId: U1,
        name: 'Bad Add',
        priceDelta: 500,
        ingredients: [{ ingredientSkuId: U2, adjustType: 'ADD', qty: null }],
      }),
    ).toThrow()
  })

  it('validates recipe uniqueness, positive qty, and distinctness from menu SKU', () => {
    expect(
      saveRecipeSchema.parse({
        menuSkuId: U1,
        items: [
          { ingredientSkuId: U2, qty: '150.0000' },
          { ingredientSkuId: U3, qty: '1' },
        ],
      }),
    ).toBeDefined()
    expect(() =>
      saveRecipeSchema.parse({ menuSkuId: U1, items: [{ ingredientSkuId: U1, qty: '1' }] }),
    ).toThrow()
    expect(() =>
      saveRecipeSchema.parse({
        menuSkuId: U1,
        items: [
          { ingredientSkuId: U2, qty: '1' },
          { ingredientSkuId: U2, qty: '2' },
        ],
      }),
    ).toThrow()
  })
})
