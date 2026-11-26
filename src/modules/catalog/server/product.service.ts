import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { parseOrThrow } from '~/server/parse-or-throw'
import { createLogger } from '~/server/log'
import {
  createProductSchema,
  generateSkus,
  updateProductSchema,
  VariantLimitError,
  type CreateProductInput,
  type UpdateProductInput,
  type VariantAttributeInput,
} from '../shared'
import {
  newIdFrom,
  nowIsoFrom,
  requireCatalogPermission,
  type CatalogActor,
  type CatalogServiceDeps,
} from './auth'
import {
  listActiveOutletIds,
  listAvailabilityByProductIds,
  tombstoneAvailabilityForProduct,
  upsertAvailabilityBatch,
  type AvailabilityRow,
} from './availability.repo'
import { findCategoryById } from './category.repo'
import { getHasTransactionsPort } from './ports'
import { tombstonePriceEntriesForSkus } from './price.repo'
import {
  findProductById,
  insertProductRow,
  listProducts as listProductRows,
  tombstoneProductRow,
  updateProductRow,
  type ProductRow,
} from './product.repo'
import {
  findActiveSkuUomByBarcode,
  hasNonBaseActiveSkuUomForProductAndUom,
  tombstoneSkuUomsBySkus,
  updateBaseSkuUomForProduct,
  upsertSkuUomBatch,
} from './sku-uom.repo'
import { findUomById } from './uom.repo'
import {
  insertAttributeValueBatch,
  insertProductAttributeBatch,
  insertSkuAttributeValueBatch,
  listAttributeValuesByAttributes,
  listProductAttributes,
  listSkusByProduct,
  tombstoneAttributeValueRows,
  tombstoneProductAttributeRows,
  tombstoneSkuAttributeValuesForSkus,
  tombstoneSkuRows,
  upsertSkuBatch,
  type AttributeValueRow,
  type ProductAttributeRow,
  type SkuRow,
} from './variant.repo'

const log = createLogger('catalog.product')
const uuidSchema = z.string().uuid()

