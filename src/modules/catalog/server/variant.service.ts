import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { parseOrThrow } from '~/server/parse-or-throw'
import {
  generateSkus,
  VariantLimitError,
  type ExistingSkuCombo,
  type VariantAttributeInput,
} from '../shared'
import {
  newIdFrom,
  nowIsoFrom,
  requireCatalogPermission,
  requireCatalogView,
  type CatalogActor,
  type CatalogServiceDeps,
} from './auth'
import { tombstoneAvailabilityForSku } from './availability.repo'
import { getHasTransactionsPort } from './ports'
import { tombstonePriceEntriesForSku } from './price.repo'
import { findProductById } from './product.repo'
import { tombstoneSkuUomsBySku, upsertSkuUomRow } from './sku-uom.repo'
import {
  findSkuById,
  insertAttributeValueRow,
  insertSkuAttributeValueRow,
  insertSkuRow,
  listAttributeValuesByAttributes,
  listProductAttributes,
  listSkuAttributeValueLinks,
  listSkusByProduct,
  tombstoneAttributeValueRow,
  tombstoneSkuAttributeValuesForSku,
  tombstoneSkuRow,
  updateSkuRow,
  type AttributeValueRow,
  type ProductAttributeRow,
  type SkuAttributeValueRow,
  type SkuRow,
} from './variant.repo'

const uuidSchema = z.string().uuid()

const addAttributeValueSchema = z.object({
  productId: z.string().uuid(),
  attributeId: z.string().uuid(),
  value: z.string().trim().min(1).max(40),
})

const removeAttributeValueSchema = z.object({
  productId: z.string().uuid(),
  attributeValueId: z.string().uuid(),
})

const updateSkuSchema = z.object({
  skuId: z.string().uuid(),
  skuCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9\-_.]{1,40}$/)
    .optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export type AddAttributeValueInput = z.input<typeof addAttributeValueSchema>
export type RemoveAttributeValueInput = z.input<typeof removeAttributeValueSchema>
export type UpdateSkuInput = z.input<typeof updateSkuSchema>

export interface ProductVariantsView {
  attributes: Array<{ attribute: ProductAttributeRow; values: AttributeValueRow[] }>
  skus: SkuRow[]
  links: SkuAttributeValueRow[]
}

function isPgUniqueViolation(err: unknown): boolean {
  let cur: unknown = err
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i += 1) {
    if ('code' in cur && (cur as { code?: unknown }).code === '23505') {
      return true
    }
    cur = 'cause' in cur ? (cur as { cause?: unknown }).cause : null
  }
  return false
}

export async function listProductVariants(
  actor: CatalogActor,
  rawProductId: string,
): Promise<ProductVariantsView> {
  requireCatalogView(actor)
  const idRes = uuidSchema.safeParse(rawProductId)
  if (!idRes.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid product id')
  }
  const productId = idRes.data

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const attrs = await listProductAttributes(tx, actor.tenantId, productId)
    const values = await listAttributeValuesByAttributes(
      tx,
      actor.tenantId,
      attrs.map((a) => a.id),
    )
    const skus = await listSkusByProduct(tx, actor.tenantId, productId)
    const links = await listSkuAttributeValueLinks(
      tx,
      actor.tenantId,
      skus.map((s) => s.id),
    )

    const valuesByAttr = new Map<string, AttributeValueRow[]>()
    for (const v of values) {
      const arr = valuesByAttr.get(v.attributeId) ?? []
      arr.push(v)
      valuesByAttr.set(v.attributeId, arr)
    }

    return {
      attributes: attrs.map((attribute) => ({
        attribute,
        values: valuesByAttr.get(attribute.id) ?? [],
      })),
      skus,
      links,
    }
  })
}

