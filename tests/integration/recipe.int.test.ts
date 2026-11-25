import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getRecipeForMenuSku,
  listIngredientOptions,
  saveRecipe,
} from '~/modules/catalog/public'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { setupFnbTenant } from './helpers/fnb'

describe('Recipe / Single-level BOM service integration', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
  })

  afterEach(() => {
    resetCompositionForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('saves scale-4 recipes, emits audit trail, warns on untracked stock, and computes estimated cost', async () => {
    const f = await setupFnbTenant('fnb-rcp')

    // Seed stock balance on tracked ingredient: 100 gr valued at Rp 2.000 => Rp 20/gr
    await withTenant(f.tenantId, (tx) =>
      tx.execute(
        sql`INSERT INTO stock_balance (outlet_id, sku_id, tenant_id, qty, inventory_value)
            VALUES (${f.outletA}, ${f.ingTrackedSkuId}, ${f.tenantId}, 100, 2000)`,
      ),
    )

    const saved = await saveRecipe(f.catalogActor, {
      menuSkuId: f.menuSkuId,
      items: [
        { ingredientSkuId: f.ingTrackedSkuId, qty: '150.5000' },
        { ingredientSkuId: f.ingUntrackedSkuId, qty: '2' },
      ],
    })

    expect(saved.items).toHaveLength(2)
    expect(saved.warnings).toHaveLength(1)
    expect(saved.warnings[0]?.ingredientSkuId).toBe(f.ingUntrackedSkuId)

    const trackedItem = saved.items.find((i) => i.ingredientSkuId === f.ingTrackedSkuId)!
    expect(Number(trackedItem.qty)).toBe(150.5)
    expect(trackedItem.estimatedUnitCost).toBe(20)
    expect(trackedItem.estimatedLineCost).toBe(3010)

    // Atomic replace-all removes untracked item and updates qty
    const replaced = await saveRecipe(f.catalogActor, {
      menuSkuId: f.menuSkuId,
      items: [{ ingredientSkuId: f.ingTrackedSkuId, qty: '200' }],
    })
    expect(replaced.items).toHaveLength(1)
    expect(replaced.estimatedTotalCost).toBe(4000)

    // Verify audit_log logged recipe.changed
    const auditCount = await withTenant(f.tenantId, async (tx) => {
      const res = await tx.execute<{ cnt: string }>(
        sql`SELECT count(*)::text AS cnt FROM audit_log WHERE entity_type = 'recipe' AND action = 'recipe.changed'`,
      )
      return Number(res.rows[0]!.cnt)
    })
    expect(auditCount).toBe(2)

    const fetched = await getRecipeForMenuSku(f.catalogActor, f.menuSkuId)
    expect(fetched.items).toHaveLength(1)

    // Multi-level recipe rejection: menuSkuId already has its own recipe so menu2 cannot use it
    await expect(
      saveRecipe(f.catalogActor, {
        menuSkuId: f.menu2SkuId,
        items: [{ ingredientSkuId: f.menuSkuId, qty: '1' }],
      }),
    ).rejects.toThrow(/BR-RCP-001/)

    // Non-MENU_FNB rejection
    await expect(
      saveRecipe(f.catalogActor, {
        menuSkuId: f.ingTrackedSkuId,
        items: [{ ingredientSkuId: f.ingUntrackedSkuId, qty: '1' }],
      }),
    ).rejects.toThrow(/MENU_FNB/)

    // Ingredient picker options exclude SKUs that have their own recipe and excluded menuSkuId
    const options = await listIngredientOptions(f.catalogActor, f.menu2SkuId)
    expect(options.some((o) => o.skuId === f.menuSkuId)).toBe(false)
    expect(options.some((o) => o.skuId === f.menu2SkuId)).toBe(false)
    expect(options.some((o) => o.skuId === f.ingTrackedSkuId)).toBe(true)
  })
})
