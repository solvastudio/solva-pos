import '@tanstack/react-start/server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { createIdGenerator, isUuid, mulQty, mulRound, parseQty, toMoney, type Money, type Qty } from '~/lib/kernel'
import { requireActorPermission, type IdentityAuthActor } from '~/modules/identity/public'
import { AppError } from '~/server/error-classify'
import { withTenant, type TenantTx } from '~/server/db'
import { applyMovements, type MovementIntent } from './ledger.service'
import { auditInventoryEvent } from './audit'
import { draftDocNo, nextDocNo } from './doc-no'
import { findMovementIdsBySource, loadInventoryEnabledAt } from './sale-stock.repo'
import { createStockMinusFlags, resolveStockMinus } from './stock-flags.service'
import { goodsReceipt as grTable, goodsReceiptLine as grLineTable } from './schema'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    globalThis.crypto.getRandomValues(b)
    return b[0]!
  },
})

export interface GrLineInput {
  readonly skuId: string
  readonly uomId: string
  readonly qty: string
  /** Net cost per receiving UOM (BR-STK-021). Used when `lineValue` is not given. */
  readonly unitCost?: number | null
  /** Typed total line value (preferred when both are given). */
  readonly lineValue?: number | null
}

export interface GrDraftInput {
  readonly id?: string
  readonly outletId: string
  readonly supplierId?: string | null
  readonly supplierRef?: string | null
  readonly businessDate: string
  readonly note?: string | null
  readonly lines: readonly GrLineInput[]
}

export interface GrPostResult {
  readonly id: string
  readonly docNo: string
  readonly totalValue: number
  readonly applied: boolean
}

/** Validates and derives lines: base qty = qty × snapshot factor; value = typed total, or R(qty × cost). */
async function deriveLines(
  tx: TenantTx,
  tenantId: string,
  lines: readonly GrLineInput[],
): Promise<Array<{ skuId: string; uomId: string; qty: Qty; factor: Qty; qtyBase: Qty; unitCost: Money | null; lineValue: Money }>> {
  if (lines.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'Dokumen harus memiliki minimal satu baris')
  }
  const pairs = lines.map((l) => ({ skuId: l.skuId, uomId: l.uomId }))
  const uomRes = await tx.execute<{ sku_id: string; uom_id: string; conversion_factor: string }>(sql`
    SELECT sku_id, uom_id, conversion_factor::text AS conversion_factor
    FROM sku_uom
    WHERE tenant_id = ${tenantId}::uuid
      AND (sku_id, uom_id) IN (${sql.join(
        pairs.map((p) => sql`(${p.skuId}::uuid, ${p.uomId}::uuid)`),
        sql`, `,
      )})
  `)
  const factorByKey = new Map(uomRes.rows.map((r) => [`${r.sku_id}|${r.uom_id}`, r.conversion_factor]))

  return lines.map((l) => {
    if (!isUuid(l.skuId) || !isUuid(l.uomId)) {
      throw new AppError('VALIDATION_FAILED', 'SKU/UOM tidak valid')
    }
    const qty = parseQty(l.qty)
    if (Number(qty) <= 0) {
      throw new AppError('VALIDATION_FAILED', 'Jumlah harus lebih dari nol')
    }
    const factorRaw = factorByKey.get(`${l.skuId}|${l.uomId}`)
    if (!factorRaw) {
      throw new AppError('VALIDATION_FAILED', 'UOM tidak dimiliki SKU ini')
    }
    const factor = parseQty(factorRaw)
    const qtyBase = mulQty(qty, factor)
    const unitCost = l.unitCost === undefined || l.unitCost === null ? null : toMoney(l.unitCost)
    let lineValue: Money
    if (l.lineValue !== undefined && l.lineValue !== null) {
      lineValue = toMoney(l.lineValue)
    } else if (unitCost !== null) {
      lineValue = mulRound(unitCost, qty)
    } else {
      throw new AppError('VALIDATION_FAILED', 'Isi biaya per satuan atau total nilai baris')
    }
    if (lineValue < 0) {
      throw new AppError('VALIDATION_FAILED', 'Nilai baris tidak boleh negatif')
    }
    return { skuId: l.skuId, uomId: l.uomId, qty, factor, qtyBase, unitCost, lineValue }
  })
}

