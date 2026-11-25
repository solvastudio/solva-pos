import '@tanstack/react-start/server-only'
import { and, eq, sql } from 'drizzle-orm'
import { createIdGenerator, isUuid, mulQty, parseQty, proRate, subMoney, subQty, toMoney, type Money, type Qty } from '~/lib/kernel'
import { requireActorPermission, type IdentityAuthActor } from '~/modules/identity/public'
import { AppError } from '~/server/error-classify'
import { withTenant, type TenantTx } from '~/server/db'
import { auditInventoryEvent } from './audit'
import { applyMovements, type MovementIntent } from './ledger.service'
import { draftDocNo, nextDocNo } from './doc-no'
import { transfer as transferTable, transferLine as transferLineTable } from './schema'
import { loadInventoryEnabledAt } from './sale-stock.repo'
import { createStockMinusFlags, createTransferVarianceFlag, resolveStockMinus } from './stock-flags.service'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    globalThis.crypto.getRandomValues(b)
    return b[0]!
  },
})

export interface TransferLineInput {
  readonly skuId: string
  readonly uomId: string
  readonly qtyInput: string
}

export interface TransferDraftInput {
  readonly id?: string
  readonly fromOutletId: string
  readonly toOutletId: string
  readonly businessDate: string
  readonly note?: string | null
  readonly lines: readonly TransferLineInput[]
}

interface TransferHead {
  readonly id: string
  readonly fromOutletId: string
  readonly toOutletId: string
  readonly status: string
  readonly docNo: string
  readonly businessDate: string
}

interface TransferLineRow {
  readonly id: string
  readonly lineNo: number
  readonly skuId: string
  readonly qtySentBase: Qty
  readonly valueSent: Money | null
}

async function lockTransfer(tx: TenantTx, tenantId: string, id: string): Promise<TransferHead> {
  const res = await tx.execute<{
    id: string
    outlet_id: string
    to_outlet_id: string
    status: string
    doc_no: string
    business_date: string
  }>(sql`
    SELECT id, outlet_id, to_outlet_id, status, doc_no, business_date::text AS business_date
    FROM transfer WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
    FOR UPDATE
  `)
  const r = res.rows[0]
  if (!r) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.transferNotFound')
  return {
    id: r.id,
    fromOutletId: r.outlet_id,
    toOutletId: r.to_outlet_id,
    status: r.status,
    docNo: r.doc_no,
    businessDate: r.business_date,
  }
}

async function loadTransferLines(tx: TenantTx, tenantId: string, transferId: string): Promise<TransferLineRow[]> {
  const rows = await tx
    .select({
      id: transferLineTable.id,
      lineNo: transferLineTable.lineNo,
      skuId: transferLineTable.skuId,
      qtySentBase: transferLineTable.qtySentBase,
      valueSent: transferLineTable.valueSent,
    })
    .from(transferLineTable)
    .where(and(eq(transferLineTable.tenantId, tenantId), eq(transferLineTable.transferId, transferId)))
    .orderBy(transferLineTable.lineNo)
  return rows.map((r) => ({
    id: r.id,
    lineNo: r.lineNo,
    skuId: r.skuId,
    qtySentBase: parseQty(r.qtySentBase),
    valueSent: r.valueSent === null ? null : toMoney(r.valueSent),
  }))
}

