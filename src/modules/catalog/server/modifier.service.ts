import '@tanstack/react-start/server-only'
import { z } from 'zod'
import {
  createModifierGroupSchema,
  createModifierSchema,
  linkModifierGroupProductSchema,
  unlinkModifierGroupProductSchema,
  updateModifierGroupSchema,
  updateModifierSchema,
  type CreateModifierGroupInput,
  type CreateModifierInput,
  type LinkModifierGroupProductInput,
  type ModifierIngredientInput,
  type UpdateModifierGroupInput,
  type UpdateModifierInput,
} from '~/lib/contracts'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly, type TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { parseOrThrow } from '~/server/parse-or-throw'
import type {
  ModifierGroupView,
  ModifierIngredientView,
  ModifierView,
  ProductModifierGroupView,
} from '../shared'
import {
  newIdFrom,
  nowIsoFrom,
  requireCatalogPermission,
  type CatalogActor,
  type CatalogServiceDeps,
} from './auth'
import {
  countLinkedProductsByGroup,
  findActiveModifierGroupProduct,
  findActiveSkuIdsSet,
  findModifierById,
  findModifierGroupById,
  findProductMetaForModifier,
  getMinEffectiveBasePriceForProduct,
  insertModifierGroupRow,
  insertModifierIngredientRows,
  insertModifierRow,
  listModifierGroupsRows,
  listModifierIngredientsByModifierIds,
  listModifiersByGroupIds,
  listProductModifierGroupLinks,
  softDeleteModifierIngredients,
  softDeleteModifierIngredientsByGroupId,
  tombstoneModifierGroupProductRow,
  tombstoneModifierGroupProductsByGroupId,
  tombstoneModifierGroupRow,
  tombstoneModifierRow,
  tombstoneModifiersByGroupId,
  updateModifierGroupRow,
  updateModifierRow,
  upsertModifierGroupProductRow,
  type ModifierGroupRow,
  type ModifierRow,
} from './modifier.repo'

const uuidSchema = z.string().uuid()

function isPgUniqueViolation(err: unknown): boolean {
  let cur: unknown = err
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i += 1) {
    if ('code' in cur && (cur as { code?: unknown }).code === '23505') return true
    cur = 'cause' in cur ? (cur as { cause?: unknown }).cause : null
  }
  return false
}

function auditDeps(deps: CatalogServiceDeps | undefined, nowIso: string) {
  return { newId: () => newIdFrom(deps), nowIso: () => nowIso }
}

function buildModifierViews(
  mods: readonly ModifierRow[],
  ingredients: readonly ModifierIngredientView[],
): ModifierView[] {
  const ingByMod = new Map<string, ModifierIngredientView[]>()
  for (const ing of ingredients) {
    const list = ingByMod.get(ing.modifierId)
    if (list) list.push(ing)
    else ingByMod.set(ing.modifierId, [ing])
  }
  return mods.map((m) => ({
    id: m.id,
    modifierGroupId: m.modifierGroupId,
    name: m.name,
    priceDelta: m.priceDelta,
    isActive: m.isActive,
    sortOrder: m.sortOrder,
    version: m.version,
    deletedAt: m.deletedAt,
    ingredients: ingByMod.get(m.id) ?? [],
  }))
}

async function validateIngredientsForModifier(
  tx: TenantTx,
  tenantId: string,
  ingredients: readonly ModifierIngredientInput[],
): Promise<void> {
  if (ingredients.length === 0) return
  const seen = new Set<string>()
  for (const ing of ingredients) {
    if (seen.has(ing.ingredientSkuId)) {
      throw new AppError('VALIDATION_FAILED', 'Duplicate ingredient SKU in modifier')
    }
    seen.add(ing.ingredientSkuId)
  }
  const existingSkus = await findActiveSkuIdsSet(tx, tenantId, [...seen])
  for (const skuId of seen) {
    if (!existingSkus.has(skuId)) {
      throw new AppError('VALIDATION_FAILED', 'Ingredient SKU not found')
    }
  }
}

