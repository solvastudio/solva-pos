export {
  maskCustomerPhone,
  REPORT_GROUP_BY,
  REPORT_MAX_RANGE_DAYS,
  REPORT_MAX_TABLE_ROWS,
  ReportFilterSchema,
  type CashierSalesBreakdownItem,
  type DashboardAttentionCounts,
  type DashboardDailyPoint,
  type DashboardReportResult,
  type OpsAttentionRow,
  type OpsDuplicateBillRow,
  type OpsFlagLineRow,
  type OpsGapInvoiceRow,
  type OpsItemUnavailableRow,
  type OpsNomorKonflikRow,
  type OpsOpenPriceRow,
  type OpsOrphanBillRow,
  type OpsReportResult,
  type OpsReportSections,
  type OpsSelisihHitungRow,
  type OpsStaleHargaRow,
  type PaymentMethodBreakdownItem,
  type ReportFilter,
  type ReportFilterInput,
  type ReportGroupBy,
  type SalesReportGroupRow,
  type SalesReportResult,
  type SalesReportTotals,
  type ShiftNonCashMethodItem,
  type ShiftReportResult,
  type ShiftReportRow,
  type ShiftReportRowStatus,
} from '~/lib/contracts/reports'

export type ReportExportKind = 'sales' | 'shifts' | 'operations'

export interface ReportCsvExportResult {
  readonly filename: string
  readonly csv: string
  readonly rowCount: number
}

export type ReportActionOutcome<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly busy: true; readonly errorKey: 'admin.report.busy' }
