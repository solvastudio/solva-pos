import '@tanstack/react-start/server-only'
import { sql, type SQL } from 'drizzle-orm'
import { addMoney, subMoney, toMoney, ZERO } from '~/lib/kernel'
import type { TenantTx } from '~/server/db'
import {
  REPORT_MAX_TABLE_ROWS,
  type ShiftNonCashMethodItem,
  type ShiftReportResult,
  type ShiftReportRow,
  type ShiftReportRowStatus,
} from '../shared'
import { toSafeReportMoney } from './r01-sales.repo'

export interface ShiftReportQueryInput {
  readonly tenantId: string
  readonly outletIds: readonly string[]
  readonly from: string
  readonly to: string
  readonly cashierId?: string | null
  readonly registerId?: string | null
}

function resolveShiftRowStatus(
  shiftStatus: string,
  recapStatus: string,
): ShiftReportRowStatus {
  if (shiftStatus === 'FORCE_CLOSED') return 'FORCE_CLOSED'
  if (shiftStatus === 'OPEN') return 'OPEN'
  if (shiftStatus === 'CLOSED' && recapStatus === 'COMPLETE') return 'COMPLETE'
  return 'INCOMPLETE'
}

export async function queryShiftReport(
  tx: TenantTx,
  input: ShiftReportQueryInput,
): Promise<ShiftReportResult> {
  if (input.outletIds.length === 0) {
    return { rows: [], truncated: false }
  }

  const outletIdSqlList = sql.join(
    input.outletIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )

  const extraPredicates: SQL[] = []
  if (input.cashierId) {
    extraPredicates.push(sql`AND sh.created_by = ${input.cashierId}::uuid`)
  }
  if (input.registerId) {
    extraPredicates.push(sql`AND sh.register_id = ${input.registerId}::uuid`)
  }
  const extraSql =
    extraPredicates.length > 0 ? sql.join(extraPredicates, sql` `) : sql.raw('')

  const shiftRes = await tx.execute(sql`
    SELECT
      sh.id AS shift_id,
      sh.outlet_id,
      o.code AS outlet_code,
      o.name AS outlet_name,
      o.timezone AS outlet_timezone,
      sh.register_id,
      r.code AS register_code,
      r.name AS register_name,
      sh.created_by AS cashier_id,
      COALESCE(u.display_name, sh.created_by::text) AS cashier_name,
      to_char(sh.business_date, 'YYYY-MM-DD') AS business_date,
      sh.occurred_at AS opened_at,
      sh.closed_at,
      sh.opening_cash,
      sh.counted_cash,
      sh.status AS shift_status,
      sh.recap_status,
      COALESCE((
        SELECT SUM(sp.amount_applied)::bigint
        FROM sale_payment sp
        JOIN sale s ON s.tenant_id = sp.tenant_id AND s.id = sp.sale_id
        WHERE sp.tenant_id = sh.tenant_id
          AND sp.shift_id = sh.id
          AND sp.method_kind = 'CASH'
          AND s.status = 'PAID'
      ), 0)::bigint AS cash_sales,
      COALESCE((
        SELECT SUM(cm.amount) FILTER (WHERE cm.direction = 'IN')::bigint
        FROM cash_movement cm
        WHERE cm.tenant_id = sh.tenant_id AND cm.shift_id = sh.id
      ), 0)::bigint AS cash_in,
      COALESCE((
        SELECT SUM(cm.amount) FILTER (WHERE cm.direction = 'OUT')::bigint
        FROM cash_movement cm
        WHERE cm.tenant_id = sh.tenant_id AND cm.shift_id = sh.id
      ), 0)::bigint AS cash_out,
      COALESCE((
        SELECT SUM(cnr.amount_applied)::bigint
        FROM credit_note_refund cnr
        JOIN credit_note cn ON cn.tenant_id = cnr.tenant_id AND cn.id = cnr.credit_note_id
        WHERE cnr.tenant_id = sh.tenant_id
          AND cnr.shift_id = sh.id
          AND cnr.method_kind = 'CASH'
          AND cn.status = 'POSTED'
      ), 0)::bigint AS cash_refunds
    FROM cash_cashier sh
    JOIN outlet o ON o.tenant_id = sh.tenant_id AND o.id = sh.outlet_id
    JOIN cash_master r ON r.tenant_id = sh.tenant_id AND r.id = sh.register_id
    LEFT JOIN app_user u ON u.id = sh.created_by
    WHERE sh.tenant_id = ${input.tenantId}::uuid
      AND sh.business_date BETWEEN ${input.from}::date AND ${input.to}::date
      AND sh.outlet_id IN (${outletIdSqlList})
      ${extraSql}
    ORDER BY sh.business_date DESC, sh.occurred_at DESC
    LIMIT ${REPORT_MAX_TABLE_ROWS + 1}
  `)

  const rawRows = shiftRes.rows as Array<{
    shift_id: string
    outlet_id: string
    outlet_code: string
    outlet_name: string
    outlet_timezone: string
    register_id: string
    register_code: string
    register_name: string
    cashier_id: string
    cashier_name: string
    business_date: string
    opened_at: string
    closed_at: string | null
    opening_cash: string | number
    counted_cash: string | number | null
    shift_status: string
    recap_status: string
    cash_sales: string | number
    cash_in: string | number
    cash_out: string | number
    cash_refunds: string | number
  }>

  const truncated = rawRows.length > REPORT_MAX_TABLE_ROWS
  const boundedRows = truncated ? rawRows.slice(0, REPORT_MAX_TABLE_ROWS) : rawRows

  const nonCashMap = new Map<string, ShiftNonCashMethodItem[]>()
  if (boundedRows.length > 0) {
    const shiftIdsSql = sql.join(
      boundedRows.map((r) => sql`${r.shift_id}::uuid`),
      sql`, `,
    )
    const nonCashRes = await tx.execute(sql`
      SELECT
        sp.shift_id,
        sp.method_code,
        MAX(sp.method_name) AS method_name,
        COALESCE(SUM(sp.amount_applied), 0)::bigint AS amount_applied
      FROM sale_payment sp
      JOIN sale s ON s.tenant_id = sp.tenant_id AND s.id = sp.sale_id
      WHERE sp.tenant_id = ${input.tenantId}::uuid
        AND sp.shift_id IN (${shiftIdsSql})
        AND sp.method_kind = 'NON_CASH'
        AND s.status = 'PAID'
      GROUP BY sp.shift_id, sp.method_code
      ORDER BY sp.method_code ASC
    `)

    for (const nc of nonCashRes.rows as Array<{
      shift_id: string
      method_code: string
      method_name: string
      amount_applied: string | number
    }>) {
      const k = nc.shift_id.toLowerCase()
      const list = nonCashMap.get(k) ?? []
      list.push({
        methodCode: nc.method_code,
        methodName: nc.method_name,
        amountApplied: toSafeReportMoney(nc.amount_applied),
      })
      nonCashMap.set(k, list)
    }
  }

  const rows: ShiftReportRow[] = boundedRows.map((r) => {
    const openingCash = toMoney(toSafeReportMoney(r.opening_cash))
    const cashSales = toMoney(toSafeReportMoney(r.cash_sales))
    const cashIn = toMoney(toSafeReportMoney(r.cash_in))
    const cashOut = toMoney(toSafeReportMoney(r.cash_out))
    const cashRefunds = toMoney(toSafeReportMoney(r.cash_refunds))

    const expectedCash = subMoney(
      subMoney(addMoney(addMoney(openingCash, cashSales), cashIn), cashOut),
      cashRefunds,
    )
    const countedCash =
      r.counted_cash !== null && r.counted_cash !== undefined
        ? toMoney(toSafeReportMoney(r.counted_cash))
        : null
    const variance = countedCash !== null ? subMoney(countedCash, expectedCash) : null

    const nonCashByMethod = nonCashMap.get(r.shift_id.toLowerCase()) ?? []
    let nonCashTotal = ZERO
    for (const item of nonCashByMethod) {
      nonCashTotal = addMoney(nonCashTotal, toMoney(item.amountApplied))
    }

    const tz =
      r.outlet_timezone === 'Asia/Makassar' || r.outlet_timezone === 'Asia/Jayapura'
        ? r.outlet_timezone
        : 'Asia/Jakarta'

    return {
      shiftId: r.shift_id,
      outletId: r.outlet_id,
      outletCode: r.outlet_code,
      outletName: r.outlet_name,
      outletTimezone: tz,
      registerId: r.register_id,
      registerCode: r.register_code,
      registerName: r.register_name,
      registerLabel: `${r.outlet_code}-${r.register_code}`,
      cashierId: r.cashier_id,
      cashierName: r.cashier_name,
      businessDate: r.business_date,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
      openingCash,
      cashSales,
      cashIn,
      cashOut,
      cashRefunds,
      expectedCash,
      countedCash,
      variance,
      nonCashTotal,
      nonCashByMethod,
      shiftStatus:
        r.shift_status === 'FORCE_CLOSED'
          ? 'FORCE_CLOSED'
          : r.shift_status === 'CLOSED'
            ? 'CLOSED'
            : 'OPEN',
      recapStatus: r.recap_status === 'COMPLETE' ? 'COMPLETE' : 'INCOMPLETE',
      status: resolveShiftRowStatus(r.shift_status, r.recap_status),
    }
  })

  return { rows, truncated }
}
