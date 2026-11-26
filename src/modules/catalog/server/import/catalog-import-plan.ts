import '@tanstack/react-start/server-only'
import { withTenantReadOnly } from '~/server/db'
import type { ProductType } from '../../shared'
import { newIdFrom, type CatalogActor, type CatalogServiceDeps } from '../auth'
import { listActiveOutletIds } from '../availability.repo'
import { listCategories, type CategoryRow } from '../category.repo'
import { getHasTransactionsPort } from '../ports'
import { listActivePriceEntriesBySkuIds } from '../price.repo'
import { listProductsByCodes } from '../product.repo'
import {
  hasNonBaseActiveSkuUomForProductAndUom,
  listActiveSkuUomsByBarcodes,
  listSkuUomsBySkuIds,
} from '../sku-uom.repo'
import { listUoms } from '../uom.repo'
import {
  listAttributeValuesByAttributes,
  listProductAttributesByProductIds,
  listSkusByCodes,
  listSkusByProductIds,
} from '../variant.repo'
import { type EntityDiffCounts } from './types'
import { parseAndValidateCatalogCsvRows, type ErrorCollector, type ValidatedCatalogCsvRow } from './catalog-csv'

export interface CatalogImportPlan {
  kind: 'catalog'
  fileName: string
  categoriesToWrite: Array<{
    id: string
    parentId: string | null
    name: string
    sortOrder: number
  }>
  productsToWrite: Array<{
    id: string
    categoryId: string
    code: string
    name: string
    productType: ProductType
    hasVariants: boolean
    baseUomId: string
    trackStock: boolean
    taxable: boolean
    isActive: boolean
    isOpenPrice: boolean
    sortOrder: number
  }>
  attributesToCreate: Array<{ id: string; productId: string; name: string; sortOrder: number }>
  attributeValuesToCreate: Array<{ id: string; attributeId: string; value: string; sortOrder: number }>
  skusToWrite: Array<{
    id: string
    productId: string
    skuCode: string
    variantLabel: string | null
    isDefault: boolean
    isActive: boolean
    sortOrder: number
  }>
  skuAttributeLinksToCreate: Array<{ id: string; skuId: string; attributeValueId: string }>
  skuUomsToWrite: Array<{
    id: string
    skuId: string
    uomId: string
    conversionFactor: string
    isBase: boolean
    barcode: string | null
  }>
  pricesToWrite: Array<{
    id: string
    skuId: string
    uomId: string
    outletId: null
    price: number
    currency: 'IDR'
  }>
  newProductIds: string[]
  activeOutletIds: string[]
  expectedNewProductCodes: string[]
  expectedNewSkuCodes: string[]
  summary: Record<string, EntityDiffCounts>
}

export function groupRowsByProduct(
  structural: ReturnType<typeof parseAndValidateCatalogCsvRows>,
  col: ErrorCollector,
) {
  // Group parsed valid rows + intra-file uniqueness checks
  const seenSkuCodes = new Map<string, number>()
  const seenBarcodes = new Map<string, number>()
  const rowsByProduct = new Map<string, ValidatedCatalogCsvRow[]>()

  for (const row of structural.rows) {
    const prevSkuRow = seenSkuCodes.get(row.skuCode)
    if (prevSkuRow !== undefined) {
      col.push(row.rowNumber, 'kode_sku', 'DUPLICATE_SKU_CODE', 'import.error.duplicateSkuCode')
    } else {
      seenSkuCodes.set(row.skuCode, row.rowNumber)
    }

    if (row.barcode !== null) {
      const prevBcRow = seenBarcodes.get(row.barcode)
      if (prevBcRow !== undefined) {
        col.push(row.rowNumber, 'barcode', 'DUPLICATE_BARCODE', 'import.error.duplicateBarcode')
      } else {
        seenBarcodes.set(row.barcode, row.rowNumber)
      }
    }

    const list = rowsByProduct.get(row.productCode) ?? []
    list.push(row)
    rowsByProduct.set(row.productCode, list)
  }

  // Product-group consistency checks
  for (const [, pRows] of rowsByProduct) {
    const hasVar = pRows.length > 1 || pRows.some((r) => r.variantLabel !== null)
    const first = pRows[0]!
    for (const r of pRows) {
      if (hasVar && r.variantLabel === null) {
        col.push(r.rowNumber, 'label_varian', 'REQUIRED', 'import.error.variantLabelRequired')
      }
      if (
        r.productName !== first.productName ||
        r.baseUomCode !== first.baseUomCode ||
        r.productType !== first.productType ||
        r.categorySegments.join('>') !== first.categorySegments.join('>')
      ) {
        col.push(r.rowNumber, 'kode_produk', 'INVALID_FORMAT', 'import.error.inconsistentProductRow')
      }
    }
    if (pRows.length > 100) {
      col.push(pRows[100]!.rowNumber, 'kode_sku', 'VARIANT_LIMIT', 'import.error.variantLimit')
    }
  }
  return { seenSkuCodes, seenBarcodes, rowsByProduct }
}

