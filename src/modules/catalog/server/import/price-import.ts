import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import {
  newIdFrom,
  nowIsoFrom,
  requireCatalogPermission,
  type CatalogActor,
  type CatalogServiceDeps,
} from '../auth'
import { listActiveOutletsWithCodes } from '../availability.repo'
import { CsvImportError, parseCsv } from '../csv/parse-csv'
import { listActivePriceEntriesBySkuIds, upsertPriceEntryBatch } from '../price.repo'
import { listSkuUomsBySkuIds } from '../sku-uom.repo'
import { listUoms } from '../uom.repo'
import { listSkusByCodes } from '../variant.repo'
import { createErrorCollector } from './catalog-csv'
import { consumeImportPlan, storeImportPlan } from './plan-cache'
import type { CommitImportResult, ImportReport } from './types'

type PriceCsvCol = 'kode_sku' | 'uom' | 'outlet' | 'harga'

const PRICE_CSV_ALIASES: Readonly<Record<string, PriceCsvCol>> = {
  kode_sku: 'kode_sku',
  sku_code: 'kode_sku',
  uom: 'uom',
  outlet: 'outlet',
  outlet_code: 'outlet',
  harga: 'harga',
  price: 'harga',
}

const INTEGER_RE = /^-?\d+$/

interface ValidatedPriceRow {
  rowNumber: number
  skuCode: string
  uomCode: string
  outletCode: string | null
  price: number
}

interface PriceImportPlan {
  kind: 'price'
  fileName: string
  entriesToWrite: Array<{
    id: string
    skuId: string
    uomId: string
    outletId: string | null
    price: number
    currency: 'IDR'
  }>
  summary: {
    price_entry: { create: number; update: number; unchanged: number }
  }
}