/** Saves a transfer draft (DRAFT only). Source outlet = document outlet; destination must differ (CHK). */
export async function saveTransferDraft(
  actor: IdentityAuthActor,
  input: TransferDraftInput,
): Promise<{ id: string; docNo: string }> {
  requireActorPermission(actor, 'inventory.manage', { outletId: input.fromOutletId })
  if (input.fromOutletId === input.toOutletId) {
    throw new AppError('VALIDATION_FAILED', 'admin.stock.err.transferSameOutlet')
  }
  if (input.lines.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'admin.stock.err.transferNeedsLine')
  }
  return withTenant(actor.tenantId, async (tx) => {
    const pairs = input.lines.map((l) => ({ skuId: l.skuId, uomId: l.uomId }))
    const uomRes = await tx.execute<{ sku_id: string; uom_id: string; conversion_factor: string }>(sql`
      SELECT sku_id, uom_id, conversion_factor::text AS conversion_factor FROM sku_uom
      WHERE tenant_id = ${actor.tenantId}::uuid
        AND (sku_id, uom_id) IN (${sql.join(pairs.map((p) => sql`(${p.skuId}::uuid, ${p.uomId}::uuid)`), sql`, `)})
    `)
    const factorByKey = new Map(uomRes.rows.map((r) => [`${r.sku_id}|${r.uom_id}`, r.conversion_factor]))
    const lines = input.lines.map((l, i) => {
      if (!isUuid(l.skuId) || !isUuid(l.uomId)) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.skuUomInvalid')
      const qtyInput = parseQty(l.qtyInput)
      if (Number(qtyInput) <= 0) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.qtyPositive')
      const factorRaw = factorByKey.get(`${l.skuId}|${l.uomId}`)
      if (!factorRaw) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.uomNotOfSku')
      const factor = parseQty(factorRaw)
      return {
        lineNo: i + 1,
        skuId: l.skuId,
        uomId: l.uomId,
        qtyInput,
        factor,
        qtySentBase: mulQty(qtyInput, factor),
      }
    })

    let id = input.id
    let docNo: string
    if (id) {
      const cur = await lockTransfer(tx, actor.tenantId, id)
      if (cur.status !== 'DRAFT') throw new AppError('VALIDATION_FAILED', 'admin.stock.err.transferSentLocked')
      docNo = cur.docNo
      await tx.delete(transferLineTable).where(and(eq(transferLineTable.tenantId, actor.tenantId), eq(transferLineTable.transferId, id)))
      await tx
        .update(transferTable)
        .set({ toOutletId: input.toOutletId, businessDate: input.businessDate, note: input.note ?? null, updatedAt: new Date().toISOString() })
        .where(and(eq(transferTable.tenantId, actor.tenantId), eq(transferTable.id, id)))
    } else {
      id = idGen.newId()
      docNo = draftDocNo()
      await tx.insert(transferTable).values({
        id,
        tenantId: actor.tenantId,
        outletId: input.fromOutletId,
        docNo,
        status: 'DRAFT',
        businessDate: input.businessDate,
        createdBy: actor.appUserId,
        toOutletId: input.toOutletId,
        note: input.note ?? null,
      })
    }
    await tx.insert(transferLineTable).values(
      lines.map((l) => ({
        id: idGen.newId(),
        tenantId: actor.tenantId,
        transferId: id!,
        lineNo: l.lineNo,
        skuId: l.skuId,
        uomId: l.uomId,
        qtyInput: l.qtyInput,
        conversionFactor: l.factor,
        qtySentBase: l.qtySentBase,
      })),
    )
    return { id: id!, docNo }
  })
}

export async function cancelTransferDraft(actor: IdentityAuthActor, id: string): Promise<void> {
  return withTenant(actor.tenantId, async (tx) => {
    const cur = await lockTransfer(tx, actor.tenantId, id)
    requireActorPermission(actor, 'inventory.manage', { outletId: cur.fromOutletId })
    if (cur.status !== 'DRAFT') {
      throw new AppError('VALIDATION_FAILED', 'admin.stock.err.onlyDraftCancelable')
    }
    await tx
      .update(transferTable)
      .set({ status: 'CANCELED', updatedAt: new Date().toISOString() })
      .where(and(eq(transferTable.tenantId, actor.tenantId), eq(transferTable.id, id)))
  })
}

/**
 * Sends a transfer (DRAFT → SENT, FLOW-12): leaves the source outlet (TRANSFER_OUT) at the source's average cost;
 * `value_sent` is stored. The goods are in transit (view v_in_transit), not in any outlet balance.
 */
