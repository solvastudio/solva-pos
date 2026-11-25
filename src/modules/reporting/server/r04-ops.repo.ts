import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import type { TenantTx } from '~/server/db'
import {
  maskCustomerPhone,
  type DashboardAttentionCounts,
  type OpsAttentionRow,
  type OpsDuplicateBillRow,
  type OpsFlagLineRow,
  type OpsGapInvoiceRow,
  type OpsItemUnavailableRow,
  type OpsNomorKonflikRow,
  type OpsOpenPriceRow,
  type OpsOrphanBillRow,
  type OpsReportResult,
  type OpsSelisihHitungRow,
  type OpsStaleHargaRow,
} from '../shared'
import { toSafeReportMoney } from './r01-sales.repo'

export interface OpsReportQueryInput {
  readonly tenantId: string
  readonly outletIds: readonly string[]
  readonly from: string
  readonly to: string
  readonly canViewCustomerPhone: boolean
}

function readOptionalMoneyFromJson(
  detail: unknown,
  keys: readonly string[],
): number | null {
  if (!detail || typeof detail !== 'object') return null
  const rec = detail as Record<string, unknown>
  for (const k of keys) {
    const v = rec[k]
    if (typeof v === 'number' && Number.isFinite(v)) {
      return toSafeReportMoney(Math.trunc(v))
    }
    if (typeof v === 'string' && /^-?\d+$/.test(v)) {
      return toSafeReportMoney(v)
    }
  }
  return null
}

function readOptionalStringFromJson(
  detail: unknown,
  keys: readonly string[],
): string | null {
  if (!detail || typeof detail !== 'object') return null
  const rec = detail as Record<string, unknown>
  for (const k of keys) {
    const v = rec[k]
    if (typeof v === 'string' && v.trim().length > 0) {
      return v.trim()
    }
  }
  return null
}

function extractAttentionSummaryFields(
  commandType: string,
  payload: unknown,
): { invoiceNo: string | null; totalDue: number | null } {
  if (!payload || typeof payload !== 'object') {
    return { invoiceNo: null, totalDue: null }
  }
  const p = payload as Record<string, unknown>
  if (commandType === 'FinalizeSale' && p.sale && typeof p.sale === 'object') {
    const s = p.sale as Record<string, unknown>
    const invoiceNo = typeof s.invoice_no === 'string' ? s.invoice_no : null
    const rawTotal = s.total_due ?? s.grand_total
    const totalDue =
      typeof rawTotal === 'number' || typeof rawTotal === 'string'
        ? toSafeReportMoney(rawTotal)
        : null
    return { invoiceNo, totalDue }
  }
  if (commandType === 'FinalizeCreditNote' && p.credit_note && typeof p.credit_note === 'object') {
    const cn = p.credit_note as Record<string, unknown>
    const invoiceNo =
      typeof cn.cn_no === 'string'
        ? cn.cn_no
        : typeof cn.original_invoice_no === 'string'
          ? cn.original_invoice_no
          : null
    const rawTotal = cn.refund_total ?? cn.refund_gross
    const totalDue =
      typeof rawTotal === 'number' || typeof rawTotal === 'string'
        ? toSafeReportMoney(rawTotal)
        : null
    return { invoiceNo, totalDue }
  }
  return { invoiceNo: null, totalDue: null }
}