export async function loadImportSnapshot(
  actor: CatalogActor,
  col: ErrorCollector,
  rowsByProduct: Map<string, ValidatedCatalogCsvRow[]>,
  productCodes: string[],
  skuCodes: string[],
  barcodes: string[],
) {
  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const existingCategories = await listCategories(tx, actor.tenantId)
    const existingUoms = await listUoms(tx, actor.tenantId)
    const existingProducts = await listProductsByCodes(tx, actor.tenantId, productCodes)
    const existingSkusByCode = await listSkusByCodes(tx, actor.tenantId, skuCodes)
    const existingBarcodeRows = await listActiveSkuUomsByBarcodes(tx, actor.tenantId, barcodes)
    const activeOutletIds = await listActiveOutletIds(tx, actor.tenantId)

    const prodIds = existingProducts.map((p) => p.id)
    const existingProductSkus = await listSkusByProductIds(tx, actor.tenantId, prodIds)
    const existingAttrs = await listProductAttributesByProductIds(tx, actor.tenantId, prodIds)
    const allKnownSkuIds = Array.from(
      new Set([...existingSkusByCode.map((s) => s.id), ...existingProductSkus.map((s) => s.id)]),
    )
    const existingAttrValues = await listAttributeValuesByAttributes(
      tx,
      actor.tenantId,
      existingAttrs.map((a) => a.id),
    )
    const existingSkuUoms = await listSkuUomsBySkuIds(tx, actor.tenantId, allKnownSkuIds)
    const existingPrices = await listActivePriceEntriesBySkuIds(tx, actor.tenantId, allKnownSkuIds)

    // Validate baseUomId changes against HasTransactionsPort and non-base UOMs
    const uomByCode = new Map(existingUoms.map((u) => [u.code.toLowerCase(), u]))
    const prodByCode = new Map(existingProducts.map((p) => [p.code, p]))
    const hasTransactionsPort = getHasTransactionsPort()

    for (const [code, pRows] of rowsByProduct) {
      const existingProd = prodByCode.get(code)
      const targetUom = uomByCode.get(pRows[0]!.baseUomCode)
      if (!targetUom) {
        for (const r of pRows) {
          col.push(r.rowNumber, 'uom_dasar', 'UNKNOWN_UOM', 'import.error.unknownUom')
        }
        continue
      }
      if (existingProd && existingProd.baseUomId !== targetUom.id) {
        if (await hasTransactionsPort.hasTransactions(existingProd.id, tx)) {
          col.push(pRows[0]!.rowNumber, 'uom_dasar', 'BASE_UOM_LOCKED', 'import.error.baseUomLocked')
        } else if (
          await hasNonBaseActiveSkuUomForProductAndUom(tx, actor.tenantId, existingProd.id, targetUom.id)
        ) {
          col.push(pRows[0]!.rowNumber, 'uom_dasar', 'BASE_UOM_LOCKED', 'import.error.baseUomLocked')
        }
      }
    }

    return {
      existingCategories,
      uomByCode,
      existingProducts,
      existingSkusByCode,
      existingProductSkus,
      existingAttrs,
      existingAttrValues,
      existingBarcodeRows,
      existingSkuUoms,
      existingPrices,
      activeOutletIds,
    }
  })
}

export type CatalogImportSnapshot = Awaited<ReturnType<typeof loadImportSnapshot>>