export async function sendTransfer(actor: IdentityAuthActor, id: string): Promise<{ docNo: string }> {
  return withTenant(actor.tenantId, async (tx) => {
    const cur = await lockTransfer(tx, actor.tenantId, id)
    requireActorPermission(actor, 'inventory.manage', { outletId: cur.fromOutletId })
    if (cur.status !== 'DRAFT') {
      throw new AppError('VALIDATION_FAILED', 'admin.stock.err.transferSentOrCanceled')
    }
    const enabledAt = await loadInventoryEnabledAt(tx, actor.tenantId, cur.fromOutletId)
    if (!enabledAt) throw new AppError('VALIDATION_FAILED', 'admin.stock.trackingNotEnabled')

    const lines = await loadTransferLines(tx, actor.tenantId, id)
    if (lines.length === 0) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.emptyTransfer')
    const docNo = await nextDocNo(tx, {
      tenantId: actor.tenantId,
      outletId: cur.fromOutletId,
      kind: 'TRF',
      businessDate: cur.businessDate,
    })
    const nowIso = new Date().toISOString()
    const intents: MovementIntent[] = lines.map((l) => ({
      outletId: cur.fromOutletId,
      skuId: l.skuId,
      kind: 'OUT',
      qty: l.qtySentBase,
      movementType: 'TRANSFER_OUT',
      sourceType: 'TRANSFER_LINE',
      sourceId: l.id,
      occurredAt: nowIso,
      businessDate: cur.businessDate,
      order: l.lineNo,
    }))
    const applied = await applyMovements(tx, { tenantId: actor.tenantId, actorId: actor.appUserId, processedAt: nowIso }, intents)

    await createStockMinusFlags(tx, {
      tenantId: actor.tenantId,
      outletId: cur.fromOutletId,
      businessDate: cur.businessDate,
      applied: applied.applied,
    })
    const valueBySource = new Map(applied.applied.map((a) => [a.sourceId, toMoney(-a.valueDelta)]))
    for (const l of lines) {
      await tx.execute(sql`
        UPDATE transfer_line SET value_sent = ${valueBySource.get(l.id) ?? 0}::bigint
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${l.id}::uuid
      `)
    }
    await tx
      .update(transferTable)
      .set({ status: 'SENT', sentAt: nowIso, sentBy: actor.appUserId, docNo, updatedAt: nowIso })
      .where(and(eq(transferTable.tenantId, actor.tenantId), eq(transferTable.id, id)))

    await resolveStockMinus(tx, {
      tenantId: actor.tenantId,
      outletId: cur.fromOutletId,
      skuIds: [],
    })
    await auditInventoryEvent(tx, {
      action: 'transfer.sent',
      entityType: 'transfer',
      entityId: id,
      outletId: cur.fromOutletId,
      actorUserId: actor.appUserId,
      afterData: { doc_no: docNo, to_outlet_id: cur.toOutletId, line_count: lines.length },
    })
    return { docNo }
  })
}

export interface ReceiveLineInput {
  readonly lineId: string
  readonly qtyReceivedBase: string
}

/**
 * Receives a transfer (SENT → RECEIVED, once, BR-TRF-003/004): the received value is proportional:
 * `R(value_sent × qty_received / qty_sent)`; qty and value differences are recorded and, if any, flagged SELISIH_TRANSFER.
 * A receipt of 0 for all lines requires a close reason.
 */