export interface CreateProductResult {
  product: ProductRow
  skus: SkuRow[]
  attributes: Array<{ attribute: ProductAttributeRow; values: AttributeValueRow[] }>
  availability: AvailabilityRow[]
  version: number
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

export async function listProducts(actor: CatalogActor): Promise<ProductRow[]> {
  requireCatalogPermission(actor)
  return withTenantReadOnly(actor.tenantId, (tx) => listProductRows(tx, actor.tenantId))
}

export async function getProductById(actor: CatalogActor, rawId: string): Promise<ProductRow | null> {
  requireCatalogPermission(actor)
  const idRes = uuidSchema.safeParse(rawId)
  if (!idRes.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid product id')
  }
  return withTenantReadOnly(actor.tenantId, (tx) => findProductById(tx, actor.tenantId, idRes.data))
}

export async function createProduct(
  actor: CatalogActor,
  rawInput: CreateProductInput,
  deps?: CatalogServiceDeps,
): Promise<CreateProductResult> {
  requireCatalogPermission(actor, { requireTenantWide: true })
  const parsed = parseOrThrow(createProductSchema, rawInput, 'Invalid product input')
  const nowIso = nowIsoFrom(deps)
  const productId = newIdFrom(deps)
  const cleanBarcode = parsed.barcode?.trim() || null

  if (parsed.hasVariants) {
    if (!parsed.attributes || parsed.attributes.length === 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Multi-variant product requires at least one attribute',
      )
    }
    if (cleanBarcode !== null) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Barcode can only be set directly on a single-variant product',
      )
    }
  } else if (parsed.attributes && parsed.attributes.length > 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Single-variant product cannot define variant attributes',
    )
  }

  // Pre-build attributes and SKUs outside tx (validates max 3 attributes, max 100 SKUs, no duplicates).
  const preparedAttributes = (parsed.attributes ?? []).map((attr, attrIdx) => ({
    id: newIdFrom(deps),
    name: attr.name,
    sortOrder: attrIdx,
    values: attr.values.map((val, valIdx) => ({
      id: newIdFrom(deps),
      value: val,
      sortOrder: valIdx,
    })),
  }))

  let generatedSkus: ReturnType<typeof generateSkus>['create'] = []
  if (parsed.hasVariants) {
    const domainAttrs: VariantAttributeInput[] = preparedAttributes.map((a) => ({
      name: a.name,
      values: a.values.map((v) => ({ id: v.id, value: v.value })),
    }))
    try {
      generatedSkus = generateSkus({
        productCode: parsed.code,
        attributes: domainAttrs,
        existing: [],
      }).create
    } catch (err) {
      if (err instanceof VariantLimitError) {
        throw new AppError('VALIDATION_FAILED', err.message)
      }
      throw err
    }
  }

  const excludeOutletSet = new Set(parsed.excludeOutletIds ?? [])

  try {
    return await withTenant(actor.tenantId, async (tx) => {
      const cat = await findCategoryById(tx, actor.tenantId, parsed.categoryId)
      if (!cat) {
        throw new AppError('VALIDATION_FAILED', 'Category not found')
      }
      const baseUom = await findUomById(tx, actor.tenantId, parsed.baseUomId)
      if (!baseUom) {
        throw new AppError('VALIDATION_FAILED', 'Base UOM not found')
      }
      if (!parsed.hasVariants && cleanBarcode !== null) {
        const dupBarcode = await findActiveSkuUomByBarcode(tx, actor.tenantId, cleanBarcode)
        if (dupBarcode) {
          throw new AppError('VALIDATION_FAILED', 'admin.catalog.barcodeTaken')
        }
      }

      const activeOutlets = await listActiveOutletIds(tx, actor.tenantId)
      const activeOutletSet = new Set(activeOutlets)
      for (const exId of excludeOutletSet) {
        if (!activeOutletSet.has(exId)) {
          throw new AppError('VALIDATION_FAILED', `Outlet not found: ${exId}`)
        }
      }

      const { version, result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
        const createdProduct = await insertProductRow(tx, w, {
          id: productId,
          categoryId: parsed.categoryId,
          code: parsed.code,
          name: parsed.name,
          productType: parsed.productType,
          hasVariants: parsed.hasVariants,
          baseUomId: parsed.baseUomId,
          trackStock: parsed.trackStock,
          taxable: parsed.taxable,
          isActive: parsed.isActive,
          isOpenPrice: parsed.isOpenPrice,
          sortOrder: parsed.sortOrder,
          nowIso,
        })

        const skuItems: Parameters<typeof upsertSkuBatch>[2][number][] = []
        const skuUomItems: Parameters<typeof upsertSkuUomBatch>[2][number][] = []
        const attrItems: Parameters<typeof insertProductAttributeBatch>[3][number][] = []
        const attrValueItems: Parameters<typeof insertAttributeValueBatch>[3][number][] = []
        const skuAttrItems: Parameters<typeof insertSkuAttributeValueBatch>[3][number][] = []

        if (!parsed.hasVariants) {
          const defaultSkuId = newIdFrom(deps)
          skuItems.push({
            id: defaultSkuId,
            productId,
            skuCode: parsed.code,
            variantLabel: null,
            isDefault: true,
            isActive: true,
            sortOrder: 0,
            nowIso,
          })
          skuUomItems.push({
            id: newIdFrom(deps),
            skuId: defaultSkuId,
            uomId: parsed.baseUomId,
            conversionFactor: '1',
            isBase: true,
            barcode: cleanBarcode,
            nowIso,
          })
        } else {
          for (const attr of preparedAttributes) {
            attrItems.push({
              id: attr.id,
              productId,
              name: attr.name,
              sortOrder: attr.sortOrder,
              nowIso,
            })
            for (const val of attr.values) {
              attrValueItems.push({
                id: val.id,
                attributeId: attr.id,
                value: val.value,
                sortOrder: val.sortOrder,
                nowIso,
              })
            }
          }
          generatedSkus.forEach((spec, idx) => {
            const skuId = newIdFrom(deps)
            skuItems.push({
              id: skuId,
              productId,
              skuCode: spec.skuCode,
              variantLabel: spec.variantLabel,
              isDefault: false,
              isActive: true,
              sortOrder: idx,
              nowIso,
            })
            for (const valId of spec.valueIds) {
              skuAttrItems.push({ id: newIdFrom(deps), skuId, attributeValueId: valId, nowIso })
            }
            skuUomItems.push({
              id: newIdFrom(deps),
              skuId,
              uomId: parsed.baseUomId,
              conversionFactor: '1',
              isBase: true,
              barcode: null,
              nowIso,
            })
          })
        }

        await insertProductAttributeBatch(tx, w.tenantId, w.actorUserId, attrItems)
        await insertAttributeValueBatch(tx, w.tenantId, w.actorUserId, attrValueItems)
        await upsertSkuBatch(tx, w, skuItems)
        await insertSkuAttributeValueBatch(tx, w.tenantId, w.actorUserId, skuAttrItems)
        await upsertSkuUomBatch(tx, w, skuUomItems)
        await upsertAvailabilityBatch(
          tx,
          w,
          activeOutlets.map((outletId) => ({
            id: newIdFrom(deps),
            outletId,
            productId,
            skuId: null,
            status: excludeOutletSet.has(outletId) ? ('UNAVAILABLE' as const) : ('AVAILABLE' as const),
            nowIso,
          })),
        )

        // Read back so the result carries the stored rows, in their canonical order.
        const createdSkus: SkuRow[] = await listSkusByProduct(tx, actor.tenantId, productId)
        const attributeRows = await listProductAttributes(tx, actor.tenantId, productId)
        const valueRows = await listAttributeValuesByAttributes(
          tx,
          actor.tenantId,
          attributeRows.map((a) => a.id),
        )
        const createdAttrs: Array<{ attribute: ProductAttributeRow; values: AttributeValueRow[] }> =
          attributeRows.map((attribute) => ({
            attribute,
            values: valueRows.filter((v) => v.attributeId === attribute.id),
          }))
        const outletRank = new Map(activeOutlets.map((id, i) => [id, i] as const))
        const availability: AvailabilityRow[] = (
          await listAvailabilityByProductIds(tx, actor.tenantId, [productId])
        ).sort((a, b) => (outletRank.get(a.outletId) ?? 0) - (outletRank.get(b.outletId) ?? 0))

        return {
          product: createdProduct,
          skus: createdSkus,
          attributes: createdAttrs,
          availability,
        }
      })

      log.info(
        {
          tenantId: actor.tenantId,
          userId: actor.appUserId,
          fn: 'createProduct',
          label: `${productId}:${parsed.code}`,
          rowCount: result.skus.length,
        },
        'Created product',
      )

      for (const availRow of result.availability) {
        if (availRow.status === 'UNAVAILABLE') {
          await appendAudit(
            tx,
            {
              action: 'availability.changed',
              entityType: 'item_outlet_availability',
              entityId: availRow.id,
              outletId: availRow.outletId,
              beforeData: null,
              afterData: {
                productId,
                skuId: null,
                status: 'UNAVAILABLE',
              },
              actorUserId: actor.appUserId,
              occurredAt: nowIso,
            },
            { newId: () => newIdFrom(deps), nowIso: () => nowIso },
          )
        }
      }

      return { ...result, version }
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.productCodeTaken')
    }
    throw err
  }
}

