import { z } from 'zod'

export const REPORT_GROUP_BY = ['DAY', 'WEEK', 'MONTH'] as const
export type ReportGroupBy = (typeof REPORT_GROUP_BY)[number]

export const REPORT_MAX_RANGE_DAYS = 366
export const REPORT_MAX_TABLE_ROWS = 5000

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseUtcDateMs(ymd: string): number | null {
  if (!ISO_DATE_RE.test(ymd)) return null
  const [yStr, mStr, dStr] = ymd.split('-')
  const y = Number(yStr)
  const m = Number(mStr)
  const d = Number(dStr)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() + 1 !== m ||
    dt.getUTCDate() !== d
  ) {
    return null
  }
  return dt.getTime()
}

export const ReportFilterSchema = z
  .object({
    outletIds: z.array(z.string().uuid()).default([]),
    from: z.string().regex(ISO_DATE_RE, 'Invalid date format (YYYY-MM-DD)'),
    to: z.string().regex(ISO_DATE_RE, 'Invalid date format (YYYY-MM-DD)'),
    groupBy: z.enum(REPORT_GROUP_BY).default('DAY'),
    cashierId: z.string().uuid().nullable().optional(),
    registerId: z.string().uuid().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    const fromMs = parseUtcDateMs(val.from)
    const toMs = parseUtcDateMs(val.to)
    if (fromMs === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'Invalid calendar date',
      })
    }
    if (toMs === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Invalid calendar date',
      })
    }
    if (fromMs !== null && toMs !== null) {
      if (fromMs > toMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['from'],
          message: 'from must be <= to',
        })
      } else {
        const diffDays = Math.round((toMs - fromMs) / 86_400_000) + 1
        if (diffDays > REPORT_MAX_RANGE_DAYS) {
          ctx.addIssue({
            code: 'custom',
            path: ['to'],
            message: `Date range must not exceed ${REPORT_MAX_RANGE_DAYS} days`,
          })
        }
      }
    }
  })

export type ReportFilter = z.infer<typeof ReportFilterSchema>
export type ReportFilterInput = z.input<typeof ReportFilterSchema>

/**
 * Masks customer phone number per BR-CUS-002 (`0812****789`) unless caller holds
 * `customer.view_phone`.
 */