export function computeGroupNegativeDeltaWarning(
  minBasePrice: number | null,
  selectionType: 'SINGLE' | 'MULTI',
  modifiers: readonly Pick<ModifierView, 'priceDelta' | 'isActive'>[],
): boolean {
  if (minBasePrice === null) return false
  const activeNegatives = modifiers.filter((m) => m.isActive && m.priceDelta < 0)
  if (activeNegatives.length === 0) return false
  if (selectionType === 'SINGLE') {
    const lowest = Math.min(...activeNegatives.map((m) => m.priceDelta))
    return minBasePrice + lowest < 0
  }
  const sumNegative = activeNegatives.reduce((acc, m) => acc + m.priceDelta, 0)
  return minBasePrice + sumNegative < 0
}

export async function listModifierGroups(actor: CatalogActor): Promise<ModifierGroupView[]> {
  requireCatalogPermission(actor)
  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const groups = await listModifierGroupsRows(tx, actor.tenantId)
    if (groups.length === 0) return []
    const groupIds = groups.map((g) => g.id)
    const mods = await listModifiersByGroupIds(tx, actor.tenantId, groupIds)
    const counts = await countLinkedProductsByGroup(tx, actor.tenantId)
    const ings = await listModifierIngredientsByModifierIds(
      tx,
      actor.tenantId,
      mods.map((m) => m.id),
    )
    const modViews = buildModifierViews(mods, ings)
    const modsByGroup = new Map<string, ModifierView[]>()
    for (const mv of modViews) {
      const list = modsByGroup.get(mv.modifierGroupId)
      if (list) list.push(mv)
      else modsByGroup.set(mv.modifierGroupId, [mv])
    }
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      selectionType: g.selectionType,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      isActive: g.isActive,
      version: g.version,
      deletedAt: g.deletedAt,
      modifiers: modsByGroup.get(g.id) ?? [],
      linkedProductCount: counts.get(g.id) ?? 0,
    }))
  })
}

export async function createModifierGroup(
  actor: CatalogActor,
  rawInput: CreateModifierGroupInput,
  deps?: CatalogServiceDeps,
): Promise<ModifierGroupRow> {
  requireCatalogPermission(actor)
  const parsed = parseOrThrow(createModifierGroupSchema, rawInput, 'Invalid modifier group input')
  const id = newIdFrom(deps)
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      const created = await insertModifierGroupRow(tx, w, {
        id,
        name: parsed.name,
        selectionType: parsed.selectionType,
        minSelect: parsed.minSelect,
        maxSelect: parsed.maxSelect ?? null,
        isActive: parsed.isActive,
        nowIso,
      })
      await appendAudit(
        tx,
        {
          actorUserId: actor.appUserId,
          action: 'modifier.changed',
          entityType: 'modifier_group',
          entityId: created.id,
          afterData: {
            name: created.name,
            selectionType: created.selectionType,
            minSelect: created.minSelect,
            maxSelect: created.maxSelect,
            isActive: created.isActive,
          },
          occurredAt: nowIso,
        },
        auditDeps(deps, nowIso),
      )
      return created
    })
    return result
  })
}

export async function updateModifierGroup(
  actor: CatalogActor,
  rawInput: UpdateModifierGroupInput,
  deps?: CatalogServiceDeps,
): Promise<ModifierGroupRow> {
  requireCatalogPermission(actor)
  const parsed = parseOrThrow(updateModifierGroupSchema, rawInput, 'Invalid modifier group update input')
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findModifierGroupById(tx, actor.tenantId, parsed.id)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'Modifier group not found')
    }
    const selectionType = parsed.selectionType ?? existing.selectionType
    const minSelect = parsed.minSelect ?? existing.minSelect
    const maxSelect = parsed.maxSelect === undefined ? existing.maxSelect : parsed.maxSelect

    if (maxSelect !== null && maxSelect < minSelect) {
      throw new AppError('VALIDATION_FAILED', 'maxSelect must be >= minSelect')
    }
    if (selectionType === 'SINGLE' && minSelect > 1) {
      throw new AppError('VALIDATION_FAILED', 'SINGLE selection cannot require more than 1 item')
    }

    const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      const updated = await updateModifierGroupRow(tx, w, {
        id: existing.id,
        name: parsed.name ?? existing.name,
        selectionType,
        minSelect,
        maxSelect,
        isActive: parsed.isActive ?? existing.isActive,
        nowIso,
      })
      await appendAudit(
        tx,
        {
          actorUserId: actor.appUserId,
          action: 'modifier.changed',
          entityType: 'modifier_group',
          entityId: updated.id,
          beforeData: {
            name: existing.name,
            selectionType: existing.selectionType,
            minSelect: existing.minSelect,
            maxSelect: existing.maxSelect,
            isActive: existing.isActive,
          },
          afterData: {
            name: updated.name,
            selectionType: updated.selectionType,
            minSelect: updated.minSelect,
            maxSelect: updated.maxSelect,
            isActive: updated.isActive,
          },
          occurredAt: nowIso,
        },
        auditDeps(deps, nowIso),
      )
      return updated
    })
    return result
  })
}