export async function queryOpsReport(
  tx: TenantTx,
  input: OpsReportQueryInput,
): Promise<OpsReportResult> {
  if (input.outletIds.length === 0) {
    return {
      sections: {
        staleHarga: [],
        itemNonaktifTarifBeda: [],
        selisihHitung: [],
        nomorKonflik: [],
        gapInvoice: [],
        attention: [],
        itemTidakTersedia: [],
        openPrice: [],
        orphanBills: [],
        duplicateBills: [],
      },
    }
  }

  const outletIdSqlList = sql.join(
    input.outletIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )

  // 1. staleHarga (HARGA_STALE)
  const staleRes = await tx.execute(sql`
    SELECT
      df.id AS flag_id,
      df.outlet_id,
      o.code AS outlet_code,
      to_char(df.business_date, 'YYYY-MM-DD') AS business_date,
      s.id AS sale_id,
      s.invoice_no,
      sl.id AS sale_line_id,
      sl.sku_code,
      sl.item_name,
      sl.qty::text AS qty,
      sl.unit_price,
      COALESCE(df.diff_amount, 0)::bigint AS diff_amount,
      s.customer_phone
    FROM data_flag df
    JOIN outlet o ON o.tenant_id = df.tenant_id AND o.id = df.outlet_id
    JOIN sale_line sl ON sl.tenant_id = df.tenant_id AND sl.id = df.entity_id
    JOIN sale s ON s.tenant_id = sl.tenant_id AND s.id = sl.sale_id
    WHERE df.tenant_id = ${input.tenantId}::uuid
      AND df.flag_code = 'HARGA_STALE'
      AND df.business_date BETWEEN ${input.from}::date AND ${input.to}::date
      AND df.outlet_id IN (${outletIdSqlList})
    ORDER BY df.business_date DESC, s.invoice_no ASC, sl.line_no ASC
    LIMIT 1000
  `)

  const staleHarga: OpsStaleHargaRow[] = (
    staleRes.rows as Array<{
      flag_id: string
      outlet_id: string
      outlet_code: string
      business_date: string
      sale_id: string
      invoice_no: string
      sale_line_id: string
      sku_code: string
      item_name: string
      qty: string
      unit_price: string | number
      diff_amount: string | number
      customer_phone: string | null
    }>
  ).map((r) => ({
    flagId: r.flag_id,
    outletId: r.outlet_id,
    outletCode: r.outlet_code,
    businessDate: r.business_date,
    saleId: r.sale_id,
    invoiceNo: r.invoice_no,
    saleLineId: r.sale_line_id,
    skuCode: r.sku_code,
    itemName: r.item_name,
    qty: r.qty,
    unitPrice: toSafeReportMoney(r.unit_price),
    diffAmount: toSafeReportMoney(r.diff_amount),
    customerPhone: maskCustomerPhone(r.customer_phone, input.canViewCustomerPhone),
  }))

  // 2. itemNonaktifTarifBeda (ITEM_NONAKTIF, TARIF_BERBEDA)
  const nonaktifRes = await tx.execute(sql`
    SELECT
      df.id AS flag_id,
      df.flag_code,
      df.outlet_id,
      o.code AS outlet_code,
      to_char(df.business_date, 'YYYY-MM-DD') AS business_date,
      COALESCE(s_direct.id, s_line.id) AS sale_id,
      COALESCE(s_direct.invoice_no, s_line.invoice_no) AS invoice_no,
      sl.sku_code,
      sl.item_name,
      sl.qty::text AS qty,
      sl.unit_price,
      df.diff_amount,
      COALESCE(s_direct.customer_phone, s_line.customer_phone) AS customer_phone
    FROM data_flag df
    JOIN outlet o ON o.tenant_id = df.tenant_id AND o.id = df.outlet_id
    LEFT JOIN sale_line sl
      ON sl.tenant_id = df.tenant_id
      AND df.entity_type = 'SALE_LINE'
      AND sl.id = df.entity_id
    LEFT JOIN sale s_line
      ON s_line.tenant_id = sl.tenant_id
      AND s_line.id = sl.sale_id
    LEFT JOIN sale s_direct
      ON s_direct.tenant_id = df.tenant_id
      AND df.entity_type = 'SALE'
      AND s_direct.id = df.entity_id
    WHERE df.tenant_id = ${input.tenantId}::uuid
      AND df.flag_code IN ('ITEM_NONAKTIF', 'TARIF_BERBEDA')
      AND df.business_date BETWEEN ${input.from}::date AND ${input.to}::date
      AND df.outlet_id IN (${outletIdSqlList})
      AND COALESCE(s_direct.id, s_line.id) IS NOT NULL
    ORDER BY df.business_date DESC, df.created_at DESC
    LIMIT 1000
  `)

  const itemNonaktifTarifBeda: OpsFlagLineRow[] = (
    nonaktifRes.rows as Array<{
      flag_id: string
      flag_code: string
      outlet_id: string
      outlet_code: string
      business_date: string
      sale_id: string
      invoice_no: string
      sku_code: string | null
      item_name: string | null
      qty: string | null
      unit_price: string | number | null
      diff_amount: string | number | null
      customer_phone: string | null
    }>
  ).map((r) => ({
    flagId: r.flag_id,
    flagCode: r.flag_code === 'TARIF_BERBEDA' ? 'TARIF_BERBEDA' : 'ITEM_NONAKTIF',
    outletId: r.outlet_id,
    outletCode: r.outlet_code,
    businessDate: r.business_date,
    saleId: r.sale_id,
    invoiceNo: r.invoice_no,
    skuCode: r.sku_code,
    itemName: r.item_name,
    qty: r.qty,
    unitPrice: r.unit_price !== null ? toSafeReportMoney(r.unit_price) : null,
    diffAmount: r.diff_amount !== null ? toSafeReportMoney(r.diff_amount) : null,
    customerPhone: maskCustomerPhone(r.customer_phone, input.canViewCustomerPhone),
  }))

  // 3. selisihHitung (SELISIH_HITUNG)
  const selisihRes = await tx.execute(sql`
    SELECT
      df.id AS flag_id,
      df.outlet_id,
      o.code AS outlet_code,
      to_char(df.business_date, 'YYYY-MM-DD') AS business_date,
      df.entity_type,
      df.entity_id,
      COALESCE(s.invoice_no, cn.cn_no, df.entity_id::text) AS doc_no,
      COALESCE(df.diff_amount, 0)::bigint AS diff_amount,
      df.detail,
      s.customer_phone
    FROM data_flag df
    JOIN outlet o ON o.tenant_id = df.tenant_id AND o.id = df.outlet_id
    LEFT JOIN sale s
      ON s.tenant_id = df.tenant_id
      AND df.entity_type = 'SALE'
      AND s.id = df.entity_id
    LEFT JOIN credit_note cn
      ON cn.tenant_id = df.tenant_id
      AND df.entity_type = 'CREDIT_NOTE'
      AND cn.id = df.entity_id
    WHERE df.tenant_id = ${input.tenantId}::uuid
      AND df.flag_code = 'SELISIH_HITUNG'
      AND df.business_date BETWEEN ${input.from}::date AND ${input.to}::date
      AND df.outlet_id IN (${outletIdSqlList})
    ORDER BY df.business_date DESC, df.created_at DESC
    LIMIT 1000
  `)

  const selisihHitung: OpsSelisihHitungRow[] = (
    selisihRes.rows as Array<{
      flag_id: string
      outlet_id: string
      outlet_code: string
      business_date: string
      entity_type: string
      entity_id: string
      doc_no: string
      diff_amount: string | number
      detail: unknown
      customer_phone: string | null
    }>
  ).map((r) => ({
    flagId: r.flag_id,
    outletId: r.outlet_id,
    outletCode: r.outlet_code,
    businessDate: r.business_date,
    entityType: r.entity_type === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'SALE',
    entityId: r.entity_id,
    invoiceNo: r.doc_no,
    diffAmount: toSafeReportMoney(r.diff_amount),
    clientTotal: readOptionalMoneyFromJson(r.detail, ['client_total', 'clientTotal', 'client']),
    serverTotal: readOptionalMoneyFromJson(r.detail, ['server_total', 'serverTotal', 'server']),
    customerPhone: maskCustomerPhone(r.customer_phone, input.canViewCustomerPhone),
  }))

  // 4. nomorKonflik (NOMOR_KONFLIK)
  const konflikRes = await tx.execute(sql`
    SELECT
      df.id AS flag_id,
      df.outlet_id,
      o.code AS outlet_code,
      to_char(df.business_date, 'YYYY-MM-DD') AS business_date,
      df.entity_type,
      df.entity_id,
      COALESCE(s.invoice_no, cn.cn_no, df.entity_id::text) AS doc_no,
      df.detail,
      s.customer_phone
    FROM data_flag df
    JOIN outlet o ON o.tenant_id = df.tenant_id AND o.id = df.outlet_id
    LEFT JOIN sale s
      ON s.tenant_id = df.tenant_id
      AND df.entity_type = 'SALE'
      AND s.id = df.entity_id
    LEFT JOIN credit_note cn
      ON cn.tenant_id = df.tenant_id
      AND df.entity_type = 'CREDIT_NOTE'
      AND cn.id = df.entity_id
    WHERE df.tenant_id = ${input.tenantId}::uuid
      AND df.flag_code = 'NOMOR_KONFLIK'
      AND df.business_date BETWEEN ${input.from}::date AND ${input.to}::date
      AND df.outlet_id IN (${outletIdSqlList})
    ORDER BY df.business_date DESC, df.created_at DESC
    LIMIT 1000
  `)

  const nomorKonflik: OpsNomorKonflikRow[] = (
    konflikRes.rows as Array<{
      flag_id: string
      outlet_id: string
      outlet_code: string
      business_date: string
      entity_type: string
      entity_id: string
      doc_no: string
      detail: unknown
      customer_phone: string | null
    }>
  ).map((r) => ({
    flagId: r.flag_id,
    outletId: r.outlet_id,
    outletCode: r.outlet_code,
    businessDate: r.business_date,
    entityType: r.entity_type === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'SALE',
    entityId: r.entity_id,
    documentNo: r.doc_no,
    originalNo: readOptionalStringFromJson(r.detail, [
      'original_invoice_no',
      'original_cn_no',
      'original_no',
      'requested_no',
    ]),
    customerPhone: maskCustomerPhone(r.customer_phone, input.canViewCustomerPhone),
  }))

  // 5. gapInvoice (invoice_gap status <> 'FILLED')
  const gapRes = await tx.execute(sql`
    SELECT
      g.id AS gap_id,
      g.outlet_id,
      o.code AS outlet_code,
      g.register_id,
      r.code AS register_code,
      g.doc_type,
      g.period,
      g.seq_from,
      g.seq_to,
      g.origin,
      g.status,
      g.reason_text,
      g.detected_at
    FROM invoice_gap g
    JOIN outlet o ON o.tenant_id = g.tenant_id AND o.id = g.outlet_id
    JOIN cash_master r ON r.tenant_id = g.tenant_id AND r.id = g.register_id
    WHERE g.tenant_id = ${input.tenantId}::uuid
      AND g.status <> 'FILLED'
      AND g.outlet_id IN (${outletIdSqlList})
    ORDER BY g.detected_at DESC, g.seq_from ASC
    LIMIT 1000
  `)

  const gapInvoice: OpsGapInvoiceRow[] = (
    gapRes.rows as Array<{
      gap_id: string
      outlet_id: string
      outlet_code: string
      register_id: string
      register_code: string
      doc_type: string
      period: string
      seq_from: number
      seq_to: number
      origin: string
      status: string
      reason_text: string | null
      detected_at: string
    }>
  ).map((r) => ({
    gapId: r.gap_id,
    outletId: r.outlet_id,
    outletCode: r.outlet_code,
    registerId: r.register_id,
    registerCode: r.register_code,
    docType: r.doc_type === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'INVOICE',
    period: r.period,
    seqFrom: Number(r.seq_from),
    seqTo: Number(r.seq_to),
    origin: r.origin === 'RECOVERY_DECLARED' ? 'RECOVERY_DECLARED' : 'DETECTED',
    status: r.status === 'EXPLAINED' ? 'EXPLAINED' : 'OPEN',
    reasonText: r.reason_text,
    detectedAt: r.detected_at,
  }))

  // 6. attention (attention_item status IN ('OPEN', 'ESCALATED'))
  const attRes = await tx.execute(sql`
    SELECT
      a.id AS attention_id,
      a.outlet_id,
      o.code AS outlet_code,
      a.register_id,
      r.code AS register_code,
      a.command_id,
      a.command_type,
      a.reason_class,
      a.reason_code,
      a.status,
      a.payload,
      a.created_at
    FROM attention_item a
    JOIN outlet o ON o.tenant_id = a.tenant_id AND o.id = a.outlet_id
    LEFT JOIN cash_master r ON r.tenant_id = a.tenant_id AND r.id = a.register_id
    WHERE a.tenant_id = ${input.tenantId}::uuid
      AND a.status IN ('OPEN', 'ESCALATED')
      AND a.outlet_id IN (${outletIdSqlList})
    ORDER BY a.created_at DESC
    LIMIT 1000
  `)

  const attention: OpsAttentionRow[] = (
    attRes.rows as Array<{
      attention_id: string
      outlet_id: string
      outlet_code: string
      register_id: string
      register_code: string | null
      command_id: string
      command_type: string
      reason_class: string
      reason_code: string
      status: string
      payload: unknown
      created_at: string
    }>
  ).map((r) => {
    const summary = extractAttentionSummaryFields(r.command_type, r.payload)
    return {
      attentionId: r.attention_id,
      outletId: r.outlet_id,
      outletCode: r.outlet_code,
      registerId: r.register_id,
      registerCode: r.register_code,
      commandId: r.command_id,
      commandType: r.command_type,
      reasonClass: r.reason_class === 'AUTHORIZATION' ? 'AUTHORIZATION' : 'STRUCTURAL',
      reasonCode: r.reason_code,
      status: r.status === 'ESCALATED' ? 'ESCALATED' : 'OPEN',
      invoiceNo: summary.invoiceNo,
      totalDue: summary.totalDue,
      createdAt: r.created_at,
    }
  })

  // 7. itemTidakTersedia (ITEM_TIDAK_TERSEDIA)
  const unavailRes = await tx.execute(sql`
    SELECT
      df.id AS flag_id,
      df.outlet_id,
      o.code AS outlet_code,
      to_char(df.business_date, 'YYYY-MM-DD') AS business_date,
      s.id AS sale_id,
      s.invoice_no,
      sl.id AS sale_line_id,
      sl.sku_code,
      sl.item_name,
      sl.qty::text AS qty,
      sl.unit_price,
      sl.line_gross,
      s.customer_phone
    FROM data_flag df
    JOIN outlet o ON o.tenant_id = df.tenant_id AND o.id = df.outlet_id
    JOIN sale_line sl ON sl.tenant_id = df.tenant_id AND sl.id = df.entity_id
    JOIN sale s ON s.tenant_id = sl.tenant_id AND s.id = sl.sale_id
    WHERE df.tenant_id = ${input.tenantId}::uuid
      AND df.flag_code = 'ITEM_TIDAK_TERSEDIA'
      AND df.business_date BETWEEN ${input.from}::date AND ${input.to}::date
      AND df.outlet_id IN (${outletIdSqlList})
    ORDER BY df.business_date DESC, s.invoice_no ASC, sl.line_no ASC
    LIMIT 1000
  `)

  const itemTidakTersedia: OpsItemUnavailableRow[] = (
    unavailRes.rows as Array<{
      flag_id: string
      outlet_id: string
      outlet_code: string
      business_date: string
      sale_id: string
      invoice_no: string
      sale_line_id: string
      sku_code: string
      item_name: string
      qty: string
      unit_price: string | number
      line_gross: string | number
      customer_phone: string | null
    }>
  ).map((r) => ({
    flagId: r.flag_id,
    outletId: r.outlet_id,
    outletCode: r.outlet_code,
    businessDate: r.business_date,
    saleId: r.sale_id,
    invoiceNo: r.invoice_no,
    saleLineId: r.sale_line_id,
    skuCode: r.sku_code,
    itemName: r.item_name,
    qty: r.qty,
    unitPrice: toSafeReportMoney(r.unit_price),
    lineGross: toSafeReportMoney(r.line_gross),
    customerPhone: maskCustomerPhone(r.customer_phone, input.canViewCustomerPhone),
  }))

  // 8. openPrice (sale_line.is_open_price = true on PAID sales)
  const openPriceRes = await tx.execute(sql`
    SELECT
      sl.id AS sale_line_id,
      sl.outlet_id,
      o.code AS outlet_code,
      to_char(sl.business_date, 'YYYY-MM-DD') AS business_date,
      s.id AS sale_id,
      s.invoice_no,
      sl.sku_code,
      sl.item_name,
      sl.qty::text AS qty,
      sl.unit_price,
      sl.line_gross,
      s.created_by AS cashier_id,
      COALESCE(u.display_name, s.created_by::text) AS cashier_name,
      s.customer_phone
    FROM sale_line sl
    JOIN sale s ON s.tenant_id = sl.tenant_id AND s.id = sl.sale_id
    JOIN outlet o ON o.tenant_id = sl.tenant_id AND o.id = sl.outlet_id
    LEFT JOIN app_user u ON u.id = s.created_by
    WHERE sl.tenant_id = ${input.tenantId}::uuid
      AND sl.is_open_price = true
      AND s.status = 'PAID'
      AND sl.business_date BETWEEN ${input.from}::date AND ${input.to}::date
      AND sl.outlet_id IN (${outletIdSqlList})
    ORDER BY sl.business_date DESC, s.invoice_no ASC, sl.line_no ASC
    LIMIT 1000
  `)

  const openPrice: OpsOpenPriceRow[] = (
    openPriceRes.rows as Array<{
      sale_line_id: string
      outlet_id: string
      outlet_code: string
      business_date: string
      sale_id: string
      invoice_no: string
      sku_code: string
      item_name: string
      qty: string
      unit_price: string | number
      line_gross: string | number
      cashier_id: string
      cashier_name: string
      customer_phone: string | null
    }>
  ).map((r) => ({
    saleLineId: r.sale_line_id,
    outletId: r.outlet_id,
    outletCode: r.outlet_code,
    businessDate: r.business_date,
    saleId: r.sale_id,
    invoiceNo: r.invoice_no,
    skuCode: r.sku_code,
    itemName: r.item_name,
    qty: r.qty,
    unitPrice: toSafeReportMoney(r.unit_price),
    lineGross: toSafeReportMoney(r.line_gross),
    cashierId: r.cashier_id,
    cashierName: r.cashier_name,
    customerPhone: maskCustomerPhone(r.customer_phone, input.canViewCustomerPhone),
  }))

  // 9. orphanBills: OPEN/SPLIT bills stale > 24h OR leased by a revoked device (RSK-04)
  const orphanRes = await tx.execute(sql`
    SELECT
      b.id AS bill_id,
      b.outlet_id,
      o.code AS outlet_code,
      ft.code AS table_code,
      b.bill_ref,
      b.status,
      b.lease_device_id,
      d.name AS lease_device_name,
      d.revoked_at::text AS device_revoked_at,
      GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(b.last_event_at, b.occurred_at))) / 3600))::int AS age_hours,
      COALESCE(SUM(ROUND(bi.qty * bi.unit_price)) FILTER (WHERE bi.status = 'ACTIVE'), 0)::bigint AS estimated_total,
      COUNT(bi.id) FILTER (WHERE bi.status = 'ACTIVE')::int AS item_count,
      COALESCE(b.last_event_at, b.occurred_at)::text AS last_event_at
    FROM bill b
    JOIN outlet o ON o.tenant_id = b.tenant_id AND o.id = b.outlet_id
    JOIN fnb_table ft ON ft.tenant_id = b.tenant_id AND ft.id = b.table_id
    JOIN device d ON d.tenant_id = b.tenant_id AND d.id = b.lease_device_id
    LEFT JOIN bill_item bi ON bi.tenant_id = b.tenant_id AND bi.bill_id = b.id
    WHERE b.tenant_id = ${input.tenantId}::uuid
      AND b.outlet_id IN (${outletIdSqlList})
      AND b.status IN ('OPEN', 'SPLIT')
      AND (
        d.revoked_at IS NOT NULL
        OR COALESCE(b.last_event_at, b.occurred_at) < now() - interval '24 hours'
      )
    GROUP BY b.id, o.code, ft.code, d.name, d.revoked_at
    ORDER BY d.revoked_at DESC NULLS LAST, age_hours DESC, b.bill_ref ASC
    LIMIT 1000
  `)

  const orphanBills: OpsOrphanBillRow[] = (
    orphanRes.rows as Array<{
      bill_id: string
      outlet_id: string
      outlet_code: string
      table_code: string
      bill_ref: string
      status: string
      lease_device_id: string
      lease_device_name: string
      device_revoked_at: string | null
      age_hours: string | number
      estimated_total: string | number
      item_count: string | number
      last_event_at: string
    }>
  ).map((r) => ({
    billId: r.bill_id,
    outletId: r.outlet_id,
    outletCode: r.outlet_code,
    tableCode: r.table_code,
    billRef: r.bill_ref,
    status: r.status === 'SPLIT' ? 'SPLIT' : 'OPEN',
    leaseDeviceId: r.lease_device_id,
    leaseDeviceName: r.lease_device_name,
    deviceRevokedAt: r.device_revoked_at,
    ageHours: Number(r.age_hours),
    estimatedTotal: toSafeReportMoney(r.estimated_total),
    itemCount: Number(r.item_count),
    lastEventAt: r.last_event_at,
  }))

  // 10. duplicateBills (BILL_GANDA_MEJA flags raised when multiple independent open bills share a table)
  const dupRes = await tx.execute(sql`
    SELECT
      df.id AS flag_id,
      df.outlet_id,
      o.code AS outlet_code,
      to_char(df.business_date, 'YYYY-MM-DD') AS business_date,
      df.entity_id AS bill_id,
      df.detail,
      b.bill_ref,
      b.status AS bill_status,
      b.table_id,
      ft.code AS table_code,
      d.name AS lease_device_name
    FROM data_flag df
    JOIN outlet o ON o.tenant_id = df.tenant_id AND o.id = df.outlet_id
    LEFT JOIN bill b ON b.tenant_id = df.tenant_id AND b.id = df.entity_id
    LEFT JOIN fnb_table ft ON ft.tenant_id = df.tenant_id AND ft.id = b.table_id
    LEFT JOIN device d ON d.tenant_id = df.tenant_id AND d.id = b.lease_device_id
    WHERE df.tenant_id = ${input.tenantId}::uuid
      AND df.flag_code = 'BILL_GANDA_MEJA'
      AND df.business_date BETWEEN ${input.from}::date AND ${input.to}::date
      AND df.outlet_id IN (${outletIdSqlList})
    ORDER BY df.business_date DESC, o.code ASC, b.bill_ref ASC
    LIMIT 1000
  `)

  const duplicateBills: OpsDuplicateBillRow[] = (
    dupRes.rows as Array<{
      flag_id: string
      outlet_id: string
      outlet_code: string
      business_date: string
      bill_id: string
      detail: unknown
      bill_ref: string | null
      bill_status: string | null
      table_id: string | null
      table_code: string | null
      lease_device_name: string | null
    }>
  ).map((r) => ({
    flagId: r.flag_id,
    outletId: r.outlet_id,
    outletCode: r.outlet_code,
    businessDate: r.business_date,
    tableId: r.table_id ?? readOptionalStringFromJson(r.detail, ['table_id']),
    tableCode: r.table_code,
    billId: r.bill_id,
    billRef: r.bill_ref,
    openCount: readOptionalMoneyFromJson(r.detail, ['open_count']) ?? 2,
    billStatus: r.bill_status,
    leaseDeviceName: r.lease_device_name,
  }))

  return {
    sections: {
      staleHarga,
      itemNonaktifTarifBeda,
      selisihHitung,
      nomorKonflik,
      gapInvoice,
      attention,
      itemTidakTersedia,
      openPrice,
      orphanBills,
      duplicateBills,
    },
  }
}