/** Saves or updates a GR draft (DRAFT only). Lines are replaced entirely. */
export async function saveGrDraft(actor: IdentityAuthActor, input: GrDraftInput): Promise<{ id: string; docNo: string }> {
  requireActorPermission(actor, 'inventory.manage', { outletId: input.outletId })
  return withTenant(actor.tenantId, async (tx) => {
    const lines = await deriveLines(tx, actor.tenantId, input.lines)
    const total = lines.reduce((acc, l) => acc + l.lineValue, 0)

    if (input.id) {
      const cur = await lockGr(tx, actor.tenantId, input.id)
      if (cur.status !== 'DRAFT') {
        throw new AppError('VALIDATION_FAILED', 'Dokumen sudah diposting dan tidak dapat diubah')
      }
      await tx.delete(grLineTable).where(and(eq(grLineTable.tenantId, actor.tenantId), eq(grLineTable.goodsReceiptId, input.id)))
      await tx
        .update(grTable)
        .set({
          supplierId: input.supplierId ?? null,
          supplierRef: input.supplierRef ?? null,
          businessDate: input.businessDate,
          note: input.note ?? null,
          totalValue: total,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(grTable.tenantId, actor.tenantId), eq(grTable.id, input.id)))
      await insertLines(tx, actor.tenantId, input.id, lines)
      return { id: input.id, docNo: cur.docNo }
    }

    const id = idGen.newId()
    const docNo = draftDocNo()
    await tx.insert(grTable).values({
      id,
      tenantId: actor.tenantId,
      outletId: input.outletId,
      docNo,
      status: 'DRAFT',
      businessDate: input.businessDate,
      createdBy: actor.appUserId,
      supplierId: input.supplierId ?? null,
      supplierRef: input.supplierRef ?? null,
      note: input.note ?? null,
      totalValue: total,
      docType: 'RECEIPT',
    })
    await insertLines(tx, actor.tenantId, id, lines)
    return { id, docNo }
  })
}

async function insertLines(
  tx: TenantTx,
  tenantId: string,
  grId: string,
  lines: Awaited<ReturnType<typeof deriveLines>>,
): Promise<void> {
  await tx.insert(grLineTable).values(
    lines.map((l, i) => ({
      id: idGen.newId(),
      tenantId,
      goodsReceiptId: grId,
      lineNo: i + 1,
      skuId: l.skuId,
      uomId: l.uomId,
      qty: l.qty,
      conversionFactor: l.factor,
      qtyBase: l.qtyBase,
      unitCost: l.unitCost,
      lineValue: l.lineValue,
    })),
  )
}

async function lockGr(tx: TenantTx, tenantId: string, id: string): Promise<{
  id: string
  outletId: string
  status: string
  docType: string
  docNo: string
  businessDate: string
  reversalOfId: string | null
}> {
  const res = await tx.execute<{
    id: string
    outlet_id: string
    status: string
    doc_type: string
    doc_no: string
    business_date: string
    reversal_of_id: string | null
  }>(sql`
    SELECT id, outlet_id, status, doc_type, doc_no, business_date::text AS business_date, reversal_of_id
    FROM goods_receipt
    WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
    FOR UPDATE
  `)
  const r = res.rows[0]
  if (!r) throw new AppError('VALIDATION_FAILED', 'Dokumen tidak ditemukan')
  return {
    id: r.id,
    outletId: r.outlet_id,
    status: r.status,
    docType: r.doc_type,
    docNo: r.doc_no,
    businessDate: r.business_date,
    reversalOfId: r.reversal_of_id,
  }
}

/**
 * Posts a GR (BR-STK-020/022, FLOW-11): locks the document, assigns the document number, applies GR_IN movements per line through
 * applyMovements, then writes the final audit entry. Idempotent: an already POSTED GR is returned as-is.
 */