export async function deleteModifierGroup(
  actor: CatalogActor,
  id: string,
  deps?: CatalogServiceDeps,
): Promise<void> {
  requireCatalogPermission(actor)
  if (!uuidSchema.safeParse(id).success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid modifier group ID')
  }
  const nowIso = nowIsoFrom(deps)

  await withTenant(actor.tenantId, async (tx) => {
    const existing = await findModifierGroupById(tx, actor.tenantId, id)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'Modifier group not found')
    }
    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await softDeleteModifierIngredientsByGroupId(tx, w.tenantId, id, actor.appUserId, nowIso)
      await tombstoneModifiersByGroupId(tx, w, id, nowIso)
      await tombstoneModifierGroupProductsByGroupId(tx, w, id, nowIso)
      await tombstoneModifierGroupRow(tx, w, id, nowIso)
      await appendAudit(
        tx,
        {
          actorUserId: actor.appUserId,
          action: 'modifier.changed',
          entityType: 'modifier_group',
          entityId: existing.id,
          beforeData: { name: existing.name, deletedAt: null },
          afterData: { deletedAt: nowIso },
          occurredAt: nowIso,
        },
        auditDeps(deps, nowIso),
      )
    })
  })
}

export async function createModifier(
  actor: CatalogActor,
  rawInput: CreateModifierInput,
  deps?: CatalogServiceDeps,
): Promise<ModifierView> {
  requireCatalogPermission(actor)
  const parsed = parseOrThrow(createModifierSchema, rawInput, 'Invalid modifier input')
  const id = newIdFrom(deps)
  const nowIso = nowIsoFrom(deps)
  const ingredients = parsed.ingredients ?? []

  try {
    return await withTenant(actor.tenantId, async (tx) => {
      const group = await findModifierGroupById(tx, actor.tenantId, parsed.modifierGroupId)
      if (!group) {
        throw new AppError('VALIDATION_FAILED', 'Modifier group not found')
      }
      await validateIngredientsForModifier(tx, actor.tenantId, ingredients)

      const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
        const created = await insertModifierRow(tx, w, {
          id,
          modifierGroupId: parsed.modifierGroupId,
          name: parsed.name,
          priceDelta: parsed.priceDelta,
          isActive: parsed.isActive,
          sortOrder: parsed.sortOrder,
          nowIso,
        })
        await insertModifierIngredientRows(
          tx,
          w.tenantId,
          created.id,
          ingredients.map((ing) => ({
            id: newIdFrom(deps),
            ingredientSkuId: ing.ingredientSkuId,
            adjustType: ing.adjustType,
            qty: ing.qty,
          })),
          actor.appUserId,
          nowIso,
        )
        await appendAudit(
          tx,
          {
            actorUserId: actor.appUserId,
            action: 'modifier.changed',
            entityType: 'modifier',
            entityId: created.id,
            afterData: {
              modifierGroupId: created.modifierGroupId,
              name: created.name,
              priceDelta: created.priceDelta,
              isActive: created.isActive,
              ingredientCount: ingredients.length,
            },
            occurredAt: nowIso,
          },
          auditDeps(deps, nowIso),
        )
        return created
      })

      const ingViews = await listModifierIngredientsByModifierIds(tx, actor.tenantId, [result.id])
      return buildModifierViews([result], ingViews)[0]!
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError('VALIDATION_FAILED', 'admin.modifier.nameTaken')
    }
    throw err
  }
}

