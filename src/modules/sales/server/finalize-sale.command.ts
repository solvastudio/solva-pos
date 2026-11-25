import '@tanstack/react-start/server-only'
import {
  parseCommandPayload,
  SaleLineModifierInputSchema,
  type FinalizeSalePayloadV1,
  type FlagCode,
  type SaleLineModifierInput,
} from '~/lib/contracts'
import { formatInvoiceNo, invoicePeriod, parseQty } from '~/lib/kernel'
import { filterMissingCatalogRefs, findMissingModifierId } from '~/modules/catalog/public'
import { findRegisterPrefixForBusinessDate, validateSaleIdentityRefs } from '~/modules/identity/public'
import { getShiftForCommand, recomputeRecapIfClosed } from '~/modules/shift/public'
import {
  CommandRejected,
  createAttentionItem,
  createDataFlag,
  publishBillsChanged,
  type CommandContext,
  type CommandHandler,
} from '~/modules/sync/public'
import { registerAfterCommit, type TenantTx } from '~/server/db'
import { createLogger } from '~/server/log'
import { getBillPort } from './bill-port'
import { registerReceivedNumber } from './invoice-series.service'
import { evaluateSaleBusinessFlags } from './sale-flags.service'
import { verifyFinalizeSalePayload } from './sale-verify.adapter'
import { findSaleByBillId, hasSiblingStockBasisConsumption, insertSaleFacts, persistSaleCosts } from './sale.repo'
import { getSaleStockPort } from './stock-port'

const log = createLogger('sales.finalize_sale')

/**
 * Handles `FinalizeSale` inside a single tenant transaction following the canonical
 * locking order (idempotency -> invoice_series -> facts/flags) (SCHEMA §5.4.3).
 */