export function resolveImportCategories(
  structural: ReturnType<typeof parseAndValidateCatalogCsvRows>,
  summary: Record<string, EntityDiffCounts>,
  dbSnapshot: CatalogImportSnapshot,
  deps?: CatalogServiceDeps,
) {
  // Category path resolution (root -> child, max depth 2)
  const rootCatByName = new Map<string, CategoryRow>()
  const childCatByKey = new Map<string, CategoryRow>()
  const catById = new Map<string, CategoryRow>()
  for (const cat of dbSnapshot.existingCategories) {
    catById.set(cat.id, cat)
  }
  for (const cat of dbSnapshot.existingCategories) {
    if (cat.parentId === null) {
      rootCatByName.set(cat.name.toLowerCase(), cat)
    } else {
      const parent = catById.get(cat.parentId)
      if (parent) {
        childCatByKey.set(`${parent.name.toLowerCase()}>${cat.name.toLowerCase()}`, cat)
      }
    }
  }

  let nextCatSort =
    dbSnapshot.existingCategories.reduce((m, c) => Math.max(m, c.sortOrder), -1) + 1
  const plannedNewCats = new Map<
    string,
    { id: string; parentId: string | null; name: string; sortOrder: number }
  >()
  const resolvedCatIdByRow = new Map<number, string>()

  const getOrPlanRootCat = (name: string, rowNum: number): string | null => {
    const key = name.toLowerCase()
    const existingRoot = rootCatByName.get(key)
    if (existingRoot) return existingRoot.id
    const planned = plannedNewCats.get(key)
    if (planned) return planned.id
    // Check if an active non-root category shares this name at root? Non-issue because DB uniqueness is per parent_id,
    // wait: if parent doesn't exist, we plan a root category cleanly!
    const created = { id: newIdFrom(deps), parentId: null, name, sortOrder: nextCatSort++ }
    plannedNewCats.set(key, created)
    void rowNum
    return created.id
  }

  for (const row of structural.rows) {
    const segs = row.categorySegments
    if (segs.length === 1) {
      const key = segs[0]!.toLowerCase()
      const existingRoot = rootCatByName.get(key)
      if (existingRoot) {
        resolvedCatIdByRow.set(row.rowNumber, existingRoot.id)
      } else {
        const planned = plannedNewCats.get(key)
        if (planned) {
          resolvedCatIdByRow.set(row.rowNumber, planned.id)
        } else {
          const id = getOrPlanRootCat(segs[0]!, row.rowNumber)!
          resolvedCatIdByRow.set(row.rowNumber, id)
        }
      }
    } else if (segs.length === 2) {
      const rootName = segs[0]!
      const childName = segs[1]!
      const fullKey = `${rootName.toLowerCase()}>${childName.toLowerCase()}`
      const existingChild = childCatByKey.get(fullKey)
      if (existingChild) {
        resolvedCatIdByRow.set(row.rowNumber, existingChild.id)
      } else {
        const plannedChild = plannedNewCats.get(fullKey)
        if (plannedChild) {
          resolvedCatIdByRow.set(row.rowNumber, plannedChild.id)
        } else {
          const parentId = getOrPlanRootCat(rootName, row.rowNumber)!
          const child = {
            id: newIdFrom(deps),
            parentId,
            name: childName,
            sortOrder: nextCatSort++,
          }
          plannedNewCats.set(fullKey, child)
          resolvedCatIdByRow.set(row.rowNumber, child.id)
        }
      }
    }
  }

  const touchedExistingCatIds = new Set<string>()
  for (const catId of resolvedCatIdByRow.values()) {
    if (catById.has(catId)) touchedExistingCatIds.add(catId)
  }
  summary.category = {
    create: plannedNewCats.size,
    update: 0,
    unchanged: touchedExistingCatIds.size,
  }
  return { plannedNewCats, resolvedCatIdByRow }
}

interface ImportPlanningInput {
  col: ErrorCollector
  rowsByProduct: Map<string, ValidatedCatalogCsvRow[]>
  summary: Record<string, EntityDiffCounts>
  dbSnapshot: CatalogImportSnapshot
  resolvedCatIdByRow: Map<number, string>
  deps?: CatalogServiceDeps
}