export async function previewPriceImport(
  actor: CatalogActor,
  csvText: string,
  fileName: string,
  deps?: CatalogServiceDeps,
): Promise<ImportReport> {
  requireCatalogPermission(actor)

  let parsed: ReturnType<typeof parseCsv<PriceCsvCol>>
  try {
    parsed = parseCsv<PriceCsvCol>(csvText, {
      aliases: PRICE_CSV_ALIASES,
      requiredColumns: ['kode_sku', 'uom', 'harga'],
    })
  } catch (err) {
    if (err instanceof CsvImportError) {
      throw new AppError('VALIDATION_FAILED', `${err.code}: ${err.message}`)
    }
    throw err
  }

  const col = createErrorCollector()
  const rows: ValidatedPriceRow[] = []

  for (const rawRow of parsed.rows) {
    const c = rawRow.cells
    const rn = rawRow.rowNumber
    let ok = true

    const skuCode = c.kode_sku?.trim() ?? ''
    if (!skuCode) {
      col.push(rn, 'kode_sku', 'REQUIRED', 'import.error.required')
      ok = false
    }

    const uomCode = (c.uom?.trim() ?? '').toLowerCase()
    if (!uomCode) {
      col.push(rn, 'uom', 'REQUIRED', 'import.error.required')
      ok = false
    }

    const rawOutlet = c.outlet?.trim() ?? ''
    const outletCode = rawOutlet.length > 0 ? rawOutlet : null

    const rawPrice = c.harga?.trim() ?? ''
    let price = 0
    if (!rawPrice) {
      col.push(rn, 'harga', 'REQUIRED', 'import.error.required')
      ok = false
    } else if (!INTEGER_RE.test(rawPrice)) {
      col.push(rn, 'harga', 'INVALID_FORMAT', 'import.error.invalidFormat')
      ok = false
    } else {
      price = Number(rawPrice)
      if (!Number.isSafeInteger(price) || price < 0) {
        col.push(rn, 'harga', 'PRICE_RANGE', 'import.error.priceRange')
        ok = false
      }
    }

    if (ok) {
      rows.push({ rowNumber: rn, skuCode, uomCode, outletCode, price })
    }
  }

  const skuCodes = Array.from(new Set(rows.map((r) => r.skuCode)))
  const dbState = await withTenantReadOnly(actor.tenantId, async (tx) => {
    const skus = await listSkusByCodes(tx, actor.tenantId, skuCodes)
    const uoms = await listUoms(tx, actor.tenantId)
    const outlets = await listActiveOutletsWithCodes(tx, actor.tenantId)
    const skuIds = skus.map((s) => s.id)
    const skuUoms = await listSkuUomsBySkuIds(tx, actor.tenantId, skuIds)
    const prices = await listActivePriceEntriesBySkuIds(tx, actor.tenantId, skuIds)
    return { skus, uoms, outlets, skuUoms, prices }
  })

  const skuByCode = new Map(dbState.skus.map((s) => [s.skuCode, s]))
  const uomByCode = new Map(dbState.uoms.map((u) => [u.code.toLowerCase(), u]))
  const outletByCode = new Map(dbState.outlets.map((o) => [o.code.toLowerCase(), o]))
  const skuUomSet = new Set(dbState.skuUoms.map((su) => `${su.skuId}:${su.uomId}`))
  const priceByKey = new Map(
    dbState.prices.map((p) => [`${p.skuId}:${p.uomId}:${p.outletId ?? 'NULL'}`, p]),
  )

  const dedupedByKey = new Map<string, { skuId: string; uomId: string; outletId: string | null; price: number }>()

  for (const row of rows) {
    const skuRow = skuByCode.get(row.skuCode)
    if (!skuRow) {
      col.push(row.rowNumber, 'kode_sku', 'UNKNOWN_SKU', 'import.error.unknownSku')
      continue
    }

    const uomRow = uomByCode.get(row.uomCode)
    if (!uomRow || !skuUomSet.has(`${skuRow.id}:${uomRow.id}`)) {
      col.push(row.rowNumber, 'uom', 'UNKNOWN_UOM', 'import.error.unknownUom')
      continue
    }

    let outletId: string | null = null
    if (row.outletCode !== null) {
      const outRow = outletByCode.get(row.outletCode.toLowerCase())
      if (!outRow) {
        col.push(row.rowNumber, 'outlet', 'UNKNOWN_OUTLET', 'import.error.unknownOutlet')
        continue
      }
      outletId = outRow.id
      if (actor.outletIds !== null && (!Array.isArray(actor.outletIds) || !actor.outletIds.includes(outletId))) {
        col.push(row.rowNumber, 'outlet', 'OUTLET_OUT_OF_SCOPE', 'import.error.outletOutOfScope')
        continue
      }
    } else if (actor.outletIds !== null) {
      col.push(row.rowNumber, 'outlet', 'OUTLET_OUT_OF_SCOPE', 'import.error.outletOutOfScope')
      continue
    }

    const key = `${skuRow.id}:${uomRow.id}:${outletId ?? 'NULL'}`
    dedupedByKey.set(key, { skuId: skuRow.id, uomId: uomRow.id, outletId, price: row.price })
  }

  const summary = { price_entry: { create: 0, update: 0, unchanged: 0 } }
  const entriesToWrite: PriceImportPlan['entriesToWrite'] = []

  for (const [key, entry] of dedupedByKey) {
    const existing = priceByKey.get(key)
    if (!existing) {
      summary.price_entry.create += 1
      entriesToWrite.push({
        id: newIdFrom(deps),
        skuId: entry.skuId,
        uomId: entry.uomId,
        outletId: entry.outletId,
        price: entry.price,
        currency: 'IDR',
      })
    } else if (existing.price !== entry.price) {
      summary.price_entry.update += 1
      entriesToWrite.push({
        id: existing.id,
        skuId: entry.skuId,
        uomId: entry.uomId,
        outletId: entry.outletId,
        price: entry.price,
        currency: 'IDR',
      })
    } else {
      summary.price_entry.unchanged += 1
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
  storeImportPlan<PriceImportPlan>({
    token,
    tenantId: actor.tenantId,
    userId: actor.appUserId,
    kind: 'price',
    plan: { kind: 'price', fileName, entriesToWrite, summary },
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

export async function commitPriceImport(
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
  const plan = consumeImportPlan<PriceImportPlan>({
    token: tokenRes.data,
    tenantId: actor.tenantId,
    userId: actor.appUserId,
    kind: 'price',
    nowMs: Date.parse(nowIso),
  })

  const created = { price_entry: plan.summary.price_entry.create }
  const updated = { price_entry: plan.summary.price_entry.update }
  const unchanged = { price_entry: plan.summary.price_entry.unchanged }

  if (plan.entriesToWrite.length === 0) {
    return { version: null, versionBumped: false, created, updated, unchanged }
  }

  const version = await withTenant(actor.tenantId, async (tx) => {
    const skuIds = Array.from(new Set(plan.entriesToWrite.map((e) => e.skuId)))
    const skuUoms = await listSkuUomsBySkuIds(tx, actor.tenantId, skuIds)
    const skuUomSet = new Set(skuUoms.map((su) => `${su.skuId}:${su.uomId}`))
    for (const item of plan.entriesToWrite) {
      if (!skuUomSet.has(`${item.skuId}:${item.uomId}`)) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Data changed since preview (missing SKU-UOM); please run preview again',
        )
      }
    }

    const { version: nextVersion } = await writeMaster(
      tx,
      { actorUserId: actor.appUserId },
      (w) =>
        upsertPriceEntryBatch(
          tx,
          w,
          plan.entriesToWrite.map((e) => ({ ...e, nowIso })),
        ),
    )

    await appendAudit(
      tx,
      {
        action: 'price.changed',
        entityType: 'price_entry',
        entityId: null,
        outletId: null,
        beforeData: null,
        afterData: {
          source: 'csv_import',
          fileName: plan.fileName,
          counts: plan.summary.price_entry,
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
