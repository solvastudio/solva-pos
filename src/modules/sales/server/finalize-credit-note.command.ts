import '@tanstack/react-start/server-only'
import { parseCommandPayload, type FinalizeCreditNotePayloadV1, type FlagCode } from '~/lib/contracts'
import {
  addQty,
  cmpQty,
  formatInvoiceNo,
  invoicePeriod,
  parseQty,
  toMoney,
  type CashRoundingUnit,
} from '~/lib/kernel'
import { isWithinReturnWindow, verifyCreditNote, type ReturnLineInput } from '~/lib/sales-calc'
import { findMissingAppUserId, findMissingPaymentMethodId } from '~/modules/identity/public'
import { getShiftForCommand, recomputeRecapIfClosed } from '~/modules/shift/public'
import {
  CommandRejected,
  createAttentionItem,
  createDataFlag,
  type CommandContext,
  type CommandHandler,
} from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import {
  findOriginalSaleForCreditNote,
  insertCreditNoteFacts,
  lockSaleLinesOrderedForUpdate,
  sumPriorCreditNoteReturns,
} from './credit-note.repo'
import { registerReceivedNumber } from './invoice-series.service'

/**
 * Handles `FinalizeCreditNote`: validates structural integrity, return window,
 * serialized cumulative return quantities across `sale_line FOR UPDATE`, assigns `NK` series
 * (or `-Dn` on collision), and verifies arithmetic without mutating client figures (BR-RTR-001..009, V-18).
 */
export const finalizeCreditNoteCommandHandler: CommandHandler<
  FinalizeCreditNotePayloadV1,
  TenantTx
