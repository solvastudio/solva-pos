import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { toCsv } from '~/lib/format/csv'
import { addMoney, toMoney, ZERO } from '~/lib/kernel'
import { withTenantReadOnly, type TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import {
  ReportFilterSchema,
  type DashboardDailyPoint,
  type DashboardReportResult,
  type OpsReportResult,
  type ReportCsvExportResult,
  type ReportExportKind,
  type ReportFilter,
  type ReportFilterInput,
  type SalesReportResult,
  type ShiftReportResult,
} from '../shared'
import { querySalesReport } from './r01-sales.repo'
import { queryShiftReport } from './r03-shifts.repo'
import { queryDashboardAttentionCounts, queryOpsReport } from './r04-ops.repo'
import { withReportSlot } from './report-slot'

export interface ReportActorContext {
  readonly tenantId: string
  readonly appUserId: string
  readonly outletIds?: readonly string[] | null
  readonly permissions: ReadonlySet<string> | readonly string[]
}

export function hasReportPermission(actor: ReportActorContext, code: string): boolean {
  return actor.permissions instanceof Set
    ? actor.permissions.has(code)
    : (actor.permissions as readonly string[]).includes(code)
}

function parseReportFilterOrThrow(raw: ReportFilterInput): ReportFilter {
  const parsed = ReportFilterSchema.safeParse(raw)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join('; ')
    throw new AppError('VALIDATION_FAILED', msg || 'Invalid report filter')
  }
  return parsed.data
}

async function resolveScopedOutletIds(
  tx: TenantTx,
  actor: ReportActorContext,
  requestedOutletIds: readonly string[],
): Promise<string[]> {
  if (!hasReportPermission(actor, 'report.view')) {
    throw new AppError('FORBIDDEN', 'Missing permission report.view')
  }

  const allowedScope = actor.outletIds ?? null
  if (allowedScope !== null) {
    const allowedSet = new Set(allowedScope.map((id) => id.toLowerCase()))
    if (requestedOutletIds.length > 0) {
      for (const reqId of requestedOutletIds) {
        if (!allowedSet.has(reqId.toLowerCase())) {
          throw new AppError('FORBIDDEN', `Outlet ${reqId} is outside actor outlet scope`)
        }
      }
      return [...requestedOutletIds]
    }
    return [...allowedScope]
  }

  if (requestedOutletIds.length > 0) {
    return [...requestedOutletIds]
  }

  const res = await tx.execute(
    sql`SELECT id FROM outlet WHERE tenant_id = ${actor.tenantId}::uuid ORDER BY code ASC`,
  )
  return (res.rows as Array<{ id: string }>).map((r) => r.id)
}

export async function getSalesReport(
  actor: ReportActorContext,
  filterInput: ReportFilterInput,
): Promise<SalesReportResult> {
  const filter = parseReportFilterOrThrow(filterInput)
  return withReportSlot(actor.tenantId, () =>
    withTenantReadOnly(actor.tenantId, async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '15s'`))
      const outletIds = await resolveScopedOutletIds(tx, actor, filter.outletIds)
      return querySalesReport(tx, {
        tenantId: actor.tenantId,
        outletIds,
        from: filter.from,
        to: filter.to,
        groupBy: filter.groupBy,
        cashierId: filter.cashierId ?? null,
        registerId: filter.registerId ?? null,
      })
    }),
  )
}

export async function getShiftReport(
  actor: ReportActorContext,
  filterInput: ReportFilterInput,
): Promise<ShiftReportResult> {
  const filter = parseReportFilterOrThrow(filterInput)
  return withReportSlot(actor.tenantId, () =>
    withTenantReadOnly(actor.tenantId, async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '15s'`))
      const outletIds = await resolveScopedOutletIds(tx, actor, filter.outletIds)
      return queryShiftReport(tx, {
        tenantId: actor.tenantId,
        outletIds,
        from: filter.from,
        to: filter.to,
        cashierId: filter.cashierId ?? null,
        registerId: filter.registerId ?? null,
      })
    }),
  )
}