export async function updateModifier(
  actor: CatalogActor,
  rawInput: UpdateModifierInput,
  deps?: CatalogServiceDeps,
): Promise<ModifierView> {
  requireCatalogPermission(actor)
  const parsed = parseOrThrow(updateModifierSchema, rawInput, 'Invalid modifier update input')
  const nowIso = nowIsoFrom(deps)

  try {
    return await withTenant(actor.tenantId, async (tx) => {
      const existing = await findModifierById(tx, actor.tenantId, parsed.id)
      if (!existing) {
        throw new AppError('VALIDATION_FAILED', 'Modifier not found')
      }
      if (parsed.ingredients !== undefined) {
        await validateIngredientsForModifier(tx, actor.tenantId, parsed.ingredients)
      }

      const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
        const updated = await updateModifierRow(tx, w, {
          id: existing.id,
          name: parsed.name ?? existing.name,
          priceDelta: parsed.priceDelta ?? existing.priceDelta,
          isActive: parsed.isActive ?? existing.isActive,
          sortOrder: parsed.sortOrder ?? existing.sortOrder,
          nowIso,
        })
        if (parsed.ingredients !== undefined) {
          await softDeleteModifierIngredients(tx, w.tenantId, updated.id, actor.appUserId, nowIso)
          await insertModifierIngredientRows(
            tx,
            w.tenantId,
            updated.id,
            parsed.ingredients.map((ing) => ({
              id: newIdFrom(deps),
              ingredientSkuId: ing.ingredientSkuId,
              adjustType: ing.adjustType,
              qty: ing.qty,
            })),
            actor.appUserId,
            nowIso,
          )
        }
        await appendAudit(
          tx,
          {
            actorUserId: actor.appUserId,
            action: 'modifier.changed',
            entityType: 'modifier',
            entityId: updated.id,
            beforeData: {
              name: existing.name,
              priceDelta: existing.priceDelta,
              isActive: existing.isActive,
            },
            afterData: {
              name: updated.name,
              priceDelta: updated.priceDelta,
              isActive: updated.isActive,
            },
            occurredAt: nowIso,
          },
          auditDeps(deps, nowIso),
        )
        return updated
      })

      const ingViews = await listModifierIngredientsByModifierIds(tx, actor.tenantId, [result.id])
      return buildModifierViews([result], ingViews)[0]!
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError('VALIDATION_FAILED', 'admin.modifier.nameTaken')
    }
    throw err
  }
}

export async function deleteModifier(
  actor: CatalogActor,
  id: string,
  deps?: CatalogServiceDeps,
): Promise<void> {
  requireCatalogPermission(actor)
  if (!uuidSchema.safeParse(id).success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid modifier ID')
  }
  const nowIso = nowIsoFrom(deps)

  await withTenant(actor.tenantId, async (tx) => {
    const existing = await findModifierById(tx, actor.tenantId, id)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'Modifier not found')
    }
    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await softDeleteModifierIngredients(tx, w.tenantId, existing.id, actor.appUserId, nowIso)
      await tombstoneModifierRow(tx, w, existing.id, nowIso)
      await appendAudit(
        tx,
        {
          actorUserId: actor.appUserId,
          action: 'modifier.changed',
          entityType: 'modifier',
          entityId: existing.id,
          beforeData: { name: existing.name, deletedAt: null },
          afterData: { deletedAt: nowIso },
          occurredAt: nowIso,
        },
        auditDeps(deps, nowIso),
      )
    })
  })
}

