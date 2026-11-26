import '@tanstack/react-start/server-only'
import { and, asc, eq } from 'drizzle-orm'
import {
  InvoiceLookupResponseSchema,
  type InvoiceLookupResponse,
} from '~/lib/contracts/invoice-lookup'
import { normalizeQty, parseQty } from '~/lib/kernel'
import { withTenant } from '~/server/db'
import { sumPriorCreditNoteReturns } from './credit-note.repo'
import { sale, saleLine, salePayment } from './schema'

function normalizeNumeric(raw: string | number): string {
  return normalizeQty(parseQty(String(raw)))
}

/**
 * Looks up a stored sale invoice by `invoice_no` restricted strictly to the
 * requesting device's `tenantId` + `outletId` for online remote returns (BR-RTR-004).
 */
export async function lookupInvoiceForReturn(params: {
  tenantId: string
  outletId: string
  invoiceNo: string
}): Promise<InvoiceLookupResponse | null> {
  const cleanNo = params.invoiceNo.trim()
  if (!cleanNo || cleanNo.length > 40) {
    return null
  }

  return withTenant(params.tenantId, async (tx) => {
    const [saleRow] = await tx
      .select()
      .from(sale)
      .where(
        and(
          eq(sale.tenantId, params.tenantId),
          eq(sale.outletId, params.outletId),
          eq(sale.invoiceNo, cleanNo),
        ),
      )
      .limit(1)

    if (!saleRow) {
      return null
    }

    const lines = await tx
      .select()
      .from(saleLine)
      .where(and(eq(saleLine.tenantId, params.tenantId), eq(saleLine.saleId, saleRow.id)))
      .orderBy(asc(saleLine.lineNo))
    const payments = await tx
      .select()
      .from(salePayment)
      .where(and(eq(salePayment.tenantId, params.tenantId), eq(salePayment.saleId, saleRow.id)))
      .orderBy(asc(salePayment.seq))

    const priorReturns = await sumPriorCreditNoteReturns(
      tx,
      params.tenantId,
      lines.map((l) => l.id),
    )

    return InvoiceLookupResponseSchema.parse({
      sale: {
        id: saleRow.id,
        outlet_id: saleRow.outletId,
        register_id: saleRow.registerId,
        invoice_no: saleRow.invoiceNo,
        business_date: saleRow.businessDate,
        status: saleRow.status,
        price_tax_mode: saleRow.priceTaxMode,
        cash_rounding_unit: saleRow.cashRoundingUnit,
        receipt_locale: saleRow.receiptLocale,
        grand_total: saleRow.grandTotal,
        payments: payments.map((p) => ({
          method_id: p.methodId,
          method_code: p.methodCode,
          method_name: p.methodName,
          method_kind: p.methodKind,
          amount_applied: p.amountApplied,
        })),
      },
      lines: lines.map((l) => {
        const prev = priorReturns.get(l.id)
        return {
          id: l.id,
          line_no: l.lineNo,
          line_kind: l.lineKind,
          sku_id: l.skuId,
          uom_id: l.uomId,
          item_name: l.itemName,
          uom_code: l.uomCode,
          qty: normalizeNumeric(l.qty),
          conversion_factor: normalizeNumeric(l.conversionFactor),
          unit_price: l.unitPrice,
          line_net: l.lineNet,
          bill_discount_alloc: l.billDiscountAlloc,
          service_alloc: l.serviceAlloc,
          tax_alloc: l.taxAlloc,
          disposition_default: 'KEMBALI_STOK',
          returned_so_far: {
            qty: prev ? normalizeNumeric(prev.qtyReturnedSum) : '0',
            net: prev?.netSum ?? 0,
            sc: prev?.scSum ?? 0,
            tax: prev?.taxSum ?? 0,
          },
        }
      }),
    })
  })
}