export async function getOpsReport(
  actor: ReportActorContext,
  filterInput: ReportFilterInput,
): Promise<OpsReportResult> {
  const filter = parseReportFilterOrThrow(filterInput)
  return withReportSlot(actor.tenantId, () =>
    withTenantReadOnly(actor.tenantId, async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '15s'`))
      const outletIds = await resolveScopedOutletIds(tx, actor, filter.outletIds)
      return queryOpsReport(tx, {
        tenantId: actor.tenantId,
        outletIds,
        from: filter.from,
        to: filter.to,
        canViewCustomerPhone: hasReportPermission(actor, 'customer.view_phone'),
      })
    }),
  )
}

export async function getDashboard(
  actor: ReportActorContext,
  filterInput: ReportFilterInput,
): Promise<DashboardReportResult> {
  const filter = parseReportFilterOrThrow({ ...filterInput, groupBy: 'DAY' })
  return withReportSlot(actor.tenantId, () =>
    withTenantReadOnly(actor.tenantId, async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '15s'`))
      const outletIds = await resolveScopedOutletIds(tx, actor, filter.outletIds)

      const sales = await querySalesReport(tx, {
        tenantId: actor.tenantId,
        outletIds,
        from: filter.from,
        to: filter.to,
        groupBy: 'DAY',
        cashierId: filter.cashierId ?? null,
        registerId: filter.registerId ?? null,
      })
      const shifts = await queryShiftReport(tx, {
        tenantId: actor.tenantId,
        outletIds,
        from: filter.from,
        to: filter.to,
        cashierId: filter.cashierId ?? null,
        registerId: filter.registerId ?? null,
      })
      const attentionCounts = await queryDashboardAttentionCounts(tx, {
        tenantId: actor.tenantId,
        outletIds,
        from: filter.from,
        to: filter.to,
      })

      const dailyMap = new Map<
        string,
        {
          businessDate: string
          netSales: number
          totalReceived: number
          returns: number
          transactionCount: number
        }
      >()
      for (const r of sales.rows) {
        const cur = dailyMap.get(r.periodKey)
        if (cur) {
          cur.netSales = addMoney(toMoney(cur.netSales), toMoney(r.netSales))
          cur.totalReceived = addMoney(toMoney(cur.totalReceived), toMoney(r.totalReceived))
          cur.returns = addMoney(toMoney(cur.returns), toMoney(r.returns))
          cur.transactionCount += r.transactionCount
        } else {
          dailyMap.set(r.periodKey, {
            businessDate: r.periodKey,
            netSales: addMoney(ZERO, toMoney(r.netSales)),
            totalReceived: addMoney(ZERO, toMoney(r.totalReceived)),
            returns: addMoney(ZERO, toMoney(r.returns)),
            transactionCount: r.transactionCount,
          })
        }
      }
      const dailySeries: DashboardDailyPoint[] = [...dailyMap.values()].sort((a, b) =>
        a.businessDate.localeCompare(b.businessDate),
      )

      return {
        kpis: {
          netSales: sales.totals.netSales,
          totalReceived: sales.totals.totalReceived,
          transactionCount: sales.totals.transactionCount,
          voidCount: sales.totals.voidCount,
          averageTransaction: sales.totals.averageTransaction,
          returns: sales.totals.returns,
        },
        dailySeries,
        byPaymentMethod: sales.byPaymentMethod,
        recentShifts: shifts.rows.slice(0, 10),
        attentionCounts,
      }
    }),
  )
}