export const finalizeSaleCommandHandler: CommandHandler<FinalizeSalePayloadV1, TenantTx> = {
  type: 'FinalizeSale',

  parse(payload: unknown, schemaVersion: number): FinalizeSalePayloadV1 {
    return parseCommandPayload('FinalizeSale', schemaVersion, payload) as FinalizeSalePayloadV1
  },

  async handle(
    tx: TenantTx,
    ctx: CommandContext,
    payload: FinalizeSalePayloadV1,
  ): Promise<Record<string, unknown>> {
    const s = payload.sale
    const tenantId = ctx.device.tenantId

    // 1. Structural & reference validation (without extra locks)
    const totalPaid = payload.payments.reduce((acc, p) => acc + p.amount_applied, 0)
    const expectedTotalDue = s.grand_total + s.rounding
    if (totalPaid !== expectedTotalDue) {
      throw new CommandRejected(
        'STRUCTURAL',
        'PAYMENT_MISMATCH',
        `Payment total ${totalPaid} != due ${expectedTotalDue}`,
      )
    }

    if (s.invoice_period !== invoicePeriod(s.business_date)) {
      throw new CommandRejected(
        'STRUCTURAL',
        'VALIDATION_FAILED',
        `invoice_period ${s.invoice_period} does not match business_date ${s.business_date}`,
      )
    }

    let formattedExpectedNo: string
    try {
      formattedExpectedNo = formatInvoiceNo({
        prefix: s.invoice_prefix,
        kind: 'INVOICE',
        period: s.invoice_period,
        seq: s.invoice_seq,
      })
    } catch {
      throw new CommandRejected(
        'STRUCTURAL',
        'VALIDATION_FAILED',
        'Invalid invoice_prefix/period/seq components',
      )
    }
    if (s.invoice_no !== formattedExpectedNo) {
      throw new CommandRejected(
        'STRUCTURAL',
        'VALIDATION_FAILED',
        `invoice_no ${s.invoice_no} mismatches formatted ${formattedExpectedNo}`,
      )
    }

    const shift = await getShiftForCommand(tx, s.shift_id)
    if (!shift) {
      throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', `Unknown shift_id ${s.shift_id}`)
    }
    if (shift.registerId !== ctx.device.registerId) {
      throw new CommandRejected(
        'AUTHORIZATION',
        'FORBIDDEN',
        'Shift belongs to another register',
      )
    }

    const userIds = [s.created_by]
    if (s.discount_approved_by) userIds.push(s.discount_approved_by)
    for (const l of payload.lines) {
      if (l.discount_approved_by) userIds.push(l.discount_approved_by)
    }

    const idCheck = await validateSaleIdentityRefs(tx, {
      tenantId,
      userIds,
      legalEntityId: s.legal_entity_id,
      paymentMethodIds: payload.payments.map((p) => p.method_id),
    })
    if (idCheck.missingUserId) {
      throw new CommandRejected(
        'STRUCTURAL',
        'UNKNOWN_REFERENCE',
        `Unknown user_id ${idCheck.missingUserId}`,
      )
    }
    if (idCheck.missingLegalEntity) {
      throw new CommandRejected(
        'STRUCTURAL',
        'UNKNOWN_REFERENCE',
        `Unknown legal_entity_id ${s.legal_entity_id}`,
      )
    }
    if (idCheck.missingMethodId) {
      throw new CommandRejected(
        'STRUCTURAL',
        'UNKNOWN_REFERENCE',
        `Unknown method_id ${idCheck.missingMethodId}`,
      )
    }

    const skuIds = payload.lines.map((l) => l.sku_id).filter((v): v is string => v !== null)
    const uomIds = payload.lines.map((l) => l.uom_id).filter((v): v is string => v !== null)
    const lineModifiers = new Map<string, SaleLineModifierInput[]>()
    const modifierIds: string[] = []
    for (const l of payload.lines) {
      if (l.modifiers && l.modifiers.length > 0) {
        const parsedMods: SaleLineModifierInput[] = []
        const seenModIds = new Set<string>()
        for (const rawMod of l.modifiers) {
          const parsed = SaleLineModifierInputSchema.safeParse(rawMod)
          if (!parsed.success) {
            throw new CommandRejected(
              'STRUCTURAL',
              'VALIDATION_FAILED',
              parsed.error.issues[0]?.message ?? 'Invalid sale line modifier',
            )
          }
          if (parsed.data.modifier_id) {
            if (seenModIds.has(parsed.data.modifier_id)) {
              throw new CommandRejected(
                'STRUCTURAL',
                'VALIDATION_FAILED',
                `Duplicate modifier_id ${parsed.data.modifier_id} on line ${l.line_no}`,
              )
            }
            seenModIds.add(parsed.data.modifier_id)
            modifierIds.push(parsed.data.modifier_id)
          }
          parsedMods.push(parsed.data)
        }
        lineModifiers.set(l.id, parsedMods)
      }
    }

    const catCheck = await filterMissingCatalogRefs(tx, { tenantId, skuIds, uomIds })
    if (catCheck.missingSkuId) {
      throw new CommandRejected(
        'STRUCTURAL',
        'UNKNOWN_REFERENCE',
        `Unknown sku_id ${catCheck.missingSkuId}`,
      )
    }
    if (catCheck.missingUomId) {
      throw new CommandRejected(
        'STRUCTURAL',
        'UNKNOWN_REFERENCE',
        `Unknown uom_id ${catCheck.missingUomId}`,
      )
    }
    const missingModId = await findMissingModifierId(tx, tenantId, modifierIds)
    if (missingModId) {
      throw new CommandRejected(
        'STRUCTURAL',
        'UNKNOWN_REFERENCE',
        `Unknown modifier_id ${missingModId}`,
      )
    }

    // 1b. Lock bill FOR UPDATE (ARCH §5.2: idempotency -> bill -> invoice_series -> stock -> facts)
    let lockedBillId: string | null = null
    if (s.bill_id !== null) {
      const billRow = await getBillPort().lockBillForPayment(tx, tenantId, s.bill_id)
      if (!billRow) {
        throw new CommandRejected(
          'STRUCTURAL',
          'UNKNOWN_REFERENCE',
          `Unknown bill_id ${s.bill_id}`,
        )
      }
      if (billRow.status === 'PAID') {
        const existingSale = await findSaleByBillId(tx, tenantId, s.bill_id)
        if (existingSale && existingSale.id === s.id) {
          return {
            sale_id: existingSale.id,
            invoice_no: existingSale.invoiceNo,
            invoice_conflict_idx: existingSale.invoiceConflictIdx,
            received_at: existingSale.receivedAt,
            flags: [],
            cost_total: existingSale.costTotal,
            lines: [],
          }
        }
        throw new CommandRejected(
          'STRUCTURAL',
          'BILL_NOT_PAYABLE',
          `Bill ${s.bill_id} is already PAID`,
        )
      }
      if (
        billRow.outletId !== ctx.device.outletId ||
        ctx.device.registerType !== 'CASHIER' ||
        billRow.leaseRegisterId !== ctx.device.registerId ||
        billRow.handoverStatus !== 'NONE' ||
        billRow.status !== 'OPEN'
      ) {
        throw new CommandRejected(
          'STRUCTURAL',
          'BILL_NOT_PAYABLE',
          `Bill ${s.bill_id} cannot be paid by register ${ctx.device.registerId} (status=${billRow.status}, handover=${billRow.handoverStatus})`,
        )
      }
      if (billRow.splitMode === 'EQUAL') {
        const hasShare = payload.lines.some((l) => l.line_kind === 'SHARE')
        const hasItem = payload.lines.some((l) => l.line_kind === 'ITEM')
        if (!hasShare || hasItem) {
          throw new CommandRejected(
            'STRUCTURAL',
            'VALIDATION_FAILED',
            'EQUAL split child sale requires SHARE lines and cannot contain ITEM lines',
          )
        }
        const hasStockBasis = payload.lines.some((l) => l.line_kind === 'STOCK_BASIS')
        if (hasStockBasis && (billRow.siblingBillIds?.length ?? 0) > 0) {
          const alreadyConsumed = await hasSiblingStockBasisConsumption(
            tx,
            tenantId,
            billRow.siblingBillIds!,
          )
          if (alreadyConsumed) {
            throw new CommandRejected(
              'STRUCTURAL',
              'VALIDATION_FAILED',
              'STOCK_BASIS stock consumption was already finalized by a sibling split share',
            )
          }
        }
      } else if (payload.lines.some((l) => l.line_kind !== 'ITEM')) {
        throw new CommandRejected(
          'STRUCTURAL',
          'VALIDATION_FAILED',
          'SHARE and STOCK_BASIS lines are only valid on EQUAL split child bills',
        )
      }
      lockedBillId = billRow.id
    }

    const effectivePrefix = await findRegisterPrefixForBusinessDate(
      tx,
      tenantId,
      ctx.device.registerId,
      s.business_date,
    )
    if (effectivePrefix && effectivePrefix !== s.invoice_prefix) {
      log.warn(
        {
          commandId: ctx.commandId,
          reason: 'invoice_prefix_mismatch',
        },
        'sale accepted with non-matching register invoice_prefix snapshot',
      )
    }

    // 2. Lock invoice_series and resolve gap / -Dn conflict
    const seriesOutcome = await registerReceivedNumber(tx, {
      tenantId,
      outletId: ctx.device.outletId,
      registerId: ctx.device.registerId,
      docType: 'INVOICE',
      docId: s.id,
      prefix: s.invoice_prefix,
      period: s.invoice_period,
      seq: s.invoice_seq,
      receivedAtIso: ctx.receivedAtIso,
    })

    // 3. Persist sale facts identically to payload (never alter client amounts)
    await insertSaleFacts(tx, {
      ctx,
      payload,
      finalInvoiceNo: seriesOutcome.finalNo,
      invoiceConflictIdx: seriesOutcome.conflictIdx,
      lineModifiers,
    })

    if (lockedBillId !== null) {
      await getBillPort().markBillPaid(tx, tenantId, lockedBillId, ctx.receivedAtIso)
      registerAfterCommit(tx, () => publishBillsChanged(tenantId, ctx.device.outletId))
    }

    // 3b. Authoritative stock and COGS: SALE movement and cost_snapshot within this transaction (BR-HPP-004).
    //     Never rejects for stock reasons (AP-02); negative balances are only flagged in step 5b.
    const stock = await getSaleStockPort().applySale(tx, {
      tenantId,
      outletId: ctx.device.outletId,
      saleId: s.id,
      occurredAt: s.occurred_at,
      businessDate: s.business_date,
      processedAt: ctx.receivedAtIso,
      commandId: ctx.commandId,
      actorId: s.created_by,
      lines: payload.lines.map((l) => ({
        lineId: l.id,
        lineNo: l.line_no,
        lineKind: l.line_kind,
        skuId: l.sku_id,
        qtyBase: parseQty(l.qty_base),
        modifiers: (lineModifiers.get(l.id) ?? []).map((m) => ({
          modifierId: m.modifier_id,
          qty: m.qty ?? 1,
        })),
      })),
    })
    await persistSaleCosts(tx, {
      tenantId,
      saleId: s.id,
      costTotal: stock.costTotal,
      lines: stock.lines,
    })

    const flags = new Set<FlagCode>()

    if (seriesOutcome.isConflict) {
      await createDataFlag(tx, {
        tenantId,
        outletId: ctx.device.outletId,
        businessDate: s.business_date,
        flagCode: 'NOMOR_KONFLIK',
        entityType: 'SALE',
        entityId: s.id,
        commandId: ctx.commandId,
        detail: {
          invoice_seq: s.invoice_seq,
          conflict_idx: seriesOutcome.conflictIdx,
        },
      })
      raisedAdd(flags, 'NOMOR_KONFLIK')

      await createAttentionItem(tx, ctx, {
        commandType: 'FinalizeSale',
        reasonClass: 'STRUCTURAL',
        reasonCode: 'SERIES_CONFLICT',
        detail: `Duplicate invoice sequence ${s.invoice_period}-${s.invoice_seq} assigned -D${seriesOutcome.conflictIdx}`,
        payload: {
          sale_id: s.id,
          invoice_seq: s.invoice_seq,
          conflict_idx: seriesOutcome.conflictIdx,
        },
      })
    }

    // 4. Server figure verification (SELISIH_HITUNG flag if discrepancy; skipped on F5 SHARE/STOCK_BASIS)
    const verifySummary = verifyFinalizeSalePayload(payload)
    if (verifySummary.skipped) {
      log.info({ commandId: ctx.commandId, reason: 'non_item_split_lines' }, 'verifySale skipped for non-ITEM split lines')
    } else if (!verifySummary.ok) {
      await createDataFlag(tx, {
        tenantId,
        outletId: ctx.device.outletId,
        businessDate: s.business_date,
        flagCode: 'SELISIH_HITUNG',
        entityType: 'SALE',
        entityId: s.id,
        diffAmount: verifySummary.diffAmount,
        commandId: ctx.commandId,
        detail: { paths: verifySummary.paths },
      })
      raisedAdd(flags, 'SELISIH_HITUNG')
    }

    // 5. Business condition flags (HARGA_STALE, ITEM_NONAKTIF, ITEM_TIDAK_TERSEDIA, TARIF_BERBEDA)
    const businessFlags = await evaluateSaleBusinessFlags(tx, ctx, payload)
    for (const f of businessFlags) {
      flags.add(f)
    }

    // 5b. Negative stock balance (BR-STK-002): flag, do not reject (AP-02).
    for (const neg of stock.negativeResults) {
      const line = payload.lines.find((l) => l.sku_id === neg.skuId)
      await createDataFlag(tx, {
        tenantId,
        outletId: ctx.device.outletId,
        businessDate: s.business_date,
        flagCode: 'STOK_MINUS',
        entityType: line ? 'SALE_LINE' : 'SALE',
        entityId: line ? line.id : s.id,
        commandId: ctx.commandId,
        detail: { sku_id: neg.skuId, qty_after: neg.qtyAfter },
      })
      raisedAdd(flags, 'STOK_MINUS')
    }

    // 5c. Menu without recipe (BR-RCP-006): flag TANPA_RESEP on SALE_LINE, do not reject.
    for (const missingLineId of stock.missingRecipeLineIds ?? []) {
      const line = payload.lines.find((l) => l.id === missingLineId)
      await createDataFlag(tx, {
        tenantId,
        outletId: ctx.device.outletId,
        businessDate: s.business_date,
        flagCode: 'TANPA_RESEP',
        entityType: 'SALE_LINE',
        entityId: missingLineId,
        parentId: s.id,
        commandId: ctx.commandId,
        detail: line?.sku_id ? { sku_id: line.sku_id } : undefined,
      })
      raisedAdd(flags, 'TANPA_RESEP')
    }

    await recomputeRecapIfClosed(tx, s.shift_id, ctx.receivedAtIso)

    const lineNoById = new Map(payload.lines.map((l) => [l.id, l.line_no] as const))
    return {
      sale_id: s.id,
      invoice_no: seriesOutcome.finalNo,
      invoice_conflict_idx: seriesOutcome.conflictIdx,
      received_at: ctx.receivedAtIso,
      flags: [...flags],
      cost_total: stock.costTotal,
      lines: stock.lines.map((l) => ({
        line_no: lineNoById.get(l.lineId) ?? null,
        cost_snapshot: l.costSnapshot,
      })),
    }
  },
}

function raisedAdd(set: Set<FlagCode>, code: FlagCode): void {
  set.add(code)
}