export function maskCustomerPhone(
  phone: string | null | undefined,
  canViewFullPhone: boolean,
): string | null {
  if (!phone) return null
  const trimmed = phone.trim()
  if (!trimmed) return null
  if (canViewFullPhone) return trimmed
  if (trimmed.length <= 4) {
    return '****'
  }
  if (trimmed.length < 7) {
    return `${trimmed.slice(0, 2)}****${trimmed.slice(-1)}`
  }
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-3)}`
}

export interface PaymentMethodBreakdownItem {
  readonly methodCode: string
  readonly methodName: string
  readonly methodKind: 'CASH' | 'NON_CASH'
  readonly amountApplied: number
  readonly transactionCount: number
}

export interface CashierSalesBreakdownItem {
  readonly cashierId: string
  readonly cashierName: string
  readonly transactionCount: number
  readonly totalReceived: number
}

export interface SalesReportGroupRow {
  readonly periodKey: string
  readonly outletId: string
  readonly outletCode: string
  readonly outletName: string
  readonly transactionCount: number
  readonly voidCount: number
  readonly gross: number
  readonly discount: number
  readonly netSubtotal: number
  readonly serviceCharge: number
  readonly tax: number
  readonly rounding: number
  readonly totalReceived: number
  readonly returns: number
  readonly netSales: number
  readonly netBeforeTax: number
  readonly netTax: number
  readonly netRounding: number
  readonly byPaymentMethod: readonly PaymentMethodBreakdownItem[]
}

export interface SalesReportTotals {
  readonly transactionCount: number
  readonly voidCount: number
  readonly gross: number
  readonly discount: number
  readonly netSubtotal: number
  readonly serviceCharge: number
  readonly tax: number
  readonly rounding: number
  readonly totalReceived: number
  readonly returns: number
  readonly netSales: number
  readonly netBeforeTax: number
  readonly netTax: number
  readonly netRounding: number
  readonly averageTransaction: number
}

export interface SalesReportResult {
  readonly rows: readonly SalesReportGroupRow[]
  readonly totals: SalesReportTotals
  readonly byPaymentMethod: readonly PaymentMethodBreakdownItem[]
  readonly byCashier: readonly CashierSalesBreakdownItem[]
  readonly truncated: boolean
}

export interface ShiftNonCashMethodItem {
  readonly methodCode: string
  readonly methodName: string
  readonly amountApplied: number
}

export type ShiftReportRowStatus = 'OPEN' | 'COMPLETE' | 'INCOMPLETE' | 'FORCE_CLOSED'

export interface ShiftReportRow {
  readonly shiftId: string
  readonly outletId: string
  readonly outletCode: string
  readonly outletName: string
  readonly outletTimezone: 'Asia/Jakarta' | 'Asia/Makassar' | 'Asia/Jayapura'
  readonly registerId: string
  readonly registerCode: string
  readonly registerName: string
  readonly registerLabel: string
  readonly cashierId: string
  readonly cashierName: string
  readonly businessDate: string
  readonly openedAt: string
  readonly closedAt: string | null
  readonly openingCash: number
  readonly cashSales: number
  readonly cashIn: number
  readonly cashOut: number
  readonly cashRefunds: number
  readonly expectedCash: number
  readonly countedCash: number | null
  readonly variance: number | null
  readonly nonCashTotal: number
  readonly nonCashByMethod: readonly ShiftNonCashMethodItem[]
  readonly shiftStatus: 'OPEN' | 'CLOSED' | 'FORCE_CLOSED'
  readonly recapStatus: 'COMPLETE' | 'INCOMPLETE'
  readonly status: ShiftReportRowStatus
}

export interface ShiftReportResult {
  readonly rows: readonly ShiftReportRow[]
  readonly truncated: boolean
}

export interface OpsStaleHargaRow {
  readonly flagId: string
  readonly outletId: string
  readonly outletCode: string
  readonly businessDate: string
  readonly saleId: string
  readonly invoiceNo: string
  readonly saleLineId: string
  readonly skuCode: string
  readonly itemName: string
  readonly qty: string
  readonly unitPrice: number
  readonly diffAmount: number
  readonly customerPhone: string | null
}

export interface OpsFlagLineRow {
  readonly flagId: string
  readonly flagCode: 'ITEM_NONAKTIF' | 'TARIF_BERBEDA'
  readonly outletId: string
  readonly outletCode: string
  readonly businessDate: string
  readonly saleId: string
  readonly invoiceNo: string
  readonly skuCode: string | null
  readonly itemName: string | null
  readonly qty: string | null
  readonly unitPrice: number | null
  readonly diffAmount: number | null
  readonly customerPhone: string | null
}

export interface OpsSelisihHitungRow {
  readonly flagId: string
  readonly outletId: string
  readonly outletCode: string
  readonly businessDate: string
  readonly entityType: 'SALE' | 'CREDIT_NOTE'
  readonly entityId: string
  readonly invoiceNo: string
  readonly diffAmount: number
  readonly clientTotal: number | null
  readonly serverTotal: number | null
  readonly customerPhone: string | null
}

export interface OpsNomorKonflikRow {
  readonly flagId: string
  readonly outletId: string
  readonly outletCode: string
  readonly businessDate: string
  readonly entityType: 'SALE' | 'CREDIT_NOTE'
  readonly entityId: string
  readonly documentNo: string
  readonly originalNo: string | null
  readonly customerPhone: string | null
}

export interface OpsGapInvoiceRow {
  readonly gapId: string
  readonly outletId: string
  readonly outletCode: string
  readonly registerId: string
  readonly registerCode: string
  readonly docType: 'INVOICE' | 'CREDIT_NOTE'
  readonly period: string
  readonly seqFrom: number
  readonly seqTo: number
  readonly origin: 'DETECTED' | 'RECOVERY_DECLARED'
  readonly status: 'OPEN' | 'EXPLAINED'
  readonly reasonText: string | null
  readonly detectedAt: string
}

export interface OpsAttentionRow {
  readonly attentionId: string
  readonly outletId: string
  readonly outletCode: string
  readonly registerId: string
  readonly registerCode: string | null
  readonly commandId: string
  readonly commandType: string
  readonly reasonClass: 'STRUCTURAL' | 'AUTHORIZATION'
  readonly reasonCode: string
  readonly status: 'OPEN' | 'ESCALATED'
  readonly invoiceNo: string | null
  readonly totalDue: number | null
  readonly createdAt: string
}

export interface OpsItemUnavailableRow {
  readonly flagId: string
  readonly outletId: string
  readonly outletCode: string
  readonly businessDate: string
  readonly saleId: string
  readonly invoiceNo: string
  readonly saleLineId: string
  readonly skuCode: string
  readonly itemName: string
  readonly qty: string
  readonly unitPrice: number
  readonly lineGross: number
  readonly customerPhone: string | null
}

export interface OpsOpenPriceRow {
  readonly saleLineId: string
  readonly outletId: string
  readonly outletCode: string
  readonly businessDate: string
  readonly saleId: string
  readonly invoiceNo: string
  readonly skuCode: string
  readonly itemName: string
  readonly qty: string
  readonly unitPrice: number
  readonly lineGross: number
  readonly cashierId: string
  readonly cashierName: string
  readonly customerPhone: string | null
}

export interface OpsOrphanBillRow {
  readonly billId: string
  readonly outletId: string
  readonly outletCode: string
  readonly tableCode: string
  readonly billRef: string
  readonly status: 'OPEN' | 'SPLIT'
  readonly leaseDeviceId: string
  readonly leaseDeviceName: string
  readonly deviceRevokedAt: string | null
  readonly ageHours: number
  readonly estimatedTotal: number
  readonly itemCount: number
  readonly lastEventAt: string
}

export interface OpsDuplicateBillRow {
  readonly flagId: string
  readonly outletId: string
  readonly outletCode: string
  readonly businessDate: string
  readonly tableId: string | null
  readonly tableCode: string | null
  readonly billId: string
  readonly billRef: string | null
  readonly openCount: number
  readonly billStatus: string | null
  readonly leaseDeviceName: string | null
}

export interface OpsReportSections {
  readonly staleHarga: readonly OpsStaleHargaRow[]
  readonly itemNonaktifTarifBeda: readonly OpsFlagLineRow[]
  readonly selisihHitung: readonly OpsSelisihHitungRow[]
  readonly nomorKonflik: readonly OpsNomorKonflikRow[]
  readonly gapInvoice: readonly OpsGapInvoiceRow[]
  readonly attention: readonly OpsAttentionRow[]
  readonly itemTidakTersedia: readonly OpsItemUnavailableRow[]
  readonly openPrice: readonly OpsOpenPriceRow[]
  readonly orphanBills: readonly OpsOrphanBillRow[]
  readonly duplicateBills: readonly OpsDuplicateBillRow[]
}

export interface OpsReportResult {
  readonly sections: OpsReportSections
}

export interface DashboardDailyPoint {
  readonly businessDate: string
  readonly netSales: number
  readonly totalReceived: number
  readonly returns: number
  readonly transactionCount: number
}

export interface DashboardAttentionCounts {
  readonly dataFlagsCount: number
  readonly openGapsCount: number
  readonly openAttentionCount: number
  readonly totalNeedsAttention: number
}

export interface DashboardReportResult {
  readonly kpis: {
    readonly netSales: number
    readonly totalReceived: number
    readonly transactionCount: number
    readonly voidCount: number
    readonly averageTransaction: number
    readonly returns: number
  }
  readonly dailySeries: readonly DashboardDailyPoint[]
  readonly byPaymentMethod: readonly PaymentMethodBreakdownItem[]
  readonly recentShifts: readonly ShiftReportRow[]
  readonly attentionCounts: DashboardAttentionCounts
}
