import '@tanstack/react-start/server-only'
import { parseCommandPayload, type VoidSalePayloadV1 } from '~/lib/contracts'
import { parseQty, toMoney } from '~/lib/kernel'
import { findMissingAppUserId } from '~/modules/identity/public'
import { recomputeRecapIfClosed } from '~/modules/shift/public'
import { CommandRejected, type CommandContext, type CommandHandler } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { createLogger } from '~/server/log'
import { findSaleForVoid, hasCreditNoteForSale, loadSaleStockContext, markSaleVoided } from './sale.repo'
import { getSaleStockPort } from './stock-port'

const log = createLogger('sales.void_sale')

/**
 * Handles `VoidSale`: retains the original invoice number and facts (BR-INV-005),
 * updates allowed void columns cleanly, and recomputes closed shift recaps.
 */
export const voidSaleCommandHandler: CommandHandler<VoidSalePayloadV1, TenantTx> = {
  type: 'VoidSale',

  parse(payload: unknown, schemaVersion: number): VoidSalePayloadV1 {
    return parseCommandPayload('VoidSale', schemaVersion, payload) as VoidSalePayloadV1
  },

  async handle(
    tx: TenantTx,
    ctx: CommandContext,
    payload: VoidSalePayloadV1,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.device.tenantId

    const missingUser = await findMissingAppUserId(tx, tenantId, [
      payload.voided_by,
      payload.void_approved_by,
    ])
    if (missingUser) {
      throw new CommandRejected(
        'STRUCTURAL',
        'UNKNOWN_REFERENCE',
        `Unknown user_id ${missingUser}`,
      )
    }

    const existing = await findSaleForVoid(tx, tenantId, payload.sale_id)
    if (!existing) {
      throw new CommandRejected(
        'STRUCTURAL',
        'UNKNOWN_REFERENCE',
        `Unknown sale_id ${payload.sale_id}`,
      )
    }
    if (existing.registerId !== ctx.device.registerId) {
      throw new CommandRejected(
        'AUTHORIZATION',
        'FORBIDDEN',
        'Sale belongs to another register',
      )
    }

    if (existing.status === 'VOID') {
      return {
        sale_id: existing.id,
        status: 'VOID',
      }
    }

    const hasCn = await hasCreditNoteForSale(tx, tenantId, existing.id)
    if (hasCn) {
      log.warn(
        {
          commandId: ctx.commandId,
          reason: 'void_sale_with_existing_credit_note',
        },
        'accepted VoidSale for invoice that already has credit note(s)',
      )
    }

    await markSaleVoided(tx, {
      tenantId,
      saleId: existing.id,
      voidedAt: payload.voided_at,
      voidedBy: payload.voided_by,
      voidApprovedBy: payload.void_approved_by,
      voidReasonCode: payload.reason_code,
      voidReasonText: payload.reason_text,
      voidCommandId: ctx.commandId,
    })

    // Stock: reverse the portion not yet returned with SALE_VOID at the snapshot cost (BR-HPP-007).
    const stockCtx = await loadSaleStockContext(tx, tenantId, existing.id)
    if (stockCtx) {
      await getSaleStockPort().applyVoid(tx, {
        tenantId,
        outletId: stockCtx.outletId,
        occurredAt: payload.voided_at,
        businessDate: stockCtx.businessDate,
        processedAt: ctx.receivedAtIso,
        commandId: ctx.commandId,
        actorId: payload.voided_by,
        lines: stockCtx.lines.map((l) => ({
          lineId: l.lineId,
          lineNo: l.lineNo,
          skuId: l.skuId,
          qtyBase: parseQty(l.qtyBase),
          costSnapshot: l.costSnapshot === null ? null : toMoney(l.costSnapshot),
          returnedQtyBase: parseQty(l.returnedQtyBase),
          returnedCost: toMoney(l.returnedCost),
        })),
      })
    }

    await recomputeRecapIfClosed(tx, existing.shiftId, ctx.receivedAtIso)

    return {
      sale_id: existing.id,
      status: 'VOID',
    }
  },
}
