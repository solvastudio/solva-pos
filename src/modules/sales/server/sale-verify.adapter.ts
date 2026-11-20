import type { FinalizeSalePayloadV1 } from '~/lib/contracts'
import { parseQty, toMoney, type CashRoundingUnit } from '~/lib/kernel'
import { verifySale, type CartLineInput, type DiscountInput, type PaymentInput } from '~/lib/sales-calc'

export interface SaleVerifySummary {
  readonly skipped: boolean
  readonly ok: boolean
  readonly diffAmount: number
  readonly paths: readonly string[]
}

function buildDiscount(
  type: 'PERCENT' | 'NOMINAL' | null,
  pct: string | null,
  input: number | null,
): DiscountInput | undefined {
  if (type === 'PERCENT' && pct !== null) {
    return { kind: 'PERCENT', percent: pct }
  }
  if (type === 'NOMINAL' && input !== null) {
    return { kind: 'NOMINAL', amount: toMoney(input) }
  }
  return undefined
}

/**
 * Reconstructs `SaleCalcInput` and `PaymentInput[]` from a validated `FinalizeSale` payload
 * and checks numerical consistency via `verifySale` without mutating client figures (BR-MNY-007, EC-029).
 */
export function verifyFinalizeSalePayload(payload: FinalizeSalePayloadV1): SaleVerifySummary {
  const hasNonItemLine = payload.lines.some((l) => l.line_kind !== 'ITEM')
  if (hasNonItemLine) {
    return { skipped: true, ok: true, diffAmount: 0, paths: [] }
  }

  const s = payload.sale
  const sortedLines = [...payload.lines].sort((a, b) => a.line_no - b.line_no)
  const sortedPayments = [...payload.payments].sort((a, b) => a.seq - b.seq)

  const calcLines: CartLineInput[] = sortedLines.map((l) => ({
    lineNo: l.line_no,
    skuId: l.sku_id!,
    uomId: l.uom_id!,
    qty: parseQty(l.qty),
    unitPrice: toMoney(l.unit_price),
    taxable: l.taxable,
    isOpenPrice: l.is_open_price,
    discount: buildDiscount(l.discount_type, l.discount_pct, l.discount_input),
  }))

  const payments: PaymentInput[] = sortedPayments.map((p) => ({
    methodCode: p.method_code,
    kind: p.method_kind,
    amount: toMoney(p.method_kind === 'CASH' ? p.cash_tendered! : p.amount_applied),
    reference: p.reference,
  }))

  try {
    const res = verifySale({
      input: {
        lines: calcLines,
        billDiscount: buildDiscount(
          s.bill_discount_type,
          s.bill_discount_pct,
          s.bill_discount_input,
        ),
        config: {
          priceTaxMode: s.price_tax_mode,
          taxProfile: s.tax_profile,
          taxRate: s.tax_rate,
          serviceChargeEnabled: Number(s.service_charge_rate) > 0 || s.service_charge > 0,
          serviceChargeRate: s.service_charge_rate,
          serviceChargeTaxable: s.service_charge_taxable,
        },
      },
      payments,
      cashRoundingUnit: s.cash_rounding_unit as CashRoundingUnit,
      stored: {
        grossTotal: toMoney(s.gross_total),
        lineDiscountTotal: toMoney(s.line_discount_total),
        billDiscountTotal: toMoney(s.bill_discount_total),
        netSubtotal: toMoney(s.net_subtotal),
        serviceCharge: toMoney(s.service_charge),
        taxBase: toMoney(s.tax_base),
        taxAmount: toMoney(s.tax_amount),
        dpp: toMoney(s.dpp),
        grandTotal: toMoney(s.grand_total),
        rounding: toMoney(s.rounding),
        totalDue: toMoney(s.grand_total + s.rounding),
        lines: sortedLines.map((l) => {
          const lineTotalNum =
            l.line_net -
            l.bill_discount_alloc +
            l.service_alloc +
            (s.price_tax_mode === 'EXCLUSIVE' ? l.tax_alloc : 0)
          return {
            lineNo: l.line_no,
            lineGross: toMoney(l.line_gross),
            lineDiscount: toMoney(l.line_discount),
            lineNet: toMoney(l.line_net),
            billDiscountAlloc: toMoney(l.bill_discount_alloc),
            serviceAlloc: toMoney(l.service_alloc),
            taxAlloc: toMoney(l.tax_alloc),
            lineTotal: toMoney(lineTotalNum),
          }
        }),
      },
    })

    if (res.ok) {
      return { skipped: false, ok: true, diffAmount: 0, paths: [] }
    }

    const headerDiffs = res.diffs.filter((d) => d.path === 'grandTotal' || d.path === 'taxAmount')
    const diffSource = headerDiffs.length > 0 ? headerDiffs : res.diffs
    const diffAmount = diffSource.reduce((acc, d) => acc + Math.abs(d.actual - d.expected), 0)

    return {
      skipped: false,
      ok: false,
      diffAmount,
      paths: res.diffs.map((d) => d.path),
    }
  } catch (err) {
    return {
      skipped: false,
      ok: false,
      diffAmount: 1,
      paths: [err instanceof Error ? err.message.slice(0, 120) : 'verify_error'],
    }
  }
}