export async function postGr(actor: IdentityAuthActor, id: string): Promise<GrPostResult> {
  return withTenant(actor.tenantId, async (tx) => {
    const cur = await lockGr(tx, actor.tenantId, id)
    requireActorPermission(actor, 'inventory.manage', { outletId: cur.outletId })
    if (cur.status === 'POSTED') {
      const row = await tx
        .select({ totalValue: grTable.totalValue })
        .from(grTable)
        .where(and(eq(grTable.tenantId, actor.tenantId), eq(grTable.id, id)))
      return { id, docNo: cur.docNo, totalValue: row[0]!.totalValue, applied: false }
    }
    if (cur.docType !== 'RECEIPT') {
      throw new AppError('VALIDATION_FAILED', 'Hanya penerimaan yang dapat diposting')
    }
    const enabledAt = await loadInventoryEnabledAt(tx, actor.tenantId, cur.outletId)
    if (!enabledAt) {
      throw new AppError('VALIDATION_FAILED', 'admin.stock.trackingNotEnabled')
    }

    const lines = await loadLines(tx, actor.tenantId, id)
    if (lines.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Dokumen kosong tidak dapat diposting')
    }
    const docNo = await nextDocNo(tx, {
      tenantId: actor.tenantId,
      outletId: cur.outletId,
      kind: 'GR',
      businessDate: cur.businessDate,
    })
    const nowIso = new Date().toISOString()
    const intents: MovementIntent[] = lines.map((l) => ({
      outletId: cur.outletId,
      skuId: l.skuId,
      kind: 'IN',
      qty: parseQty(l.qtyBase),
      valueIn: toMoney(l.lineValue),
      costBasisHint: 'DECLARED',
      movementType: 'GR_IN',
      sourceType: 'GR_LINE',
      sourceId: l.id,
      occurredAt: nowIso,
      businessDate: cur.businessDate,
      order: l.lineNo,
    }))
    await applyMovements(tx, { tenantId: actor.tenantId, actorId: actor.appUserId, processedAt: nowIso }, intents)

    const total = lines.reduce((acc, l) => acc + l.lineValue, 0)
    await tx
      .update(grTable)
      .set({ status: 'POSTED', postedAt: nowIso, postedBy: actor.appUserId, docNo, totalValue: total, updatedAt: nowIso })
      .where(and(eq(grTable.tenantId, actor.tenantId), eq(grTable.id, id)))

    await resolveStockMinus(tx, {
      tenantId: actor.tenantId,
      outletId: cur.outletId,
      skuIds: lines.map((l) => l.skuId),
    })
    await auditInventoryEvent(tx, {
      action: 'gr.posted',
      entityType: 'goods_receipt',
      entityId: id,
      outletId: cur.outletId,
      actorUserId: actor.appUserId,
      afterData: { doc_no: docNo, total_value: total, line_count: lines.length },
    })
    return { id, docNo, totalValue: total, applied: true }
  })
}

/**
 * Reverses a GR (BR-STK-022): creates a new REVERSAL document that removes exactly the original GR's value (GR_REVERSAL).
 * The original GR is not changed. Insufficient stock ⇒ negative balance and flag (not rejected).
 */
