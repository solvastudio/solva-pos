import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
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
  tombstoneAvailabilityForProduct,
  upsertAvailabilityRow,
  type AvailabilityRow,
} from './availability.repo'
import { findCategoryById } from './category.repo'
import { getHasTransactionsPort } from './ports'
import { tombstonePriceEntriesForSku } from './price.repo'
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
  tombstoneSkuUomsBySku,
  updateBaseSkuUomForProduct,
  upsertSkuUomRow,
} from './sku-uom.repo'
import { findUomById } from './uom.repo'
import {
  insertAttributeValueRow,
  insertProductAttributeRow,
  insertSkuAttributeValueRow,
  insertSkuRow,
  listAttributeValuesByAttributes,
  listProductAttributes,
  listSkusByProduct,
  tombstoneAttributeValueRow,
  tombstoneProductAttributeRow,
  tombstoneSkuAttributeValuesForSku,
  tombstoneSkuRow,
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
  const parsedRes = createProductSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid product input',
    )
  }
  const parsed = parsedRes.data
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

        const createdSkus: SkuRow[] = []
        const createdAttrs: Array<{ attribute: ProductAttributeRow; values: AttributeValueRow[] }> = []

        if (!parsed.hasVariants) {
          const defaultSku = await insertSkuRow(tx, w, {
            id: newIdFrom(deps),
            productId,
            skuCode: parsed.code,
            variantLabel: null,
            isDefault: true,
            isActive: true,
            sortOrder: 0,
            nowIso,
          })
          await upsertSkuUomRow(tx, w, {
            id: newIdFrom(deps),
            skuId: defaultSku.id,
            uomId: parsed.baseUomId,
            conversionFactor: '1',
            isBase: true,
            barcode: cleanBarcode,
            nowIso,
          })
          createdSkus.push(defaultSku)
        } else {
          for (const attr of preparedAttributes) {
            const attrRow = await insertProductAttributeRow(tx, w.tenantId, w.actorUserId, {
              id: attr.id,
              productId,
              name: attr.name,
              sortOrder: attr.sortOrder,
              nowIso,
            })
            const valueRows: AttributeValueRow[] = []
            for (const val of attr.values) {
              const valRow = await insertAttributeValueRow(tx, w.tenantId, w.actorUserId, {
                id: val.id,
                attributeId: attrRow.id,
                value: val.value,
                sortOrder: val.sortOrder,
                nowIso,
              })
              valueRows.push(valRow)
            }
            createdAttrs.push({ attribute: attrRow, values: valueRows })
          }

          for (let idx = 0; idx < generatedSkus.length; idx += 1) {
            const spec = generatedSkus[idx]!
            const skuRow = await insertSkuRow(tx, w, {
              id: newIdFrom(deps),
              productId,
              skuCode: spec.skuCode,
              variantLabel: spec.variantLabel,
              isDefault: false,
              isActive: true,
              sortOrder: idx,
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
              uomId: parsed.baseUomId,
              conversionFactor: '1',
              isBase: true,
              barcode: null,
              nowIso,
            })
            createdSkus.push(skuRow)
          }
        }

        const availability: AvailabilityRow[] = []
        for (const outletId of activeOutlets) {
          const status = excludeOutletSet.has(outletId) ? 'UNAVAILABLE' : 'AVAILABLE'
          const availRow = await upsertAvailabilityRow(tx, w, {
            id: newIdFrom(deps),
            outletId,
            productId,
            skuId: null,
            status,
            nowIso,
          })
          availability.push(availRow)
        }

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
  const parsedRes = updateProductSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid product input',
    )
  }
  const parsed = parsedRes.data
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
      for (const s of skus) {
        await tombstonePriceEntriesForSku(tx, w, s.id, nowIso)
        await tombstoneSkuUomsBySku(tx, w, s.id, nowIso)
        await tombstoneSkuAttributeValuesForSku(tx, w.tenantId, w.actorUserId, s.id, nowIso)
        await tombstoneSkuRow(tx, w, s.id, nowIso)
      }
      for (const av of attrValues) {
        await tombstoneAttributeValueRow(tx, w.tenantId, w.actorUserId, av.id, nowIso)
      }
      for (const attr of attrs) {
        await tombstoneProductAttributeRow(tx, w.tenantId, w.actorUserId, attr.id, nowIso)
      }
      await tombstoneAvailabilityForProduct(tx, w, productId, nowIso)
      await tombstoneProductRow(tx, w, productId, nowIso)
    })

    return { id: productId }
  })
}
