import { describe, expect, it } from 'vitest'
import { parseQty } from '~/lib/kernel'
import { buildRecipeIntents } from './recipe-consumption.service'

const OUTLET_ID = '01950000-0000-7000-8000-000000000010'
const LINE_1 = '01950000-0000-7000-8000-000000000021'
const LINE_2 = '01950000-0000-7000-8000-000000000022'
const MENU_NASGOR = '01950000-0000-7000-8000-000000000100'
const MENU_NOREZ = '01950000-0000-7000-8000-000000000101'
const BERAS = '01950000-0000-7000-8000-000000000001'
const TELUR = '01950000-0000-7000-8000-000000000002'
const MINYAK = '01950000-0000-7000-8000-000000000003'
const KECAP = '01950000-0000-7000-8000-000000000004'
const MOD_TELUR = '01950000-0000-7000-8000-000000000901'
const MOD_NO_KECAP = '01950000-0000-7000-8000-000000000902'

describe('inventory/recipe-consumption.service (V-17, BR-RCP-004/006)', () => {
  it('builds deterministic RECIPE_CONSUMPTION intents ordered by lineNo and ingredient skuId ASC, and flags missing recipes', () => {
    const res = buildRecipeIntents({
      outletId: OUTLET_ID,
      occurredAt: '2026-11-24T12:00:00.000Z',
      businessDate: '2026-11-24',
      lines: [
        {
          lineId: LINE_2,
          lineNo: 2,
          lineKind: 'ITEM',
          skuId: MENU_NOREZ,
          qtyBase: parseQty('1'),
        },
        {
          lineId: LINE_1,
          lineNo: 1,
          lineKind: 'ITEM',
          skuId: MENU_NASGOR,
          qtyBase: parseQty('1'),
          modifiers: [
            { modifierId: MOD_TELUR, qty: 1 },
            { modifierId: MOD_NO_KECAP, qty: 1 },
          ],
        },
      ],
      skuTypes: new Map([
        [MENU_NASGOR, { productType: 'MENU_FNB', trackStock: true }],
        [MENU_NOREZ, { productType: 'MENU_FNB', trackStock: true }],
      ]),
      recipesByMenuSku: new Map([
        [
          MENU_NASGOR,
          [
            { ingredientSkuId: KECAP, qty: '10' },
            { ingredientSkuId: BERAS, qty: '150' },
            { ingredientSkuId: TELUR, qty: '1' },
            { ingredientSkuId: MINYAK, qty: '20' },
          ],
        ],
      ]),
      modifierIngredientsByModifier: new Map([
        [MOD_TELUR, [{ ingredientSkuId: TELUR, adjustType: 'ADD', qty: '1' }]],
        [MOD_NO_KECAP, [{ ingredientSkuId: KECAP, adjustType: 'REMOVE', qty: null }]],
      ]),
    })

    expect(res.missingRecipeLineIds).toEqual([LINE_2])
    expect(res.recipeMenuLineIds).toEqual([LINE_1])
    expect(res.intents).toEqual([
      {
        outletId: OUTLET_ID,
        skuId: BERAS,
        kind: 'OUT',
        qty: '150',
        movementType: 'RECIPE_CONSUMPTION',
        sourceType: 'SALE_LINE',
        sourceId: LINE_1,
        occurredAt: '2026-11-24T12:00:00.000Z',
        businessDate: '2026-11-24',
        order: 1001,
      },
      {
        outletId: OUTLET_ID,
        skuId: TELUR,
        kind: 'OUT',
        qty: '2',
        movementType: 'RECIPE_CONSUMPTION',
        sourceType: 'SALE_LINE',
        sourceId: LINE_1,
        occurredAt: '2026-11-24T12:00:00.000Z',
        businessDate: '2026-11-24',
        order: 1002,
      },
      {
        outletId: OUTLET_ID,
        skuId: MINYAK,
        kind: 'OUT',
        qty: '20',
        movementType: 'RECIPE_CONSUMPTION',
        sourceType: 'SALE_LINE',
        sourceId: LINE_1,
        occurredAt: '2026-11-24T12:00:00.000Z',
        businessDate: '2026-11-24',
        order: 1003,
      },
    ])
  })
})