export async function updateProduct(
  actor: CatalogActor,
  rawInput: UpdateProductInput,
  deps?: CatalogServiceDeps,
): Promise<ProductRow> {
  requireCatalogPermission(actor, { requireTenantWide: true })
  const parsed = parseOrThrow(updateProductSchema, rawInput, 'Invalid product input')
  const nowIso = nowIsoFrom(deps)

  try {
    return await withTenant(actor.tenantId, async (tx) => {
      const existing = await findProductById(tx, actor.tenantId, parsed.id)
      if (!existing) {
        throw new AppError('VALIDATION_FAILED', 'Product not found')
      }

      if (parsed.categoryId !== undefined) {
        const cat = await findCategoryById(tx, actor.tenantId, parsed.categoryId)
        if (!cat) {
          throw new AppError('VALIDATION_FAILED', 'Category not found')
        }
      }

      const baseUomChanged =
        parsed.baseUomId !== undefined && parsed.baseUomId !== existing.baseUomId
      if (baseUomChanged && parsed.baseUomId !== undefined) {
        const hasTx = await getHasTransactionsPort().hasTransactions(existing.id, tx)
        if (hasTx) {
          throw new AppError('VALIDATION_FAILED', 'admin.catalog.baseUomImmutableWithTransactions')
        }
        const uom = await findUomById(tx, actor.tenantId, parsed.baseUomId)
        if (!uom) {
          throw new AppError('VALIDATION_FAILED', 'Base UOM not found')
        }
        const hasNonBase = await hasNonBaseActiveSkuUomForProductAndUom(
          tx,
          actor.tenantId,
          existing.id,
          parsed.baseUomId,
        )
        if (hasNonBase) {
          throw new AppError('VALIDATION_FAILED', 'admin.catalog.uomAlreadyAttached')
        }
      }

      const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
        const updated = await updateProductRow(tx, w, {
          id: parsed.id,
          ...(parsed.categoryId !== undefined ? { categoryId: parsed.categoryId } : {}),
          ...(parsed.code !== undefined ? { code: parsed.code } : {}),
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(parsed.baseUomId !== undefined ? { baseUomId: parsed.baseUomId } : {}),
          ...(parsed.trackStock !== undefined ? { trackStock: parsed.trackStock } : {}),
          ...(parsed.taxable !== undefined ? { taxable: parsed.taxable } : {}),
          ...(parsed.isActive !== undefined ? { isActive: parsed.isActive } : {}),
          ...(parsed.isOpenPrice !== undefined ? { isOpenPrice: parsed.isOpenPrice } : {}),
          ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
          nowIso,
        })
        if (!updated) {
          throw new AppError('VALIDATION_FAILED', 'Product not found')
        }
        if (baseUomChanged && parsed.baseUomId !== undefined) {
          await updateBaseSkuUomForProduct(tx, w, existing.id, parsed.baseUomId, nowIso)
        }
        return updated
      })

      return result
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.productCodeTaken')
    }
    throw err
  }
}

