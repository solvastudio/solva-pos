import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { writeMaster } from '~/modules/sync/public'
import { withTenant } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { createLogger } from '~/server/log'
import {
  newIdFrom,
  nowIsoFrom,
  requireCatalogPermission,
  type CatalogActor,
  type CatalogServiceDeps,
} from '../auth'
import { insertDefaultAvailabilityForProductsBatch } from '../availability.repo'
import { upsertCategoryBatch } from '../category.repo'
import { upsertPriceEntryBatch } from '../price.repo'
import { listProductsByCodes, upsertProductBatch } from '../product.repo'
import { listActiveSkuUomsByBarcodes, upsertSkuUomBatch } from '../sku-uom.repo'
import {
  insertAttributeValueBatch,
  insertProductAttributeBatch,
  insertSkuAttributeValueBatch,
  listSkusByCodes,
  upsertSkuBatch,
} from '../variant.repo'
import { consumeImportPlan, storeImportPlan } from './plan-cache'
import { type CommitImportResult, type EntityDiffCounts, type ImportReport } from './types'
import { createErrorCollector, parseAndValidateCatalogCsvRows } from './catalog-csv'
import {
  groupRowsByProduct,
  loadImportSnapshot,
  planProductWrites,
  resolveImportCategories,
  type CatalogImportPlan,
} from './catalog-import-plan'

const log = createLogger('catalog.import')

export async function previewCatalogImport(
  actor: CatalogActor,
  csvText: string,
  fileName: string,
  deps?: CatalogServiceDeps,
): Promise<ImportReport> {
  requireCatalogPermission(actor, { requireTenantWide: true })
  const structural = parseAndValidateCatalogCsvRows(csvText)

  const col = createErrorCollector()
  for (const e of structural.errors) {
    col.push(e.row, e.column, e.code, e.messageKey)
  }

  const { seenSkuCodes, seenBarcodes, rowsByProduct } = groupRowsByProduct(structural, col)

  const productCodes = Array.from(rowsByProduct.keys())
  const skuCodes = Array.from(seenSkuCodes.keys())
  const barcodes = Array.from(seenBarcodes.keys())

  const summary: Record<string, EntityDiffCounts> = {
    category: { create: 0, update: 0, unchanged: 0 },
    product: { create: 0, update: 0, unchanged: 0 },
    sku: { create: 0, update: 0, unchanged: 0 },
    sku_uom: { create: 0, update: 0, unchanged: 0 },
    price_entry: { create: 0, update: 0, unchanged: 0 },
    item_outlet_availability: { create: 0, update: 0, unchanged: 0 },
  }

  const dbSnapshot = await loadImportSnapshot(actor, col, rowsByProduct, productCodes, skuCodes, barcodes)

  const { plannedNewCats, resolvedCatIdByRow } = resolveImportCategories(
    structural,
    summary,
    dbSnapshot,
    deps,
  )

  const {
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
  } = planProductWrites({ col, rowsByProduct, summary, dbSnapshot, resolvedCatIdByRow, deps })

  if (col.totalErrors > 0) {
    return {
      valid: false,
      warnings: structural.warnings,
      errors: col.errors,
      totalErrors: col.totalErrors,
      summary,
    }
  }

  const token = newIdFrom(deps)
  const plan: CatalogImportPlan = {
    kind: 'catalog',
    fileName,
    categoriesToWrite: Array.from(plannedNewCats.values()),
    productsToWrite,
    attributesToCreate,
    attributeValuesToCreate,
    skusToWrite,
    skuAttributeLinksToCreate,
    skuUomsToWrite,
    pricesToWrite,
    newProductIds,
    activeOutletIds: dbSnapshot.activeOutletIds,
    expectedNewProductCodes,
    expectedNewSkuCodes,
    summary,
  }

  storeImportPlan({
    token,
    tenantId: actor.tenantId,
    userId: actor.appUserId,
    kind: 'catalog',
    plan,
    nowMs: Date.parse(nowIsoFrom(deps)),
  })

  return {
    valid: true,
    token,
    warnings: structural.warnings,
    errors: [],
    totalErrors: 0,
    summary,
  }
}

