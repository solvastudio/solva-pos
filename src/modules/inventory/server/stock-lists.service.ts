import '@tanstack/react-start/server-only'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { isUuid, normalizeQty, parseQty, subQty } from '~/lib/kernel'
import { requireActorPermission, type IdentityAuthActor } from '~/modules/identity/public'
import { AppError } from '~/server/error-classify'
import { withTenant } from '~/server/db'
import {
  stocktake as stocktakeTable,
  stocktakeLine as stocktakeLineTable,
  transfer as transferTable,
  transferLine as transferLineTable,
} from './schema'

/** Read-only data for admin page SCR-A06 (transfer list, stocktake, and stocktake line details). */

export interface TransferListRow {
  readonly id: string
  readonly docNo: string
  readonly status: string
  readonly fromOutletId: string
  readonly toOutletId: string
  readonly businessDate: string
}

export async function listTransfers(actor: IdentityAuthActor, filter: { outletId?: string } = {}): Promise<TransferListRow[]> {
  requireActorPermission(actor, 'inventory.manage')
  return withTenant(actor.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: transferTable.id,
        docNo: transferTable.docNo,
        status: transferTable.status,
        fromOutletId: transferTable.outletId,
        toOutletId: transferTable.toOutletId,
        businessDate: transferTable.businessDate,
      })
      .from(transferTable)
      .where(
        filter.outletId
          ? sql`(${transferTable.outletId} = ${filter.outletId}::uuid OR ${transferTable.toOutletId} = ${filter.outletId}::uuid)`
          : sql`true`,
      )
      .orderBy(desc(transferTable.businessDate), asc(transferTable.docNo))
      .limit(200)
    return rows
  })
}

export interface StocktakeListRow {
  readonly id: string
  readonly docNo: string
  readonly status: string
  readonly outletId: string
  readonly scope: string
  readonly businessDate: string
  readonly postedAt: string | null
}

export async function listStocktakes(actor: IdentityAuthActor, filter: { outletId?: string } = {}): Promise<StocktakeListRow[]> {
  requireActorPermission(actor, 'inventory.manage')
  return withTenant(actor.tenantId, async (tx) => {
    const base = tx
      .select({
        id: stocktakeTable.id,
        docNo: stocktakeTable.docNo,
        status: stocktakeTable.status,
        outletId: stocktakeTable.outletId,
        scope: stocktakeTable.scope,
        businessDate: stocktakeTable.businessDate,
        postedAt: stocktakeTable.postedAt,
      })
      .from(stocktakeTable)
    const rows = filter.outletId
      ? await base.where(eq(stocktakeTable.outletId, filter.outletId)).orderBy(desc(stocktakeTable.businessDate)).limit(200)
      : await base.orderBy(desc(stocktakeTable.businessDate)).limit(200)
    return rows
  })
}

export interface StocktakeLineView {
  readonly lineId: string
  readonly skuId: string
  readonly snapshotQty: string
  readonly countedQty: string | null
  /** Count difference (counted − snapshot) once counted; `null` until then. */
  readonly deltaQty: string | null
  readonly deltaValue: number | null
}

export interface StocktakeDetail {
  readonly id: string
  readonly docNo: string
  readonly status: string
  readonly outletId: string
  readonly lines: readonly StocktakeLineView[]
}

export async function getStocktake(actor: IdentityAuthActor, id: string): Promise<StocktakeDetail> {
  requireActorPermission(actor, 'inventory.manage')
  if (!isUuid(id)) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.stocktakeNotFound')
  return withTenant(actor.tenantId, async (tx) => {
    const [head] = await tx
      .select({ id: stocktakeTable.id, docNo: stocktakeTable.docNo, status: stocktakeTable.status, outletId: stocktakeTable.outletId })
      .from(stocktakeTable)
      .where(eq(stocktakeTable.id, id))
    if (!head) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.stocktakeNotFound')
    const lines = await tx
      .select({
        lineId: stocktakeLineTable.id,
        skuId: stocktakeLineTable.skuId,
        snapshotQty: stocktakeLineTable.snapshotQty,
        countedQty: stocktakeLineTable.countedQty,
        deltaValue: stocktakeLineTable.deltaValue,
      })
      .from(stocktakeLineTable)
      .where(eq(stocktakeLineTable.stocktakeId, id))
      .orderBy(asc(stocktakeLineTable.id))
    return {
      id: head.id,
      docNo: head.docNo,
      status: head.status,
      outletId: head.outletId,
      lines: lines.map((l) => {
        const snapshot = parseQty(String(l.snapshotQty))
        const counted = l.countedQty === null ? null : parseQty(String(l.countedQty))
        return {
          lineId: l.lineId,
          skuId: l.skuId,
          snapshotQty: normalizeQty(snapshot),
          countedQty: counted === null ? null : normalizeQty(counted),
          deltaQty: counted === null ? null : normalizeQty(subQty(counted, snapshot)),
          deltaValue: l.deltaValue === null || l.deltaValue === undefined ? null : Number(l.deltaValue),
        }
      }),
    }
  })
}

export interface TransferLineView {
  readonly lineId: string
  readonly skuId: string
  readonly qtySentBase: string
  readonly valueSent: number
  readonly qtyReceivedBase: string | null
}

export interface TransferDetail {
  readonly id: string
  readonly docNo: string
  readonly status: string
  readonly fromOutletId: string
  readonly toOutletId: string
  readonly lines: readonly TransferLineView[]
}

/** Transfer details with its lines (for the receipt form). */
export async function getTransfer(actor: IdentityAuthActor, id: string): Promise<TransferDetail> {
  requireActorPermission(actor, 'inventory.manage')
  if (!isUuid(id)) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.transferNotFound')
  return withTenant(actor.tenantId, async (tx) => {
    const [head] = await tx
      .select({
        id: transferTable.id,
        docNo: transferTable.docNo,
        status: transferTable.status,
        fromOutletId: transferTable.outletId,
        toOutletId: transferTable.toOutletId,
      })
      .from(transferTable)
      .where(eq(transferTable.id, id))
    if (!head) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.transferNotFound')
    const lines = await tx
      .select({
        lineId: transferLineTable.id,
        skuId: transferLineTable.skuId,
        qtySentBase: transferLineTable.qtySentBase,
        valueSent: transferLineTable.valueSent,
        qtyReceivedBase: transferLineTable.qtyReceivedBase,
      })
      .from(transferLineTable)
      .where(eq(transferLineTable.transferId, id))
      .orderBy(asc(transferLineTable.id))
    return {
      ...head,
      lines: lines.map((l) => ({
        lineId: l.lineId,
        skuId: l.skuId,
        qtySentBase: normalizeQty(parseQty(String(l.qtySentBase))),
        valueSent: Number(l.valueSent),
        qtyReceivedBase: l.qtyReceivedBase === null ? null : normalizeQty(parseQty(String(l.qtyReceivedBase))),
      })),
    }
  })
}
