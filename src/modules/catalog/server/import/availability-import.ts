import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import type { AvailabilityStatus } from '../../shared'
import {
  newIdFrom,
  nowIsoFrom,
  requireCatalogPermission,
  type CatalogActor,
  type CatalogServiceDeps,
} from '../auth'
import {
  listActiveOutletsWithCodes,
  listAvailabilityByProductIds,
  upsertAvailabilityBatch,
} from '../availability.repo'
import { CsvImportError, parseCsv } from '../csv/parse-csv'
import { listProductsByCodes } from '../product.repo'
import { listSkusByCodes } from '../variant.repo'
import { createErrorCollector } from './catalog-import'
import { consumeImportPlan, storeImportPlan } from './plan-cache'
import type { CommitImportResult, ImportReport } from './types'

type AvailCsvCol = 'kode_produk' | 'outlet' | 'status' | 'kode_sku'

const AVAIL_CSV_ALIASES: Readonly<Record<string, AvailCsvCol>> = {
  kode_produk: 'kode_produk',
  product_code: 'kode_produk',
  outlet: 'outlet',
  outlet_code: 'outlet',
  status: 'status',
  kode_sku: 'kode_sku',
  sku_code: 'kode_sku',
}

interface ValidatedAvailRow {
  rowNumber: number
  productCode: string
  outletCode: string
  status: AvailabilityStatus
  skuCode: string | null
}

interface AvailabilityImportPlan {
  kind: 'availability'
  fileName: string
  rowsToWrite: Array<{
    id: string
    outletId: string
    productId: string
    skuId: string | null
    status: AvailabilityStatus
  }>
  summary: {
    item_outlet_availability: { create: number; update: number; unchanged: number }
  }
}

export async function previewAvailabilityImport(
  actor: CatalogActor,
  csvText: string,
  fileName: string,
  deps?: CatalogServiceDeps,
): Promise<ImportReport> {
  requireCatalogPermission(actor)

  let parsed: ReturnType<typeof parseCsv<AvailCsvCol>>
  try {
    parsed = parseCsv<AvailCsvCol>(csvText, {
      aliases: AVAIL_CSV_ALIASES,
      requiredColumns: ['kode_produk', 'outlet', 'status'],
    })
  } catch (err) {
    if (err instanceof CsvImportError) {
      throw new AppError('VALIDATION_FAILED', `${err.code}: ${err.message}`)
    }
    throw err
  }

  const col = createErrorCollector()
  const rows: ValidatedAvailRow[] = []

  for (const rawRow of parsed.rows) {
    const c = rawRow.cells
    const rn = rawRow.rowNumber
    let ok = true

    const productCode = c.kode_produk?.trim() ?? ''
    if (!productCode) {
      col.push(rn, 'kode_produk', 'REQUIRED', 'import.error.required')
      ok = false
    }

    const outletCode = c.outlet?.trim() ?? ''
    if (!outletCode) {
      col.push(rn, 'outlet', 'REQUIRED', 'import.error.required')
      ok = false
    }

    const rawStatus = (c.status?.trim() ?? '').toUpperCase()
    if (!rawStatus) {
      col.push(rn, 'status', 'REQUIRED', 'import.error.required')
      ok = false
    } else if (rawStatus !== 'AVAILABLE' && rawStatus !== 'UNAVAILABLE') {
      col.push(rn, 'status', 'INVALID_FORMAT', 'import.error.invalidFormat')
      ok = false
    }

    const rawSku = c.kode_sku?.trim() ?? ''
    const skuCode = rawSku.length > 0 ? rawSku : null

    if (ok) {
      rows.push({
        rowNumber: rn,
        productCode,
        outletCode,
        status: rawStatus as AvailabilityStatus,
        skuCode,
      })
    }
  }

  const productCodes = Array.from(new Set(rows.map((r) => r.productCode)))
  const skuCodes = Array.from(
    new Set(rows.map((r) => r.skuCode).filter((c): c is string => c !== null)),
  )

  const dbState = await withTenantReadOnly(actor.tenantId, async (tx) => {
    const [products, skus, outlets] = await Promise.all([
      listProductsByCodes(tx, actor.tenantId, productCodes),
      listSkusByCodes(tx, actor.tenantId, skuCodes),
      listActiveOutletsWithCodes(tx, actor.tenantId),
    ])
    const existingAvail = await listAvailabilityByProductIds(
      tx,
      actor.tenantId,
      products.map((p) => p.id),
    )
    return { products, skus, outlets, existingAvail }
  })

  const prodByCode = new Map(dbState.products.map((p) => [p.code, p]))
  const skuByCode = new Map(dbState.skus.map((s) => [s.skuCode, s]))
  const outletByCode = new Map(dbState.outlets.map((o) => [o.code.toLowerCase(), o]))
  const existingAvailByKey = new Map(
    dbState.existingAvail.map((a) => [`${a.outletId}:${a.productId}:${a.skuId ?? 'NULL'}`, a]),
  )

  const deduped = new Map<
    string,
    { outletId: string; productId: string; skuId: string | null; status: AvailabilityStatus }
  >()

  for (const row of rows) {
    const prod = prodByCode.get(row.productCode)
    if (!prod) {
      col.push(row.rowNumber, 'kode_produk', 'UNKNOWN_PRODUCT', 'import.error.unknownProduct')
      continue
    }

    const outlet = outletByCode.get(row.outletCode.toLowerCase())
    if (!outlet) {
      col.push(row.rowNumber, 'outlet', 'UNKNOWN_OUTLET', 'import.error.unknownOutlet')
      continue
    }

    if (
      actor.outletIds !== null &&
      (!Array.isArray(actor.outletIds) || !actor.outletIds.includes(outlet.id))
    ) {
      col.push(row.rowNumber, 'outlet', 'OUTLET_OUT_OF_SCOPE', 'import.error.outletOutOfScope')
      continue
    }

    let skuId: string | null = null
    if (row.skuCode !== null) {
      const skuRow = skuByCode.get(row.skuCode)
      if (!skuRow || skuRow.productId !== prod.id) {
        col.push(row.rowNumber, 'kode_sku', 'UNKNOWN_SKU', 'import.error.unknownSku')
        continue
      }
      skuId = skuRow.id
    }

    const key = `${outlet.id}:${prod.id}:${skuId ?? 'NULL'}`
    deduped.set(key, { outletId: outlet.id, productId: prod.id, skuId, status: row.status })
  }

  const summary = { item_outlet_availability: { create: 0, update: 0, unchanged: 0 } }
  const rowsToWrite: AvailabilityImportPlan['rowsToWrite'] = []

  for (const [key, item] of deduped) {
    const existing = existingAvailByKey.get(key)
    if (!existing) {
      summary.item_outlet_availability.create += 1
      rowsToWrite.push({
        id: newIdFrom(deps),
        outletId: item.outletId,
        productId: item.productId,
        skuId: item.skuId,
        status: item.status,
      })
    } else if (existing.status !== item.status) {
      summary.item_outlet_availability.update += 1
      rowsToWrite.push({
        id: existing.id,
        outletId: item.outletId,
        productId: item.productId,
        skuId: item.skuId,
        status: item.status,
      })
    } else {
      summary.item_outlet_availability.unchanged += 1
    }
  }

  if (col.totalErrors > 0) {
    return {
      valid: false,
      warnings: parsed.warnings,
      errors: col.errors,
      totalErrors: col.totalErrors,
      summary,
    }
  }

  const token = newIdFrom(deps)
  storeImportPlan<AvailabilityImportPlan>({
    token,
    tenantId: actor.tenantId,
    userId: actor.appUserId,
    kind: 'availability',
    plan: { kind: 'availability', fileName, rowsToWrite, summary },
    nowMs: Date.parse(nowIsoFrom(deps)),
  })

  return {
    valid: true,
    token,
    warnings: parsed.warnings,
    errors: [],
    totalErrors: 0,
    summary,
  }
}