export async function commitCatalogImport(
  actor: CatalogActor,
  rawToken: string,
  deps?: CatalogServiceDeps,
): Promise<CommitImportResult> {
  requireCatalogPermission(actor, { requireTenantWide: true })
  const tokenRes = z.string().min(1).safeParse(rawToken)
  if (!tokenRes.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid import token')
  }

  const nowIso = nowIsoFrom(deps)
  const plan = consumeImportPlan<CatalogImportPlan>({
    token: tokenRes.data,
    tenantId: actor.tenantId,
    userId: actor.appUserId,
    kind: 'catalog',
    nowMs: Date.parse(nowIso),
  })

  const created = Object.fromEntries(
    Object.entries(plan.summary).map(([k, v]) => [k, v.create]),
  )
  const updated = Object.fromEntries(
    Object.entries(plan.summary).map(([k, v]) => [k, v.update]),
  )
  const unchanged = Object.fromEntries(
    Object.entries(plan.summary).map(([k, v]) => [k, v.unchanged]),
  )

  const totalMutations =
    plan.categoriesToWrite.length +
    plan.productsToWrite.length +
    plan.skusToWrite.length +
    plan.skuUomsToWrite.length +
    plan.pricesToWrite.length

  if (totalMutations === 0) {
    return { version: null, versionBumped: false, created, updated, unchanged }
  }

  const version = await withTenant(actor.tenantId, async (tx) => {
    // Fast re-validation against concurrent changes between preview and commit
    const concurrentProds = await listProductsByCodes(tx, actor.tenantId, plan.expectedNewProductCodes)
    const concurrentSkus = await listSkusByCodes(tx, actor.tenantId, plan.expectedNewSkuCodes)
    const concurrentBarcodes = await listActiveSkuUomsByBarcodes(
      tx,
      actor.tenantId,
      plan.skuUomsToWrite.map((u) => u.barcode).filter((b): b is string => b !== null),
    )

    if (concurrentProds.length > 0 || concurrentSkus.length > 0) {
      throw new AppError('VALIDATION_FAILED', 'Data changed since preview; please run preview again')
    }
    const plannedBarcodeOwner = new Map(
      plan.skuUomsToWrite.filter((u) => u.barcode !== null).map((u) => [u.barcode!, u.skuId]),
    )
    for (const bcRow of concurrentBarcodes) {
      const targetSkuId = bcRow.barcode ? plannedBarcodeOwner.get(bcRow.barcode) : undefined
      if (targetSkuId && bcRow.skuId !== targetSkuId) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Data changed since preview (barcode conflict); please run preview again',
        )
      }
    }

    const { version: nextVersion } = await writeMaster(
      tx,
      { actorUserId: actor.appUserId },
      async (w) => {
        const rootCats = plan.categoriesToWrite.filter((c) => c.parentId === null)
        const childCats = plan.categoriesToWrite.filter((c) => c.parentId !== null)
        if (rootCats.length > 0) {
          await upsertCategoryBatch(
            tx,
            w,
            rootCats.map((c) => ({ ...c, nowIso })),
          )
        }
        if (childCats.length > 0) {
          await upsertCategoryBatch(
            tx,
            w,
            childCats.map((c) => ({ ...c, nowIso })),
          )
        }

        if (plan.productsToWrite.length > 0) {
          await upsertProductBatch(
            tx,
            w,
            plan.productsToWrite.map((p) => ({ ...p, nowIso })),
          )
        }

        if (plan.attributesToCreate.length > 0) {
          await insertProductAttributeBatch(
            tx,
            w.tenantId,
            w.actorUserId,
            plan.attributesToCreate.map((a) => ({ ...a, nowIso })),
          )
        }
        if (plan.attributeValuesToCreate.length > 0) {
          await insertAttributeValueBatch(
            tx,
            w.tenantId,
            w.actorUserId,
            plan.attributeValuesToCreate.map((v) => ({ ...v, nowIso })),
          )
        }

        if (plan.skusToWrite.length > 0) {
          await upsertSkuBatch(
            tx,
            w,
            plan.skusToWrite.map((s) => ({ ...s, nowIso })),
          )
        }

        if (plan.skuAttributeLinksToCreate.length > 0) {
          await insertSkuAttributeValueBatch(
            tx,
            w.tenantId,
            w.actorUserId,
            plan.skuAttributeLinksToCreate.map((l) => ({ ...l, nowIso })),
          )
        }

        if (plan.skuUomsToWrite.length > 0) {
          await upsertSkuUomBatch(
            tx,
            w,
            plan.skuUomsToWrite.map((u) => ({ ...u, nowIso })),
          )
        }

        if (plan.pricesToWrite.length > 0) {
          await upsertPriceEntryBatch(
            tx,
            w,
            plan.pricesToWrite.map((p) => ({ ...p, nowIso })),
          )
        }

        if (plan.newProductIds.length > 0 && plan.activeOutletIds.length > 0) {
          await insertDefaultAvailabilityForProductsBatch(
            tx,
            w,
            plan.newProductIds,
            plan.activeOutletIds,
            nowIso,
          )
        }
      },
    )

    log.info(
      {
        tenantId: actor.tenantId,
        userId: actor.appUserId,
        fn: 'commitCatalogImport',
        label: plan.fileName,
        rowCount: plan.productsToWrite.length + plan.skusToWrite.length,
      },
      'Committed bulk catalog CSV import',
    )

    return nextVersion
  })

  return { version, versionBumped: true, created, updated, unchanged }
}