export async function addAttributeValue(
  actor: CatalogActor,
  rawInput: AddAttributeValueInput,
  deps?: CatalogServiceDeps,
): Promise<{ attributeValue: AttributeValueRow; createdSkus: SkuRow[]; version: number }> {
  requireCatalogPermission(actor)
  const parsed = parseOrThrow(addAttributeValueSchema, rawInput, 'Invalid attribute value input')
  const nowIso = nowIsoFrom(deps)
  const newValueId = newIdFrom(deps)

  try {
    return await withTenant(actor.tenantId, async (tx) => {
      const prod = await findProductById(tx, actor.tenantId, parsed.productId)
      if (!prod) {
        throw new AppError('VALIDATION_FAILED', 'Product not found')
      }
      if (!prod.hasVariants) {
        throw new AppError('VALIDATION_FAILED', 'Product does not have variants enabled')
      }

      const attrs = await listProductAttributes(tx, actor.tenantId, prod.id)
      const targetAttr = attrs.find((a) => a.id === parsed.attributeId)
      if (!targetAttr) {
        throw new AppError('VALIDATION_FAILED', 'Attribute not found on product')
      }

      const existingValues = await listAttributeValuesByAttributes(
        tx,
        actor.tenantId,
        attrs.map((a) => a.id),
      )
      const existingSkus = await listSkusByProduct(tx, actor.tenantId, prod.id)
      const existingLinks = await listSkuAttributeValueLinks(
        tx,
        actor.tenantId,
        existingSkus.map((s) => s.id),
      )

      const valuesByAttr = new Map<string, AttributeValueRow[]>()
      for (const v of existingValues) {
        const list = valuesByAttr.get(v.attributeId) ?? []
        list.push(v)
        valuesByAttr.set(v.attributeId, list)
      }

      const linksBySku = new Map<string, string[]>()
      for (const l of existingLinks) {
        const arr = linksBySku.get(l.skuId) ?? []
        arr.push(l.attributeValueId)
        linksBySku.set(l.skuId, arr)
      }

      const domainAttrs: VariantAttributeInput[] = attrs.map((a) => {
        const currentVals = (valuesByAttr.get(a.id) ?? []).map((v) => ({
          id: v.id,
          value: v.value,
        }))
        if (a.id === targetAttr.id) {
          currentVals.push({ id: newValueId, value: parsed.value })
        }
        return { name: a.name, values: currentVals }
      })

      const existingCombos: ExistingSkuCombo[] = existingSkus.map((s) => ({
        combo: linksBySku.get(s.id) ?? [],
        skuCode: s.skuCode,
      }))

      let toCreate: ReturnType<typeof generateSkus>['create']
      try {
        toCreate = generateSkus({
          productCode: prod.code,
          attributes: domainAttrs,
          existing: existingCombos,
        }).create
      } catch (err) {
        if (err instanceof VariantLimitError) {
          throw new AppError('VALIDATION_FAILED', err.message)
        }
        throw err
      }

      const targetExistingCount = (valuesByAttr.get(targetAttr.id) ?? []).length
      const nextSortStart = existingSkus.reduce((max, s) => Math.max(max, s.sortOrder + 1), 0)

      const { version, result } = await writeMaster(
        tx,
        { actorUserId: actor.appUserId },
        async (w) => {
          const createdValue = await insertAttributeValueRow(tx, w.tenantId, w.actorUserId, {
            id: newValueId,
            attributeId: targetAttr.id,
            value: parsed.value,
            sortOrder: targetExistingCount,
            nowIso,
          })

          const createdSkus: SkuRow[] = []
          for (let idx = 0; idx < toCreate.length; idx += 1) {
            const spec = toCreate[idx]!
            const skuRow = await insertSkuRow(tx, w, {
              id: newIdFrom(deps),
              productId: prod.id,
              skuCode: spec.skuCode,
              variantLabel: spec.variantLabel,
              isDefault: false,
              isActive: true,
              sortOrder: nextSortStart + idx,
              nowIso,
            })
            for (const valId of spec.valueIds) {
              await insertSkuAttributeValueRow(tx, w.tenantId, w.actorUserId, {
                id: newIdFrom(deps),
                skuId: skuRow.id,
                attributeValueId: valId,
                nowIso,
              })
            }
            await upsertSkuUomRow(tx, w, {
              id: newIdFrom(deps),
              skuId: skuRow.id,
              uomId: prod.baseUomId,
              conversionFactor: '1',
              isBase: true,
              barcode: null,
              nowIso,
            })
            createdSkus.push(skuRow)
          }

          return { attributeValue: createdValue, createdSkus }
        },
      )

      return { ...result, version }
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.duplicateVariantOrCode')
    }
    throw err
  }
}

export async function removeAttributeValue(
  actor: CatalogActor,
  rawInput: RemoveAttributeValueInput,
  deps?: CatalogServiceDeps,
): Promise<{ removedSkuIds: string[]; version: number }> {
  requireCatalogPermission(actor)
  const parsed = parseOrThrow(removeAttributeValueSchema, rawInput, 'Invalid attribute value input')
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const prod = await findProductById(tx, actor.tenantId, parsed.productId)
    if (!prod || !prod.hasVariants) {
      throw new AppError('VALIDATION_FAILED', 'Variant product not found')
    }

    const attrs = await listProductAttributes(tx, actor.tenantId, prod.id)
    const values = await listAttributeValuesByAttributes(
      tx,
      actor.tenantId,
      attrs.map((a) => a.id),
    )
    const targetVal = values.find((v) => v.id === parsed.attributeValueId)
    if (!targetVal) {
      throw new AppError('VALIDATION_FAILED', 'Attribute value not found')
    }

    const siblingCount = values.filter((v) => v.attributeId === targetVal.attributeId).length
    if (siblingCount <= 1) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.cannotRemoveLastAttributeValue')
    }

    const skus = await listSkusByProduct(tx, actor.tenantId, prod.id)
    const links = await listSkuAttributeValueLinks(
      tx,
      actor.tenantId,
      skus.map((s) => s.id),
    )

    const affectedSkuIds = Array.from(
      new Set(links.filter((l) => l.attributeValueId === targetVal.id).map((l) => l.skuId)),
    )

    if (skus.length - affectedSkuIds.length <= 0) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.cannotRemoveAllSkus')
    }

    for (const skuId of affectedSkuIds) {
      if (await getHasTransactionsPort().hasTransactions(skuId, tx)) {
        throw new AppError('VALIDATION_FAILED', 'admin.catalog.variantInUse')
      }
    }

    const { version } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      for (const skuId of affectedSkuIds) {
        await tombstonePriceEntriesForSku(tx, w, skuId, nowIso)
        await tombstoneSkuUomsBySku(tx, w, skuId, nowIso)
        await tombstoneAvailabilityForSku(tx, w, skuId, nowIso)
        await tombstoneSkuAttributeValuesForSku(tx, w.tenantId, w.actorUserId, skuId, nowIso)
        await tombstoneSkuRow(tx, w, skuId, nowIso)
      }
      await tombstoneAttributeValueRow(tx, w.tenantId, w.actorUserId, targetVal.id, nowIso)
    })

    return { removedSkuIds: affectedSkuIds, version }
  })
}

export async function updateSku(
  actor: CatalogActor,
  rawInput: UpdateSkuInput,
  deps?: CatalogServiceDeps,
): Promise<SkuRow> {
  requireCatalogPermission(actor)
  const parsed = parseOrThrow(updateSkuSchema, rawInput, 'Invalid SKU input')
  const nowIso = nowIsoFrom(deps)

  try {
    return await withTenant(actor.tenantId, async (tx) => {
      const existing = await findSkuById(tx, actor.tenantId, parsed.skuId)
      if (!existing) {
        throw new AppError('VALIDATION_FAILED', 'SKU not found')
      }

      const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
        const updated = await updateSkuRow(tx, w, {
          id: parsed.skuId,
          ...(parsed.skuCode !== undefined ? { skuCode: parsed.skuCode } : {}),
          ...(parsed.isActive !== undefined ? { isActive: parsed.isActive } : {}),
          ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
          nowIso,
        })
        if (!updated) {
          throw new AppError('VALIDATION_FAILED', 'SKU not found')
        }
        return updated
      })
      return result
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.skuCodeTaken')
    }
    throw err
  }
}