export async function deleteProduct(
  actor: CatalogActor,
  rawId: string,
  deps?: CatalogServiceDeps,
): Promise<{ id: string }> {
  requireCatalogPermission(actor, { requireTenantWide: true })
  const idRes = uuidSchema.safeParse(rawId)
  if (!idRes.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid product id')
  }
  const productId = idRes.data
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findProductById(tx, actor.tenantId, productId)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'Product not found')
    }
    if (await getHasTransactionsPort().hasTransactions(productId, tx)) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.productInUse')
    }

    const skus = await listSkusByProduct(tx, actor.tenantId, productId)
    const attrs = await listProductAttributes(tx, actor.tenantId, productId)
    const attrValues = await listAttributeValuesByAttributes(
      tx,
      actor.tenantId,
      attrs.map((a) => a.id),
    )

    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      const skuIds = skus.map((s) => s.id)
      await tombstonePriceEntriesForSkus(tx, w, skuIds, nowIso)
      await tombstoneSkuUomsBySkus(tx, w, skuIds, nowIso)
      await tombstoneSkuAttributeValuesForSkus(tx, w.tenantId, w.actorUserId, skuIds, nowIso)
      await tombstoneSkuRows(tx, w, skuIds, nowIso)
      await tombstoneAttributeValueRows(
        tx,
        w.tenantId,
        w.actorUserId,
        attrValues.map((av) => av.id),
        nowIso,
      )
      await tombstoneProductAttributeRows(
        tx,
        w.tenantId,
        w.actorUserId,
        attrs.map((a) => a.id),
        nowIso,
      )
      await tombstoneAvailabilityForProduct(tx, w, productId, nowIso)
      await tombstoneProductRow(tx, w, productId, nowIso)
    })

    return { id: productId }
  })
}