export async function listProductModifierGroups(
  actor: CatalogActor,
  productId: string,
): Promise<ProductModifierGroupView[]> {
  requireCatalogPermission(actor)
  if (!uuidSchema.safeParse(productId).success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid productId')
  }

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const prod = await findProductMetaForModifier(tx, actor.tenantId, productId)
    if (!prod) {
      throw new AppError('VALIDATION_FAILED', 'Product not found')
    }
    const links = await listProductModifierGroupLinks(tx, actor.tenantId, productId)
    if (links.length === 0) return []

    const groupIds = links.map((l) => l.modifierGroupId)
    const mods = await listModifiersByGroupIds(tx, actor.tenantId, groupIds)
    const minBasePrice = await getMinEffectiveBasePriceForProduct(tx, actor.tenantId, productId)
    const ings = await listModifierIngredientsByModifierIds(
      tx,
      actor.tenantId,
      mods.map((m) => m.id),
    )
    const modViews = buildModifierViews(mods, ings)
    const modsByGroup = new Map<string, ModifierView[]>()
    for (const mv of modViews) {
      const list = modsByGroup.get(mv.modifierGroupId)
      if (list) list.push(mv)
      else modsByGroup.set(mv.modifierGroupId, [mv])
    }

    return links.map((l) => {
      const groupMods = modsByGroup.get(l.modifierGroupId) ?? []
      return {
        linkId: l.linkId,
        modifierGroupId: l.modifierGroupId,
        name: l.groupName,
        selectionType: l.selectionType,
        minSelect: l.minSelect,
        maxSelect: l.maxSelect,
        isActive: l.isActive,
        sortOrder: l.sortOrder,
        modifiers: groupMods,
        negativeDeltaWarning: computeGroupNegativeDeltaWarning(
          minBasePrice,
          l.selectionType,
          groupMods,
        ),
      }
    })
  })
}

export async function linkModifierGroupProduct(
  actor: CatalogActor,
  rawInput: LinkModifierGroupProductInput,
  deps?: CatalogServiceDeps,
): Promise<{ id: string; modifierGroupId: string; productId: string; sortOrder: number; version: number }> {
  requireCatalogPermission(actor)
  const parsed = parseOrThrow(linkModifierGroupProductSchema, rawInput, 'Invalid link input')
  const id = newIdFrom(deps)
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const group = await findModifierGroupById(tx, actor.tenantId, parsed.modifierGroupId)
    const prod = await findProductMetaForModifier(tx, actor.tenantId, parsed.productId)
    if (!group) {
      throw new AppError('VALIDATION_FAILED', 'Modifier group not found')
    }
    if (!prod) {
      throw new AppError('VALIDATION_FAILED', 'Product not found')
    }
    if (prod.productType !== 'MENU_FNB') {
      throw new AppError('VALIDATION_FAILED', 'Modifiers can only be linked to MENU_FNB products')
    }

    const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      const linked = await upsertModifierGroupProductRow(tx, w, {
        id,
        modifierGroupId: parsed.modifierGroupId,
        productId: parsed.productId,
        sortOrder: parsed.sortOrder,
        nowIso,
      })
      await appendAudit(
        tx,
        {
          actorUserId: actor.appUserId,
          action: 'modifier.changed',
          entityType: 'modifier_group_product',
          entityId: linked.id,
          afterData: {
            modifierGroupId: linked.modifierGroupId,
            productId: linked.productId,
            sortOrder: linked.sortOrder,
          },
          occurredAt: nowIso,
        },
        auditDeps(deps, nowIso),
      )
      return linked
    })
    return result
  })
}

export async function unlinkModifierGroupProduct(
  actor: CatalogActor,
  rawInput: { modifierGroupId: string; productId: string },
  deps?: CatalogServiceDeps,
): Promise<void> {
  requireCatalogPermission(actor)
  const parsed = parseOrThrow(unlinkModifierGroupProductSchema, rawInput, 'Invalid unlink input')
  const nowIso = nowIsoFrom(deps)

  await withTenant(actor.tenantId, async (tx) => {
    const existing = await findActiveModifierGroupProduct(
      tx,
      actor.tenantId,
      parsed.modifierGroupId,
      parsed.productId,
    )
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'Modifier group link not found')
    }
    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await tombstoneModifierGroupProductRow(
        tx,
        w,
        parsed.modifierGroupId,
        parsed.productId,
        nowIso,
      )
      await appendAudit(
        tx,
        {
          actorUserId: actor.appUserId,
          action: 'modifier.changed',
          entityType: 'modifier_group_product',
          entityId: existing.id,
          beforeData: {
            modifierGroupId: parsed.modifierGroupId,
            productId: parsed.productId,
            deletedAt: null,
          },
          afterData: { deletedAt: nowIso },
          occurredAt: nowIso,
        },
        auditDeps(deps, nowIso),
      )
    })
  })
}