export async function reverseGr(actor: IdentityAuthActor, id: string, reasonText: string): Promise<{ reversalId: string; docNo: string }> {
  const reason = reasonText.trim()
  if (reason.length === 0 || reason.length > 500) {
    throw new AppError('VALIDATION_FAILED', 'Alasan koreksi wajib diisi (maks 500 karakter)')
  }
  return withTenant(actor.tenantId, async (tx) => {
    const cur = await lockGr(tx, actor.tenantId, id)
    requireActorPermission(actor, 'inventory.manage', { outletId: cur.outletId })
    if (cur.status !== 'POSTED' || cur.docType !== 'RECEIPT') {
      throw new AppError('VALIDATION_FAILED', 'Hanya penerimaan yang sudah diposting dapat dikoreksi')
    }
    const existing = await tx.execute<{ id: string }>(sql`
      SELECT id FROM goods_receipt WHERE tenant_id = ${actor.tenantId}::uuid AND reversal_of_id = ${id}::uuid
    `)
    if (existing.rows.length > 0) {
      throw new AppError('VALIDATION_FAILED', 'Penerimaan ini sudah dikoreksi')
    }

    const origLines = await loadLines(tx, actor.tenantId, id)
    const reversalId = idGen.newId()
    const docNo = await nextDocNo(tx, {
      tenantId: actor.tenantId,
      outletId: cur.outletId,
      kind: 'GR',
      businessDate: cur.businessDate,
    })
    const nowIso = new Date().toISOString()
    const total = origLines.reduce((acc, l) => acc + l.lineValue, 0)

    await tx.insert(grTable).values({
      id: reversalId,
      tenantId: actor.tenantId,
      outletId: cur.outletId,
      docNo,
      status: 'POSTED',
      docType: 'REVERSAL',
      reversalOfId: id,
      businessDate: cur.businessDate,
      createdBy: actor.appUserId,
      postedAt: nowIso,
      postedBy: actor.appUserId,
      note: reason,
      totalValue: total,
    })
    const revLines = origLines.map((l, i) => ({
      id: idGen.newId(),
      tenantId: actor.tenantId,
      goodsReceiptId: reversalId,
      lineNo: i + 1,
      skuId: l.skuId,
      uomId: l.uomId,
      qty: parseQty(l.qty),
      conversionFactor: parseQty(l.conversionFactor),
      qtyBase: parseQty(l.qtyBase),
      unitCost: l.unitCost === null ? null : toMoney(l.unitCost),
      lineValue: toMoney(l.lineValue),
      origLineId: l.id,
    }))
    await tx.insert(grLineTable).values(
      revLines.map(({ origLineId: _o, ...rest }) => rest),
    )

    const origMovements = await findMovementIdsBySource(
      tx,
      actor.tenantId,
      origLines.map((l) => l.id),
      'GR_IN',
    )
    const intents: MovementIntent[] = revLines.map((rl, i) => ({
      outletId: cur.outletId,
      skuId: rl.skuId,
      kind: 'OUT_VALUE',
      qty: rl.qtyBase,
      valueIn: rl.lineValue,
      movementType: 'GR_REVERSAL',
      sourceType: 'GR_LINE',
      sourceId: rl.id,
      occurredAt: nowIso,
      businessDate: cur.businessDate,
      reversesMovementId: origMovements.get(rl.origLineId) ?? null,
      order: i + 1,
    }))
    const revApplied = await applyMovements(tx, { tenantId: actor.tenantId, actorId: actor.appUserId, processedAt: nowIso }, intents)
    await createStockMinusFlags(tx, {
      tenantId: actor.tenantId,
      outletId: cur.outletId,
      businessDate: cur.businessDate,
      applied: revApplied.applied,
    })

    await resolveStockMinus(tx, {
      tenantId: actor.tenantId,
      outletId: cur.outletId,
      skuIds: revLines.map((l) => l.skuId),
    })
    await auditInventoryEvent(tx, {
      action: 'gr.reversed',
      entityType: 'goods_receipt',
      entityId: id,
      outletId: cur.outletId,
      actorUserId: actor.appUserId,
      reasonText: reason,
      afterData: { reversal_id: reversalId, reversal_doc_no: docNo, total_value: total },
    })
    return { reversalId, docNo }
  })
}

export interface GrLineRow {
  readonly id: string
  readonly lineNo: number
  readonly skuId: string
  readonly uomId: string
  readonly qty: string
  readonly conversionFactor: string
  readonly qtyBase: string
  readonly unitCost: number | null
  readonly lineValue: number
}

async function loadLines(tx: TenantTx, tenantId: string, grId: string): Promise<Array<GrLineRow & { origLineId?: string }>> {
  const rows = await tx
    .select({
      id: grLineTable.id,
      lineNo: grLineTable.lineNo,
      skuId: grLineTable.skuId,
      uomId: grLineTable.uomId,
      qty: grLineTable.qty,
      conversionFactor: grLineTable.conversionFactor,
      qtyBase: grLineTable.qtyBase,
      unitCost: grLineTable.unitCost,
      lineValue: grLineTable.lineValue,
    })
    .from(grLineTable)
    .where(and(eq(grLineTable.tenantId, tenantId), eq(grLineTable.goodsReceiptId, grId)))
    .orderBy(grLineTable.lineNo)
  return rows.map((r) => ({
    id: r.id,
    lineNo: r.lineNo,
    skuId: r.skuId,
    uomId: r.uomId,
    qty: r.qty,
    conversionFactor: r.conversionFactor,
    qtyBase: r.qtyBase,
    unitCost: r.unitCost,
    lineValue: r.lineValue,
  }))
}

export async function listGr(
  actor: IdentityAuthActor,
  filter?: { outletId?: string },
): Promise<Array<{ id: string; docNo: string; status: string; docType: string; outletId: string; businessDate: string; totalValue: number }>> {
  requireActorPermission(actor, 'inventory.manage')
  return withTenant(actor.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: grTable.id,
        docNo: grTable.docNo,
        status: grTable.status,
        docType: grTable.docType,
        outletId: grTable.outletId,
        businessDate: grTable.businessDate,
        totalValue: grTable.totalValue,
      })
      .from(grTable)
      .where(
        and(
          eq(grTable.tenantId, actor.tenantId),
          filter?.outletId ? eq(grTable.outletId, filter.outletId) : sql`true`,
          inArray(grTable.docType, ['RECEIPT', 'REVERSAL']),
        ),
      )
      .orderBy(grTable.businessDate)
    return rows
  })
}