export async function queryDashboardAttentionCounts(
  tx: TenantTx,
  input: {
    tenantId: string
    outletIds: readonly string[]
    from: string
    to: string
  },
): Promise<DashboardAttentionCounts> {
  if (input.outletIds.length === 0) {
    return {
      dataFlagsCount: 0,
      openGapsCount: 0,
      openAttentionCount: 0,
      totalNeedsAttention: 0,
    }
  }
  const outletIdSqlList = sql.join(
    input.outletIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )

  const countsRes = await tx.execute(sql`
    SELECT
      (
        SELECT COUNT(*)::bigint
        FROM data_flag df
        WHERE df.tenant_id = ${input.tenantId}::uuid
          AND df.status = 'OPEN'
          AND df.business_date BETWEEN ${input.from}::date AND ${input.to}::date
          AND df.outlet_id IN (${outletIdSqlList})
      ) AS flags_count,
      (
        SELECT COUNT(*)::bigint
        FROM invoice_gap g
        WHERE g.tenant_id = ${input.tenantId}::uuid
          AND g.status = 'OPEN'
          AND g.outlet_id IN (${outletIdSqlList})
      ) AS gaps_count,
      (
        SELECT COUNT(*)::bigint
        FROM attention_item a
        WHERE a.tenant_id = ${input.tenantId}::uuid
          AND a.status IN ('OPEN', 'ESCALATED')
          AND a.outlet_id IN (${outletIdSqlList})
      ) AS att_count
  `)

  const row = (
    countsRes.rows as Array<{
      flags_count: string | number
      gaps_count: string | number
      att_count: string | number
    }>
  )[0]
  const dataFlagsCount = toSafeReportMoney(row?.flags_count ?? 0)
  const openGapsCount = toSafeReportMoney(row?.gaps_count ?? 0)
  const openAttentionCount = toSafeReportMoney(row?.att_count ?? 0)

  return {
    dataFlagsCount,
    openGapsCount,
    openAttentionCount,
    totalNeedsAttention: dataFlagsCount + openGapsCount + openAttentionCount,
  }
}