> = {
  type: 'FinalizeCreditNote',

  parse(payload: unknown, schemaVersion: number): FinalizeCreditNotePayloadV1 {
    return parseCommandPayload(
      'FinalizeCreditNote',
      schemaVersion,
      payload,
    ) as FinalizeCreditNotePayloadV1
  },

  async handle(
    tx: TenantTx,
    ctx: CommandContext,
    payload: FinalizeCreditNotePayloadV1,
  ): Promise<Record<string, unknown>> {
    const cn = payload.credit_note
    const tenantId = ctx.device.tenantId

    // 1. Structural & reference validation
    const totalRefundApplied = payload.refunds.reduce((sum, r) => sum + r.amount_applied, 0)
    const expectedRefundTotal = cn.refund_gross + cn.rounding
    if (totalRefundApplied !== expectedRefundTotal) {
      throw new CommandRejected(
        'STRUCTURAL',
        'PAYMENT_MISMATCH',
        `Refund total ${totalRefundApplied} != due ${expectedRefundTotal}`,
      )
    }

    if (cn.cn_period !== invoicePeriod(cn.business_date)) {
      throw new CommandRejected(
        'STRUCTURAL',
        'VALIDATION_FAILED',
        `cn_period ${cn.cn_period} mismatches business_date ${cn.business_date}`,
      )
    }

    let formattedExpectedCnNo: string
    try {
      formattedExpectedCnNo = formatInvoiceNo({
        prefix: cn.cn_prefix,
        kind: 'CREDIT_NOTE',
        period: cn.cn_period,
        seq: cn.cn_seq,
      })
    } catch {
      throw new CommandRejected(
        'STRUCTURAL',
        'VALIDATION_FAILED',
        'Invalid cn_prefix/period/seq components',
      )
    }
    if (cn.cn_no !== formattedExpectedCnNo) {
      throw new CommandRejected(
        'STRUCTURAL',
        'VALIDATION_FAILED',
        `cn_no ${cn.cn_no} mismatches ${formattedExpectedCnNo}`,
      )
    }

    const shift = await getShiftForCommand(tx, cn.shift_id)
    if (!shift) {
      throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', `Unknown shift_id ${cn.shift_id}`)
    }
    if (shift.registerId !== ctx.device.registerId) {
      throw new CommandRejected(
        'AUTHORIZATION',
        'FORBIDDEN',
        'Credit note shift belongs to another register',
      )
    }

    const missingUser = await findMissingAppUserId(tx, tenantId, [cn.created_by, cn.approved_by])
    if (missingUser) {
      throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', `Unknown user_id ${missingUser}`)
    }

    const missingMethod = await findMissingPaymentMethodId(
      tx,
      tenantId,
      payload.refunds.map((r) => r.method_id),
    )
    if (missingMethod) {
      throw new CommandRejected(
        'STRUCTURAL',
        'UNKNOWN_REFERENCE',
        `Unknown method_id ${missingMethod}`,
      )
    }

    const originalSale = await findOriginalSaleForCreditNote(tx, tenantId, cn.original_sale_id)
    if (!originalSale) {
      throw new CommandRejected(
        'STRUCTURAL',
        'UNKNOWN_REFERENCE',
        `Unknown original_sale_id ${cn.original_sale_id}`,
      )
    }
    if (originalSale.status === 'VOID') {
      throw new CommandRejected('STRUCTURAL', 'VALIDATION_FAILED', 'ORIGINAL_VOID')
    }

    if (!isWithinReturnWindow(originalSale.businessDate, cn.business_date)) {
      throw new CommandRejected('STRUCTURAL', 'VALIDATION_FAILED', 'RETURN_WINDOW')
    }

    // 2. Lock original sale lines FOR UPDATE (ascending ID order) & enforce cumulative qty
    const saleLineIds = payload.lines.map((l) => l.sale_line_id)
    const lockedLines = await lockSaleLinesOrderedForUpdate(tx, tenantId, saleLineIds)
    const priorReturns = await sumPriorCreditNoteReturns(tx, tenantId, saleLineIds)

    const incomingQtyPerLine = new Map<string, ReturnType<typeof parseQty>>()
    for (const line of payload.lines) {
      const orig = lockedLines.get(line.sale_line_id)
      if (!orig || orig.saleId !== originalSale.id) {
        throw new CommandRejected(
          'STRUCTURAL',
          'UNKNOWN_REFERENCE',
          `Unknown or mismatched sale_line_id ${line.sale_line_id}`,
        )
      }

      if (orig.lineKind === 'SHARE' && line.disposition !== null) {
        throw new CommandRejected(
          'STRUCTURAL',
          'VALIDATION_FAILED',
          'disposition must be null for SHARE line',
        )
      }
      if (orig.lineKind !== 'SHARE' && line.disposition === null) {
        throw new CommandRejected(
          'STRUCTURAL',
          'VALIDATION_FAILED',
          'disposition is required for non-SHARE line',
        )
      }

      const prevIncoming = incomingQtyPerLine.get(line.sale_line_id) ?? parseQty('0')
      incomingQtyPerLine.set(line.sale_line_id, addQty(prevIncoming, parseQty(line.qty_returned)))
    }

    for (const [saleLineId, addQtyTotal] of incomingQtyPerLine.entries()) {
      const orig = lockedLines.get(saleLineId)!
      const priorQty = parseQty(priorReturns.get(saleLineId)?.qtyReturnedSum ?? '0')
      const newCumulative = addQty(priorQty, addQtyTotal)
      if (cmpQty(newCumulative, parseQty(orig.qty)) > 0) {
        throw new CommandRejected(
          'STRUCTURAL',
          'RETURN_EXCEEDS_QTY',
          `Cumulative return qty ${newCumulative} exceeds sold ${orig.qty}`,
        )
      }
    }

    // 3. Assign CREDIT_NOTE invoice_series sequence & detect/fill gaps or -Dn conflict
    const seriesOutcome = await registerReceivedNumber(tx, {
      tenantId,
      outletId: ctx.device.outletId,
      registerId: ctx.device.registerId,
      docType: 'CREDIT_NOTE',
      docId: cn.id,
      prefix: cn.cn_prefix,
      period: cn.cn_period,
      seq: cn.cn_seq,
      receivedAtIso: ctx.receivedAtIso,
    })

    // 4. Insert credit note facts identically to client payload
    await insertCreditNoteFacts(tx, {
      ctx,
      payload,
      finalCnNo: seriesOutcome.finalNo,
      cnConflictIdx: seriesOutcome.conflictIdx,
    })

    const flags = new Set<FlagCode>()

    if (seriesOutcome.isConflict) {
      await createDataFlag(tx, {
        tenantId,
        outletId: ctx.device.outletId,
        businessDate: cn.business_date,
        flagCode: 'NOMOR_KONFLIK',
        entityType: 'CREDIT_NOTE',
        entityId: cn.id,
        commandId: ctx.commandId,
        detail: {
          cn_seq: cn.cn_seq,
          conflict_idx: seriesOutcome.conflictIdx,
        },
      })
      flags.add('NOMOR_KONFLIK')

      await createAttentionItem(tx, ctx, {
        commandType: 'FinalizeCreditNote',
        reasonClass: 'STRUCTURAL',
        reasonCode: 'SERIES_CONFLICT',
        detail: `Duplicate credit note sequence ${cn.cn_period}-${cn.cn_seq} assigned -D${seriesOutcome.conflictIdx}`,
        payload: {
          credit_note_id: cn.id,
          cn_seq: cn.cn_seq,
          conflict_idx: seriesOutcome.conflictIdx,
        },
      })
    }

    // 5. Verify credit note calculations without mutating client amounts
    const hasCashRefund = payload.refunds.some((r) => r.method_kind === 'CASH')
    const runningPriorByLine = new Map<
      string,
      { qty: string; net: number; sc: number; tax: number }
    >()
    for (const slId of saleLineIds) {
      const pr = priorReturns.get(slId)
      runningPriorByLine.set(slId, {
        qty: pr?.qtyReturnedSum ?? '0',
        net: pr?.netSum ?? 0,
        sc: pr?.scSum ?? 0,
        tax: pr?.taxSum ?? 0,
      })
    }

    let verifyOk: boolean
    let verifyPaths: string[] = []
    let verifyDiffAmount = 0
    try {
      const sortedLines = [...payload.lines].sort((a, b) => a.line_no - b.line_no)
      const calcInputs: ReturnLineInput[] = sortedLines.map((l) => {
        const orig = lockedLines.get(l.sale_line_id)!
        const acc = runningPriorByLine.get(l.sale_line_id)!
        const entry: ReturnLineInput = {
          qtySold: parseQty(orig.qty),
          qtyAlreadyReturned: parseQty(acc.qty),
          qtyReturn: parseQty(l.qty_returned),
          originalNet: toMoney(orig.lineNet - orig.billDiscountAlloc),
          originalScAlloc: toMoney(orig.serviceAlloc),
          originalTaxAlloc: toMoney(orig.taxAlloc),
          returnedSoFar: {
            net: toMoney(acc.net),
            sc: toMoney(acc.sc),
            tax: toMoney(acc.tax),
          },
        }
        acc.qty = addQty(parseQty(acc.qty), parseQty(l.qty_returned))
        acc.net += l.refund_net
        acc.sc += l.refund_service
        acc.tax += l.refund_tax
        return entry
      })

      const cashRefundSum = payload.refunds
        .filter((r) => r.method_kind === 'CASH')
        .reduce((acc, r) => acc + r.amount_applied, 0)

      const vr = verifyCreditNote({
        lines: calcInputs,
        priceTaxMode: cn.price_tax_mode,
        refund: {
          method: hasCashRefund ? 'CASH' : 'ORIGINAL',
          cashRoundingUnit: cn.cash_rounding_unit as CashRoundingUnit,
        },
        stored: {
          lines: sortedLines.map((l) => ({
            net: toMoney(l.refund_net),
            sc: toMoney(l.refund_service),
            tax: toMoney(l.refund_tax),
            isLast: l.is_final_return,
          })),
          netTotal: toMoney(cn.net_total),
          scTotal: toMoney(cn.service_total),
          taxTotal: toMoney(cn.tax_total),
          refundGross: toMoney(cn.refund_gross),
          refundCashApplied: hasCashRefund ? toMoney(cashRefundSum) : null,
          rounding: toMoney(cn.rounding),
        },
      })

      verifyOk = vr.ok
      if (!vr.ok) {
        verifyPaths = vr.diffs.map((d) => d.path)
        const grossDiff = vr.diffs.find((d) => d.path === 'refundGross')
        verifyDiffAmount = grossDiff
          ? Math.abs(grossDiff.actual - grossDiff.expected)
          : vr.diffs.reduce((s, d) => s + Math.abs(d.actual - d.expected), 0)
      }
    } catch (err) {
      verifyOk = false
      verifyDiffAmount = 1
      verifyPaths = [err instanceof Error ? err.message.slice(0, 120) : 'verify_error']
    }

    if (!verifyOk) {
      await createDataFlag(tx, {
        tenantId,
        outletId: ctx.device.outletId,
        businessDate: cn.business_date,
        flagCode: 'SELISIH_HITUNG',
        entityType: 'CREDIT_NOTE',
        entityId: cn.id,
        diffAmount: verifyDiffAmount,
        commandId: ctx.commandId,
        detail: { paths: verifyPaths },
      })
      flags.add('SELISIH_HITUNG')
    }

    // 6. Recompute closed shift recap if refund occurred on a closed shift
    await recomputeRecapIfClosed(tx, cn.shift_id, ctx.receivedAtIso)

    return {
      credit_note_id: cn.id,
      cn_no: seriesOutcome.finalNo,
      cn_conflict_idx: seriesOutcome.conflictIdx,
      flags: [...flags],
    }
  },
}
