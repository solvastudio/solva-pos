import '@tanstack/react-start/server-only'
import { sql, type SQL } from 'drizzle-orm'
import {
  addMoney,
  D,
  roundHalfUp,
  subMoney,
  toMoney,
  ZERO,
} from '~/lib/kernel'
import type { TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import {
  REPORT_MAX_TABLE_ROWS,
  type CashierSalesBreakdownItem,
  type PaymentMethodBreakdownItem,
  type ReportGroupBy,
  type SalesReportGroupRow,
  type SalesReportResult,
  type SalesReportTotals,
} from '../shared'

export function toSafeReportMoney(val: string | number | bigint | null | undefined): number {
  if (val === null || val === undefined || val === '') return 0
  let big: bigint
  try {
    big = typeof val === 'bigint' ? val : BigInt(String(val))
  } catch {
    throw new AppError('INTERNAL_ERROR', `Invalid integer money aggregate: ${String(val)}`)
  }
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER)
  if (big > maxSafe || big < -maxSafe) {
    throw new AppError('INTERNAL_ERROR', 'Report total exceeds Number.MAX_SAFE_INTEGER')
  }
  const num = Number(big)
  return num === 0 ? 0 : num
}

function periodExpr(col: SQL, groupBy: ReportGroupBy): SQL {
  if (groupBy === 'WEEK') {
    return sql`to_char(date_trunc('week', ${col}::timestamp)::date, 'YYYY-MM-DD')`
  }
  if (groupBy === 'MONTH') {
    return sql`to_char(date_trunc('month', ${col}::timestamp)::date, 'YYYY-MM')`
  }
  return sql`to_char(${col}, 'YYYY-MM-DD')`
}

export interface SalesReportQueryInput {
  readonly tenantId: string
  readonly outletIds: readonly string[]
  readonly from: string
  readonly to: string
  readonly groupBy: ReportGroupBy
  readonly cashierId?: string | null
  readonly registerId?: string | null
}