export async function receiveTransfer(
  actor: IdentityAuthActor,
  id: string,
  input: { lines: readonly ReceiveLineInput[]; closeReasonCode?: string | null; closeReasonText?: string | null },
): Promise<{ docNo: string; valueVariance: number }> {
  return withTenant(actor.tenantId, async (tx) => {
    const cur = await lockTransfer(tx, actor.tenantId, id)
    requireActorPermission(actor, 'inventory.manage', { outletId: cur.toOutletId })
    if (cur.status !== 'SENT') {
      throw new AppError('VALIDATION_FAILED', 'admin.stock.err.transferNotReceivable')
    }
    const enabledAt = await loadInventoryEnabledAt(tx, actor.tenantId, cur.toOutletId)
    if (!enabledAt) throw new AppError('VALIDATION_FAILED', 'admin.stock.trackingNotEnabled')

    const lines = await loadTransferLines(tx, actor.tenantId, id)
    const byId = new Map(input.lines.map((l) => [l.lineId, parseQty(l.qtyReceivedBase)]))
    if (byId.size !== lines.length) {
      throw new AppError('VALIDATION_FAILED', 'admin.stock.err.receiveQtyEveryLine')
    }

    const computed = lines.map((l) => {
      const received = byId.get(l.id)
      if (received === undefined) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.transferLineUnknown')
      if (Number(received) < 0 || Number(received) > Number(l.qtySentBase)) {
        throw new AppError('VALIDATION_FAILED', 'admin.stock.err.receiveExceedsSent')
      }
      const valueSent = l.valueSent ?? toMoney(0)
      const valueReceived: Money = Number(received) === 0 ? toMoney(0) : proRate(valueSent, received, l.qtySentBase)
      return {
        ...l,
        received,
        valueReceived,
        qtyVariance: subQty(l.qtySentBase, received),
        valueVariance: subMoney(valueSent, valueReceived),
      }
    })

    const allZero = computed.every((c) => Number(c.received) === 0)
    if (allZero && (!input.closeReasonCode || !input.closeReasonText || input.closeReasonText.trim().length === 0)) {
      throw new AppError('VALIDATION_FAILED', 'admin.stock.err.closeReasonRequired')
    }

    const nowIso = new Date().toISOString()
    const intents: MovementIntent[] = computed
      .filter((c) => Number(c.received) > 0)
      .map((c) => ({
        outletId: cur.toOutletId,
        skuId: c.skuId,
        kind: 'IN',
        qty: c.received,
        valueIn: c.valueReceived,
        costBasisHint: 'TRANSFER',
        movementType: 'TRANSFER_IN',
        sourceType: 'TRANSFER_LINE',
        sourceId: c.id,
        occurredAt: nowIso,
        businessDate: cur.businessDate,
        order: c.lineNo,
      }))
    if (intents.length > 0) {
      await applyMovements(tx, { tenantId: actor.tenantId, actorId: actor.appUserId, processedAt: nowIso }, intents)
    }

    for (const c of computed) {
      await tx.execute(sql`
        UPDATE transfer_line
        SET qty_received_base = ${c.received}::numeric, value_received = ${c.valueReceived}::bigint,
            qty_variance_base = ${c.qtyVariance}::numeric, value_variance = ${c.valueVariance}::bigint
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${c.id}::uuid
      `)
      if (Number(c.qtyVariance) !== 0 || c.valueVariance !== 0) {
        await createTransferVarianceFlag(tx, {
          tenantId: actor.tenantId,
          outletId: cur.toOutletId,
          businessDate: cur.businessDate,
          transferLineId: c.id,
          valueVariance: c.valueVariance,
          qtyVariance: c.qtyVariance,
        })
      }
    }

    const totalVariance = computed.reduce((acc, c) => acc + c.valueVariance, 0)
    await tx
      .update(transferTable)
      .set({
        status: 'RECEIVED',
        receivedAt: nowIso,
        receivedBy: actor.appUserId,
        closeReasonCode: allZero ? (input.closeReasonCode ?? null) : null,
        closeReasonText: allZero ? (input.closeReasonText ?? null) : null,
        updatedAt: nowIso,
      })
      .where(and(eq(transferTable.tenantId, actor.tenantId), eq(transferTable.id, id)))

    await resolveStockMinus(tx, {
      tenantId: actor.tenantId,
      outletId: cur.toOutletId,
      skuIds: computed.filter((c) => Number(c.received) > 0).map((c) => c.skuId),
    })
    await auditInventoryEvent(tx, {
      action: 'transfer.received',
      entityType: 'transfer',
      entityId: id,
      outletId: cur.toOutletId,
      actorUserId: actor.appUserId,
      reasonText: allZero ? (input.closeReasonText ?? null) : null,
      afterData: { doc_no: cur.docNo, value_variance: totalVariance },
    })
    return { docNo: cur.docNo, valueVariance: totalVariance }
  })
}