export async function commitAvailabilityImport(
  actor: CatalogActor,
  rawToken: string,
  deps?: CatalogServiceDeps,
): Promise<CommitImportResult> {
  requireCatalogPermission(actor)
  const tokenRes = z.string().min(1).safeParse(rawToken)
  if (!tokenRes.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid import token')
  }

  const nowIso = nowIsoFrom(deps)
  const plan = consumeImportPlan<AvailabilityImportPlan>({
    token: tokenRes.data,
    tenantId: actor.tenantId,
    userId: actor.appUserId,
    kind: 'availability',
    nowMs: Date.parse(nowIso),
  })

  const created = { item_outlet_availability: plan.summary.item_outlet_availability.create }
  const updated = { item_outlet_availability: plan.summary.item_outlet_availability.update }
  const unchanged = { item_outlet_availability: plan.summary.item_outlet_availability.unchanged }

  if (plan.rowsToWrite.length === 0) {
    return { version: null, versionBumped: false, created, updated, unchanged }
  }

  const version = await withTenant(actor.tenantId, async (tx) => {
    const activeOutlets = await listActiveOutletsWithCodes(tx, actor.tenantId)
    const outletSet = new Set(activeOutlets.map((o) => o.id))
    for (const r of plan.rowsToWrite) {
      if (!outletSet.has(r.outletId)) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Data changed since preview (missing outlet); please run preview again',
        )
      }
    }

    const { version: nextVersion } = await writeMaster(
      tx,
      { actorUserId: actor.appUserId },
      (w) =>
        upsertAvailabilityBatch(
          tx,
          w,
          plan.rowsToWrite.map((r) => ({ ...r, nowIso })),
        ),
    )

    await appendAudit(
      tx,
      {
        action: 'availability.changed',
        entityType: 'item_outlet_availability',
        entityId: null,
        outletId: null,
        beforeData: null,
        afterData: {
          source: 'csv_import',
          fileName: plan.fileName,
          counts: plan.summary.item_outlet_availability,
        },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => newIdFrom(deps), nowIso: () => nowIso },
    )

    return nextVersion
  })

  return { version, versionBumped: true, created, updated, unchanged }
}