export function planProductWrites(input: ImportPlanningInput) {
  const { col, rowsByProduct, summary, dbSnapshot, resolvedCatIdByRow, deps } = input
  // Index existing DB state
  const existingProdByCode = new Map(dbSnapshot.existingProducts.map((p) => [p.code, p]))
  const existingSkuByCode = new Map(dbSnapshot.existingSkusByCode.map((s) => [s.skuCode, s]))
  const existingSkusByProdId = new Map<string, typeof dbSnapshot.existingProductSkus>()
  for (const s of dbSnapshot.existingProductSkus) {
    const arr = existingSkusByProdId.get(s.productId) ?? []
    arr.push(s)
    existingSkusByProdId.set(s.productId, arr)
  }
  const existingBaseSkuUomBySkuId = new Map(
    dbSnapshot.existingSkuUoms.filter((u) => u.isBase).map((u) => [u.skuId, u]),
  )
  const existingDefaultPriceBySkuUom = new Map(
    dbSnapshot.existingPrices
      .filter((p) => p.outletId === null)
      .map((p) => [`${p.skuId}:${p.uomId}`, p]),
  )
  const existingBarcodeOwnerByValue = new Map(
    dbSnapshot.existingBarcodeRows.filter((b) => b.barcode !== null).map((b) => [b.barcode!, b]),
  )

  const productsToWrite: CatalogImportPlan['productsToWrite'] = []
  const attributesToCreate: CatalogImportPlan['attributesToCreate'] = []
  const attributeValuesToCreate: CatalogImportPlan['attributeValuesToCreate'] = []
  const skusToWrite: CatalogImportPlan['skusToWrite'] = []
  const skuAttributeLinksToCreate: CatalogImportPlan['skuAttributeLinksToCreate'] = []
  const skuUomsToWrite: CatalogImportPlan['skuUomsToWrite'] = []
  const pricesToWrite: CatalogImportPlan['pricesToWrite'] = []
  const newProductIds: string[] = []
  const expectedNewProductCodes: string[] = []
  const expectedNewSkuCodes: string[] = []

  const existingAttrByProdId = new Map(dbSnapshot.existingAttrs.map((a) => [a.productId, a]))
  const existingAttrValsByAttrId = new Map<string, Map<string, string>>()
  for (const av of dbSnapshot.existingAttrValues) {
    let m = existingAttrValsByAttrId.get(av.attributeId)
    if (!m) {
      m = new Map()
      existingAttrValsByAttrId.set(av.attributeId, m)
    }
    m.set(av.value.toLowerCase(), av.id)
  }

  let prodIdx = 0
  for (const [productCode, pRows] of rowsByProduct) {
    const first = pRows[0]!
    const uom = dbSnapshot.uomByCode.get(first.baseUomCode)
    const catId = resolvedCatIdByRow.get(first.rowNumber)
    if (!uom || !catId) continue

    const existingProd = existingProdByCode.get(productCode)
    const hasVariants = pRows.length > 1 || pRows.some((r) => r.variantLabel !== null)
    const productId = existingProd?.id ?? newIdFrom(deps)

    if (existingProd && existingProd.hasVariants !== hasVariants) {
      col.push(first.rowNumber, 'label_varian', 'VARIANT_LIMIT', 'import.error.variantModeMismatch')
      continue
    }

    if (!existingProd) {
      summary.product!.create += 1
      newProductIds.push(productId)
      expectedNewProductCodes.push(productCode)
      productsToWrite.push({
        id: productId,
        categoryId: catId,
        code: productCode,
        name: first.productName,
        productType: first.productType,
        hasVariants,
        baseUomId: uom.id,
        trackStock: first.trackStock,
        taxable: first.taxable,
        isActive: first.isActive,
        isOpenPrice: first.isOpenPrice,
        sortOrder: prodIdx,
      })
    } else {
      const sameProd =
        existingProd.categoryId === catId &&
        existingProd.name === first.productName &&
        existingProd.productType === first.productType &&
        existingProd.baseUomId === uom.id &&
        existingProd.trackStock === first.trackStock &&
        existingProd.taxable === first.taxable &&
        existingProd.isActive === first.isActive &&
        existingProd.isOpenPrice === first.isOpenPrice
      if (sameProd) {
        summary.product!.unchanged += 1
      } else {
        summary.product!.update += 1
        productsToWrite.push({
          id: productId,
          categoryId: catId,
          code: productCode,
          name: first.productName,
          productType: first.productType,
          hasVariants,
          baseUomId: uom.id,
          trackStock: first.trackStock,
          taxable: first.taxable,
          isActive: first.isActive,
          isOpenPrice: first.isOpenPrice,
          sortOrder: existingProd.sortOrder,
        })
      }
    }
    prodIdx += 1

    // Variant attribute ("Varian") setup if hasVariants
    let variantAttrId: string | null = null
    let variantValMap = new Map<string, string>()
    let nextValSort = 0
    if (hasVariants) {
      const existingAttr = existingAttrByProdId.get(productId)
      if (existingAttr) {
        variantAttrId = existingAttr.id
        variantValMap = existingAttrValsByAttrId.get(existingAttr.id) ?? new Map()
        nextValSort = variantValMap.size
      } else {
        variantAttrId = newIdFrom(deps)
        attributesToCreate.push({
          id: variantAttrId,
          productId,
          name: 'Varian',
          sortOrder: 0,
        })
      }
    }

    const existingProdSkus = existingSkusByProdId.get(productId) ?? []
    let newSkuCountForProd = 0

    for (let sIdx = 0; sIdx < pRows.length; sIdx += 1) {
      const row = pRows[sIdx]!
      const matchedSkuByCode = existingSkuByCode.get(row.skuCode)
      if (matchedSkuByCode && matchedSkuByCode.productId !== productId) {
        col.push(row.rowNumber, 'kode_sku', 'DUPLICATE_SKU_CODE', 'import.error.duplicateSkuCode')
        continue
      }

      const existingSku =
        matchedSkuByCode ??
        (!hasVariants && existingProd ? existingProdSkus.find((s) => s.isDefault) : undefined)

      const skuId = existingSku?.id ?? newIdFrom(deps)
      if (!existingSku) {
        newSkuCountForProd += 1
        summary.sku!.create += 1
        expectedNewSkuCodes.push(row.skuCode)
        skusToWrite.push({
          id: skuId,
          productId,
          skuCode: row.skuCode,
          variantLabel: hasVariants ? row.variantLabel : null,
          isDefault: !hasVariants,
          isActive: row.isActive,
          sortOrder: existingProdSkus.length + sIdx,
        })
        if (hasVariants && variantAttrId && row.variantLabel !== null) {
          const valKey = row.variantLabel.toLowerCase()
          let valId = variantValMap.get(valKey)
          if (!valId) {
            valId = newIdFrom(deps)
            variantValMap.set(valKey, valId)
            attributeValuesToCreate.push({
              id: valId,
              attributeId: variantAttrId,
              value: row.variantLabel,
              sortOrder: nextValSort++,
            })
          }
          skuAttributeLinksToCreate.push({
            id: newIdFrom(deps),
            skuId,
            attributeValueId: valId,
          })
        }
      } else {
        const sameSku =
          existingSku.skuCode === row.skuCode &&
          existingSku.variantLabel === (hasVariants ? row.variantLabel : null) &&
          existingSku.isActive === row.isActive
        if (sameSku) {
          summary.sku!.unchanged += 1
        } else {
          summary.sku!.update += 1
          skusToWrite.push({
            id: skuId,
            productId,
            skuCode: row.skuCode,
            variantLabel: hasVariants ? row.variantLabel : null,
            isDefault: existingSku.isDefault,
            isActive: row.isActive,
            sortOrder: existingSku.sortOrder,
          })
        }
      }

      // Base sku_uom barcode collision check against DB
      if (row.barcode !== null) {
        const existingBcOwner = existingBarcodeOwnerByValue.get(row.barcode)
        if (existingBcOwner && existingBcOwner.skuId !== skuId) {
          col.push(row.rowNumber, 'barcode', 'DUPLICATE_BARCODE', 'import.error.duplicateBarcode')
        }
      }

      const existingBaseUom = existingBaseSkuUomBySkuId.get(skuId)
      if (!existingBaseUom) {
        summary.sku_uom!.create += 1
        skuUomsToWrite.push({
          id: newIdFrom(deps),
          skuId,
          uomId: uom.id,
          conversionFactor: '1',
          isBase: true,
          barcode: row.barcode,
        })
      } else if (existingBaseUom.uomId !== uom.id || existingBaseUom.barcode !== row.barcode) {
        summary.sku_uom!.update += 1
        skuUomsToWrite.push({
          id: existingBaseUom.id,
          skuId,
          uomId: uom.id,
          conversionFactor: '1',
          isBase: true,
          barcode: row.barcode,
        })
      } else {
        summary.sku_uom!.unchanged += 1
      }

      if (row.defaultPrice !== null) {
        const existingPrice = existingDefaultPriceBySkuUom.get(`${skuId}:${uom.id}`)
        if (!existingPrice) {
          summary.price_entry!.create += 1
          pricesToWrite.push({
            id: newIdFrom(deps),
            skuId,
            uomId: uom.id,
            outletId: null,
            price: row.defaultPrice,
            currency: 'IDR',
          })
        } else if (existingPrice.price !== row.defaultPrice) {
          summary.price_entry!.update += 1
          pricesToWrite.push({
            id: existingPrice.id,
            skuId,
            uomId: uom.id,
            outletId: null,
            price: row.defaultPrice,
            currency: 'IDR',
          })
        } else {
          summary.price_entry!.unchanged += 1
        }
      }
    }

    if (hasVariants && existingProdSkus.length + newSkuCountForProd > 100) {
      col.push(first.rowNumber, 'kode_sku', 'VARIANT_LIMIT', 'import.error.variantLimit')
    }
  }

  summary.item_outlet_availability = {
    create: newProductIds.length * dbSnapshot.activeOutletIds.length,
    update: 0,
    unchanged: 0,
  }
  return {
    productsToWrite,
    attributesToCreate,
    attributeValuesToCreate,
    skusToWrite,
    skuAttributeLinksToCreate,
    skuUomsToWrite,
    pricesToWrite,
    newProductIds,
    expectedNewProductCodes,
    expectedNewSkuCodes,
  }
}