export async function exportReportCsv(
  actor: ReportActorContext,
  kind: ReportExportKind,
  filterInput: ReportFilterInput,
): Promise<ReportCsvExportResult> {
  const filter = parseReportFilterOrThrow(filterInput)
  const filename = `solva-${kind}-${filter.from}-${filter.to}.csv`

  if (kind === 'sales') {
    const res = await getSalesReport(actor, filter)
    const headers = [
      'period',
      'outlet_code',
      'outlet_name',
      'transaction_count',
      'gross',
      'discount',
      'net_subtotal',
      'service_charge',
      'tax',
      'rounding',
      'total_received',
      'returns',
      'net_sales',
      'void_count',
    ]
    const rows = res.rows.map((r) => [
      r.periodKey,
      r.outletCode,
      r.outletName,
      r.transactionCount,
      r.gross,
      r.discount,
      r.netSubtotal,
      r.serviceCharge,
      r.tax,
      r.rounding,
      r.totalReceived,
      r.returns,
      r.netSales,
      r.voidCount,
    ])
    return {
      filename,
      csv: toCsv(rows, headers, { withBom: true }),
      rowCount: rows.length,
    }
  }

  if (kind === 'shifts') {
    const res = await getShiftReport(actor, filter)
    const headers = [
      'business_date',
      'register',
      'cashier',
      'opened_at',
      'closed_at',
      'opening_cash',
      'cash_sales',
      'cash_in',
      'cash_out',
      'cash_refunds',
      'expected_cash',
      'counted_cash',
      'variance',
      'non_cash_total',
      'status',
    ]
    const rows = res.rows.map((r) => [
      r.businessDate,
      r.registerLabel,
      r.cashierName,
      r.openedAt,
      r.closedAt ?? '',
      r.openingCash,
      r.cashSales,
      r.cashIn,
      r.cashOut,
      r.cashRefunds,
      r.expectedCash,
      r.countedCash ?? '',
      r.variance ?? '',
      r.nonCashTotal,
      r.status,
    ])
    return {
      filename,
      csv: toCsv(rows, headers, { withBom: true }),
      rowCount: rows.length,
    }
  }

  const res = await getOpsReport(actor, filter)
  const headers = [
    'section',
    'outlet_code',
    'business_date',
    'invoice_no',
    'sku_code',
    'item_name',
    'qty',
    'amount',
    'detail',
    'customer_phone',
  ]
  const rows: Array<Array<string | number | null>> = []
  for (const r of res.sections.staleHarga) {
    rows.push([
      'HARGA_STALE',
      r.outletCode,
      r.businessDate,
      r.invoiceNo,
      r.skuCode,
      r.itemName,
      r.qty,
      r.diffAmount,
      `unit=${r.unitPrice}`,
      r.customerPhone,
    ])
  }
  for (const r of res.sections.itemNonaktifTarifBeda) {
    rows.push([
      r.flagCode,
      r.outletCode,
      r.businessDate,
      r.invoiceNo,
      r.skuCode,
      r.itemName,
      r.qty,
      r.diffAmount,
      '',
      r.customerPhone,
    ])
  }
  for (const r of res.sections.selisihHitung) {
    rows.push([
      'SELISIH_HITUNG',
      r.outletCode,
      r.businessDate,
      r.invoiceNo,
      '',
      '',
      '',
      r.diffAmount,
      `client=${r.clientTotal ?? ''} server=${r.serverTotal ?? ''}`,
      r.customerPhone,
    ])
  }
  for (const r of res.sections.nomorKonflik) {
    rows.push([
      'NOMOR_KONFLIK',
      r.outletCode,
      r.businessDate,
      r.documentNo,
      '',
      '',
      '',
      null,
      r.originalNo ?? '',
      r.customerPhone,
    ])
  }
  for (const r of res.sections.gapInvoice) {
    rows.push([
      'GAP_INVOICE',
      r.outletCode,
      r.detectedAt.slice(0, 10),
      `${r.docType} ${r.period} #${r.seqFrom}-${r.seqTo}`,
      '',
      '',
      '',
      null,
      r.reasonText ?? r.status,
      null,
    ])
  }
  for (const r of res.sections.attention) {
    rows.push([
      'ATTENTION',
      r.outletCode,
      r.createdAt.slice(0, 10),
      r.invoiceNo ?? r.commandId,
      '',
      '',
      '',
      r.totalDue,
      `${r.reasonClass}:${r.reasonCode}`,
      null,
    ])
  }
  for (const r of res.sections.itemTidakTersedia) {
    rows.push([
      'ITEM_TIDAK_TERSEDIA',
      r.outletCode,
      r.businessDate,
      r.invoiceNo,
      r.skuCode,
      r.itemName,
      r.qty,
      r.lineGross,
      `unit=${r.unitPrice}`,
      r.customerPhone,
    ])
  }
  for (const r of res.sections.openPrice) {
    rows.push([
      'OPEN_PRICE',
      r.outletCode,
      r.businessDate,
      r.invoiceNo,
      r.skuCode,
      r.itemName,
      r.qty,
      r.lineGross,
      `cashier=${r.cashierName}`,
      r.customerPhone,
    ])
  }
  for (const r of res.sections.orphanBills) {
    rows.push([
      'ORPHAN_BILL',
      r.outletCode,
      r.lastEventAt.slice(0, 10),
      r.billRef,
      r.tableCode,
      r.leaseDeviceName,
      String(r.itemCount),
      r.estimatedTotal,
      r.deviceRevokedAt ? `revoked=${r.deviceRevokedAt.slice(0, 10)}` : `ageHours=${r.ageHours}`,
      null,
    ])
  }
  for (const r of res.sections.duplicateBills) {
    rows.push([
      'BILL_GANDA_MEJA',
      r.outletCode,
      r.businessDate,
      r.billRef ?? r.billId,
      r.tableCode ?? '',
      r.leaseDeviceName ?? '',
      String(r.openCount),
      null,
      r.billStatus ?? '',
      null,
    ])
  }

  return {
    filename,
    csv: toCsv(rows, headers, { withBom: true }),
    rowCount: rows.length,
  }
}

export const exportCsv = exportReportCsv
