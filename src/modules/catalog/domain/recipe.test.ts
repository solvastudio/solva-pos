import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseQty } from '~/lib/kernel'
import { effectiveIngredients, validateRecipe, type EffectiveModifierIngredient } from './recipe'

const MENU_SKU = '01950000-0000-7000-8000-000000000100'
const BERAS = '01950000-0000-7000-8000-000000000001'
const TELUR = '01950000-0000-7000-8000-000000000002'
const MINYAK = '01950000-0000-7000-8000-000000000003'
const KECAP = '01950000-0000-7000-8000-000000000004'
const KEJU = '01950000-0000-7000-8000-000000000005'

describe('catalog/domain/recipe (BR-RCP-001..004, V-17)', () => {
  it('computes V-17 Nasi Goreng effective ingredients with 2 portions and Extra Telur + Tanpa Kecap modifiers', () => {
    const baseRecipe = [
      { ingredientSkuId: BERAS, qty: '150.0000' },
      { ingredientSkuId: TELUR, qty: '1.0000' },
      { ingredientSkuId: MINYAK, qty: '20.0000' },
      { ingredientSkuId: KECAP, qty: '10.0000' },
    ]

    // 2 portions standard
    expect(effectiveIngredients(baseRecipe, [], '2')).toEqual([
      { ingredientSkuId: BERAS, qty: '300' },
      { ingredientSkuId: TELUR, qty: '2' },
      { ingredientSkuId: MINYAK, qty: '40' },
      { ingredientSkuId: KECAP, qty: '20' },
    ])

    // 1 portion + Extra Telur (ADD 1) + Tanpa Kecap (REMOVE) + Extra Keju (ADD new ingredient 25g)
    expect(
      effectiveIngredients(
        baseRecipe,
        [
          { ingredientSkuId: TELUR, adjustType: 'ADD', qty: '1.0000' },
          { ingredientSkuId: KECAP, adjustType: 'REMOVE', qty: null },
          { ingredientSkuId: KEJU, adjustType: 'ADD', qty: '25.0000' },
        ],
        '1',
      ),
    ).toEqual([
      { ingredientSkuId: BERAS, qty: '150' },
      { ingredientSkuId: TELUR, qty: '2' },
      { ingredientSkuId: MINYAK, qty: '20' },
      { ingredientSkuId: KEJU, qty: '25' },
    ])

    // REDUCE exceeding recipe drops to 0 and is omitted
    expect(
      effectiveIngredients(
        baseRecipe,
        [{ ingredientSkuId: KECAP, adjustType: 'REDUCE', qty: '15.0000' }],
        '1',
      ),
    ).toEqual([
      { ingredientSkuId: BERAS, qty: '150' },
      { ingredientSkuId: TELUR, qty: '1' },
      { ingredientSkuId: MINYAK, qty: '20' },
    ])

    // Scale 4 precision without floating drift
    expect(
      effectiveIngredients(
        [{ ingredientSkuId: MINYAK, qty: '0.1000' }],
        [{ ingredientSkuId: MINYAK, adjustType: 'ADD', qty: '0.2000' }],
        '3',
      ),
    ).toEqual([{ ingredientSkuId: MINYAK, qty: '0.9' }])
  })

  it('property: modifier application order never changes effectiveIngredients result', () => {
    const recipe = [
      { ingredientSkuId: BERAS, qty: '150' },
      { ingredientSkuId: TELUR, qty: '1' },
      { ingredientSkuId: MINYAK, qty: '20' },
      { ingredientSkuId: KECAP, qty: '10' },
    ]
    const modArb: fc.Arbitrary<EffectiveModifierIngredient> = fc.record({
      ingredientSkuId: fc.constantFrom(BERAS, TELUR, MINYAK, KECAP, KEJU),
      adjustType: fc.constantFrom('ADD' as const, 'REDUCE' as const, 'REMOVE' as const),
      qty: fc.constantFrom('0.5', '1', '5', '12.5'),
      modifierQty: fc.constantFrom(1, 2),
    })

    fc.assert(
      fc.property(
        fc.array(modArb, { minLength: 1, maxLength: 10 }),
        fc.constantFrom('1', '2', '0.5'),
        (mods, portions) => {
          const normalized = mods.map((m) =>
            m.adjustType === 'REMOVE' ? { ...m, qty: null } : m,
          )
          const reversed = [...normalized].reverse()
          expect(effectiveIngredients(recipe, normalized, parseQty(portions))).toEqual(
            effectiveIngredients(recipe, reversed, parseQty(portions)),
          )
        },
      ),
      { numRuns: 100 },
    )
  })

  it('validateRecipe enforces MENU_FNB, unique positive ingredients, one-level BOM, and untracked warnings', () => {
    const resOk = validateRecipe(
      MENU_SKU,
      [
        { ingredientSkuId: BERAS, qty: '150' },
        { ingredientSkuId: KEJU, qty: '25' },
      ],
      {
        menuProductType: 'MENU_FNB',
        ingredientsBySkuId: new Map([
          [BERAS, { trackStock: true, hasOwnRecipe: false }],
          [KEJU, { trackStock: false, hasOwnRecipe: false }],
        ]),
      },
    )
    expect(resOk.ok).toBe(true)
    expect(resOk.warnings.map((w) => w.ingredientSkuId)).toEqual([KEJU])

    const resBad = validateRecipe(
      MENU_SKU,
      [
        { ingredientSkuId: MENU_SKU, qty: '1' },
        { ingredientSkuId: BERAS, qty: '10' },
        { ingredientSkuId: BERAS, qty: '5' },
        { ingredientSkuId: TELUR, qty: '1' },
      ],
      {
        menuProductType: 'RETAIL',
        menuUsedAsIngredient: true,
        ingredientsBySkuId: new Map([
          [BERAS, { trackStock: true, hasOwnRecipe: false }],
          [TELUR, { trackStock: true, hasOwnRecipe: true }],
        ]),
      },
    )
    expect(resBad.ok).toBe(false)
    expect(resBad.errors.map((e) => e.code)).toEqual([
      'MENU_MUST_BE_FNB',
      'MULTI_LEVEL_RECIPE',
      'SELF_INGREDIENT',
      'DUPLICATE_INGREDIENT',
      'MULTI_LEVEL_RECIPE',
    ])
  })
})