export async function querySalesReport(
  tx: TenantTx,
  input: SalesReportQueryInput,
): Promise<SalesReportResult> {
  if (input.outletIds.length === 0) {
    return {
      rows: [],
      totals: {
        transactionCount: 0,
        voidCount: 0,
        gross: 0,
        discount: 0,
        netSubtotal: 0,
        serviceCharge: 0,
        tax: 0,
        rounding: 0,
        totalReceived: 0,
        returns: 0,
        netSales: 0,
        netBeforeTax: 0,
        netTax: 0,
        netRounding: 0,
        averageTransaction: 0,
      },
      byPaymentMethod: [],
      byCashier: [],
      truncated: false,
    }
  }

  const outletIdSqlList = sql.join(
    input.outletIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )

  const saleExtraPredicates: SQL[] = []
  const cnExtraPredicates: SQL[] = []
  if (input.cashierId) {
    saleExtraPredicates.push(sql`AND s.created_by = ${input.cashierId}::uuid`)
    cnExtraPredicates.push(sql`AND cn.created_by = ${input.cashierId}::uuid`)
  }
  if (input.registerId) {
    saleExtraPredicates.push(sql`AND s.register_id = ${input.registerId}::uuid`)
    cnExtraPredicates.push(sql`AND cn.register_id = ${input.registerId}::uuid`)
  }
  const saleExtraSql =
    saleExtraPredicates.length > 0 ? sql.join(saleExtraPredicates, sql` `) : sql.raw('')
  const cnExtraSql =
    cnExtraPredicates.length > 0 ? sql.join(cnExtraPredicates, sql` `) : sql.raw('')

  const salePeriodSql = periodExpr(sql`s.business_date`, input.groupBy)
  const cnPeriodSql = periodExpr(sql`cn.business_date`, input.groupBy)

  const groupRes = await tx.execute(sql`
    WITH sale_agg AS (
      SELECT
        ${salePeriodSql} AS period_key,
        s.outlet_id,
        COUNT(*) FILTER (WHERE s.status = 'PAID')::bigint AS tx_count,
        COUNT(*) FILTER (WHERE s.status = 'VOID')::bigint AS void_count,
        COALESCE(SUM(s.gross_total) FILTER (WHERE s.status = 'PAID'), 0)::bigint AS gross,
        COALESCE(SUM(s.line_discount_total + s.bill_discount_total) FILTER (WHERE s.status = 'PAID'), 0)::bigint AS discount,
        COALESCE(SUM(s.net_subtotal) FILTER (WHERE s.status = 'PAID'), 0)::bigint AS net_subtotal,
        COALESCE(SUM(s.service_charge) FILTER (WHERE s.status = 'PAID'), 0)::bigint AS service_charge,
        COALESCE(SUM(s.tax_amount) FILTER (WHERE s.status = 'PAID'), 0)::bigint AS tax,
        COALESCE(SUM(s.rounding) FILTER (WHERE s.status = 'PAID'), 0)::bigint AS rounding,
        COALESCE(SUM(s.total_due) FILTER (WHERE s.status = 'PAID'), 0)::bigint AS total_received
      FROM sale s
      WHERE s.tenant_id = ${input.tenantId}::uuid
        AND s.business_date BETWEEN ${input.from}::date AND ${input.to}::date
        AND s.outlet_id IN (${outletIdSqlList})
        ${saleExtraSql}
      GROUP BY 1, 2
    ),
    cn_agg AS (
      SELECT
        ${cnPeriodSql} AS period_key,
        cn.outlet_id,
        COALESCE(SUM(cn.net_total), 0)::bigint AS cn_net,
        COALESCE(SUM(cn.service_total), 0)::bigint AS cn_service,
        COALESCE(SUM(cn.tax_total), 0)::bigint AS cn_tax,
        COALESCE(SUM(cn.rounding), 0)::bigint AS cn_rounding,
        COALESCE(SUM(cn.refund_total), 0)::bigint AS cn_refund
      FROM credit_note cn
      WHERE cn.tenant_id = ${input.tenantId}::uuid
        AND cn.status = 'POSTED'
        AND cn.business_date BETWEEN ${input.from}::date AND ${input.to}::date
        AND cn.outlet_id IN (${outletIdSqlList})
        ${cnExtraSql}
      GROUP BY 1, 2
    ),
    combined_keys AS (
      SELECT period_key, outlet_id FROM sale_agg
      UNION
      SELECT period_key, outlet_id FROM cn_agg
    )
    SELECT
      ck.period_key,
      ck.outlet_id,
      o.code AS outlet_code,
      o.name AS outlet_name,
      COALESCE(sa.tx_count, 0) AS tx_count,
      COALESCE(sa.void_count, 0) AS void_count,
      COALESCE(sa.gross, 0) AS gross,
      COALESCE(sa.discount, 0) AS discount,
      COALESCE(sa.net_subtotal, 0) AS net_subtotal,
      COALESCE(sa.service_charge, 0) AS service_charge,
      COALESCE(sa.tax, 0) AS tax,
      COALESCE(sa.rounding, 0) AS rounding,
      COALESCE(sa.total_received, 0) AS total_received,
      COALESCE(ca.cn_net, 0) AS cn_net,
      COALESCE(ca.cn_service, 0) AS cn_service,
      COALESCE(ca.cn_tax, 0) AS cn_tax,
      COALESCE(ca.cn_rounding, 0) AS cn_rounding,
      COALESCE(ca.cn_refund, 0) AS cn_refund
    FROM combined_keys ck
    JOIN outlet o ON o.tenant_id = ${input.tenantId}::uuid AND o.id = ck.outlet_id
    LEFT JOIN sale_agg sa ON sa.period_key = ck.period_key AND sa.outlet_id = ck.outlet_id
    LEFT JOIN cn_agg ca ON ca.period_key = ck.period_key AND ca.outlet_id = ck.outlet_id
    ORDER BY ck.period_key ASC, o.code ASC
    LIMIT ${REPORT_MAX_TABLE_ROWS + 1}
  `)

  const paymentRes = await tx.execute(sql`
    SELECT
      ${salePeriodSql} AS period_key,
      s.outlet_id,
      sp.method_code,
      MAX(sp.method_name) AS method_name,
      sp.method_kind,
      COALESCE(SUM(sp.amount_applied), 0)::bigint AS amount_applied,
      COUNT(DISTINCT s.id)::bigint AS tx_count
    FROM sale_payment sp
    JOIN sale s ON s.tenant_id = sp.tenant_id AND s.id = sp.sale_id
    WHERE s.tenant_id = ${input.tenantId}::uuid
      AND s.status = 'PAID'
      AND s.business_date BETWEEN ${input.from}::date AND ${input.to}::date
      AND s.outlet_id IN (${outletIdSqlList})
      ${saleExtraSql}
    GROUP BY 1, 2, 3, 5
    ORDER BY sp.method_kind ASC, sp.method_code ASC
  `)

  const cashierRes = await tx.execute(sql`
    SELECT
      s.created_by AS cashier_id,
      COALESCE(u.display_name, s.created_by::text) AS cashier_name,
      COUNT(*)::bigint AS tx_count,
      COALESCE(SUM(s.total_due), 0)::bigint AS total_received
    FROM sale s
    LEFT JOIN app_user u ON u.id = s.created_by
    WHERE s.tenant_id = ${input.tenantId}::uuid
      AND s.status = 'PAID'
      AND s.business_date BETWEEN ${input.from}::date AND ${input.to}::date
      AND s.outlet_id IN (${outletIdSqlList})
      ${saleExtraSql}
    GROUP BY s.created_by, u.display_name
    ORDER BY total_received DESC, cashier_name ASC
  `)

  const paymentsByGroupKey = new Map<string, PaymentMethodBreakdownItem[]>()
  const overallPaymentMap = new Map<
    string,
    {
      methodCode: string
      methodName: string
      methodKind: 'CASH' | 'NON_CASH'
      amountApplied: number
      transactionCount: number
    }
  >()

  for (const raw of paymentRes.rows as Array<{
    period_key: string
    outlet_id: string
    method_code: string
    method_name: string
    method_kind: string
    amount_applied: string | number
    tx_count: string | number
  }>) {
    const key = `${raw.period_key}::${raw.outlet_id.toLowerCase()}`
    const amountApplied = toSafeReportMoney(raw.amount_applied)
    const transactionCount = toSafeReportMoney(raw.tx_count)
    const methodKind: 'CASH' | 'NON_CASH' = raw.method_kind === 'CASH' ? 'CASH' : 'NON_CASH'
    const item: PaymentMethodBreakdownItem = {
      methodCode: raw.method_code,
      methodName: raw.method_name,
      methodKind,
      amountApplied,
      transactionCount,
    }
    const list = paymentsByGroupKey.get(key) ?? []
    list.push(item)
    paymentsByGroupKey.set(key, list)

    const existing = overallPaymentMap.get(raw.method_code)
    if (existing) {
      existing.amountApplied = addMoney(toMoney(existing.amountApplied), toMoney(amountApplied))
      existing.transactionCount += transactionCount
    } else {
      overallPaymentMap.set(raw.method_code, { ...item })
    }
  }

  const rawRows = groupRes.rows as Array<{
    period_key: string
    outlet_id: string
    outlet_code: string
    outlet_name: string
    tx_count: string | number
    void_count: string | number
    gross: string | number
    discount: string | number
    net_subtotal: string | number
    service_charge: string | number
    tax: string | number
    rounding: string | number
    total_received: string | number
    cn_net: string | number
    cn_service: string | number
    cn_tax: string | number
    cn_rounding: string | number
    cn_refund: string | number
  }>

  const truncated = rawRows.length > REPORT_MAX_TABLE_ROWS
  const boundedRows = truncated ? rawRows.slice(0, REPORT_MAX_TABLE_ROWS) : rawRows

  let totalTxCount = 0
  let totalVoidCount = 0
  let totalGross = ZERO
  let totalDiscount = ZERO
  let totalNetSubtotal = ZERO
  let totalServiceCharge = ZERO
  let totalTax = ZERO
  let totalRounding = ZERO
  let totalReceivedAcc = ZERO
  let totalReturns = ZERO
  let totalNetSales = ZERO
  let totalNetBeforeTax = ZERO
  let totalNetTax = ZERO
  let totalNetRounding = ZERO

  const rows: SalesReportGroupRow[] = boundedRows.map((r) => {
    const transactionCount = toSafeReportMoney(r.tx_count)
    const voidCount = toSafeReportMoney(r.void_count)
    const gross = toMoney(toSafeReportMoney(r.gross))
    const discount = toMoney(toSafeReportMoney(r.discount))
    const netSubtotal = toMoney(toSafeReportMoney(r.net_subtotal))
    const serviceCharge = toMoney(toSafeReportMoney(r.service_charge))
    const tax = toMoney(toSafeReportMoney(r.tax))
    const rounding = toMoney(toSafeReportMoney(r.rounding))
    const totalReceived = toMoney(toSafeReportMoney(r.total_received))

    const cnNet = toMoney(toSafeReportMoney(r.cn_net))
    const cnService = toMoney(toSafeReportMoney(r.cn_service))
    const cnTax = toMoney(toSafeReportMoney(r.cn_tax))
    const cnRounding = toMoney(toSafeReportMoney(r.cn_rounding))
    const returns = toMoney(toSafeReportMoney(r.cn_refund))

    const netSales = subMoney(totalReceived, returns)
    const netBeforeTax = subMoney(addMoney(netSubtotal, serviceCharge), addMoney(cnNet, cnService))
    const netTax = subMoney(tax, cnTax)
    const netRounding = subMoney(rounding, cnRounding)

    totalTxCount += transactionCount
    totalVoidCount += voidCount
    totalGross = addMoney(totalGross, gross)
    totalDiscount = addMoney(totalDiscount, discount)
    totalNetSubtotal = addMoney(totalNetSubtotal, netSubtotal)
    totalServiceCharge = addMoney(totalServiceCharge, serviceCharge)
    totalTax = addMoney(totalTax, tax)
    totalRounding = addMoney(totalRounding, rounding)
    totalReceivedAcc = addMoney(totalReceivedAcc, totalReceived)
    totalReturns = addMoney(totalReturns, returns)
    totalNetSales = addMoney(totalNetSales, netSales)
    totalNetBeforeTax = addMoney(totalNetBeforeTax, netBeforeTax)
    totalNetTax = addMoney(totalNetTax, netTax)
    totalNetRounding = addMoney(totalNetRounding, netRounding)

    const groupKey = `${r.period_key}::${r.outlet_id.toLowerCase()}`
    return {
      periodKey: r.period_key,
      outletId: r.outlet_id,
      outletCode: r.outlet_code,
      outletName: r.outlet_name,
      transactionCount,
      voidCount,
      gross,
      discount,
      netSubtotal,
      serviceCharge,
      tax,
      rounding,
      totalReceived,
      returns,
      netSales,
      netBeforeTax,
      netTax,
      netRounding,
      byPaymentMethod: paymentsByGroupKey.get(groupKey) ?? [],
    }
  })

  const averageTransaction =
    totalTxCount > 0 ? roundHalfUp(new D(totalReceivedAcc).div(totalTxCount)) : 0

  const totals: SalesReportTotals = {
    transactionCount: totalTxCount,
    voidCount: totalVoidCount,
    gross: totalGross,
    discount: totalDiscount,
    netSubtotal: totalNetSubtotal,
    serviceCharge: totalServiceCharge,
    tax: totalTax,
    rounding: totalRounding,
    totalReceived: totalReceivedAcc,
    returns: totalReturns,
    netSales: totalNetSales,
    netBeforeTax: totalNetBeforeTax,
    netTax: totalNetTax,
    netRounding: totalNetRounding,
    averageTransaction,
  }

  const byCashier: CashierSalesBreakdownItem[] = (
    cashierRes.rows as Array<{
      cashier_id: string
      cashier_name: string
      tx_count: string | number
      total_received: string | number
    }>
  ).map((c) => ({
    cashierId: c.cashier_id,
    cashierName: c.cashier_name,
    transactionCount: toSafeReportMoney(c.tx_count),
    totalReceived: toSafeReportMoney(c.total_received),
  }))

  return {
    rows,
    totals,
    byPaymentMethod: [...overallPaymentMap.values()],
    byCashier,
    truncated,
  }
}
