import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  exportReportCsv,
  getDashboard,
  getOpsReport,
  getSalesReport,
  getShiftReport,
  isReportBusyError,
} from '~/modules/reporting/public'
import {
  ReportFilterSchema,
  type DashboardReportResult,
  type OpsReportResult,
  type ReportActionOutcome,
  type ReportCsvExportResult,
  type SalesReportResult,
  type ShiftReportResult,
} from '~/modules/reporting/shared'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware } from '../middleware'

async function runReportOutcome<T>(fn: () => Promise<T>): Promise<ReportActionOutcome<T>> {
  try {
    const data = await fn()
    return { ok: true, data }
  } catch (err) {
    if (isReportBusyError(err)) {
      return { ok: false, busy: true, errorKey: 'admin.report.busy' }
    }
    throw err
  }
}

export const getDashboardFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => ReportFilterSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('report.view')])
  .handler(async ({ data, context }): Promise<ReportActionOutcome<DashboardReportResult>> => {
    return runReportOutcome(() => getDashboard(context.auth, data))
  })

export const getSalesReportFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => ReportFilterSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('report.view')])
  .handler(async ({ data, context }): Promise<ReportActionOutcome<SalesReportResult>> => {
    return runReportOutcome(() => getSalesReport(context.auth, data))
  })

export const getShiftReportFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => ReportFilterSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('report.view')])
  .handler(async ({ data, context }): Promise<ReportActionOutcome<ShiftReportResult>> => {
    return runReportOutcome(() => getShiftReport(context.auth, data))
  })

export const getOpsReportFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => ReportFilterSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('report.view')])
  .handler(async ({ data, context }): Promise<ReportActionOutcome<OpsReportResult>> => {
    return runReportOutcome(() => getOpsReport(context.auth, data))
  })

const exportReportCsvParamSchema = z.object({
  kind: z.enum(['sales', 'shifts', 'operations']),
  filter: ReportFilterSchema,
})

export const exportReportCsvFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => exportReportCsvParamSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('report.view')])
  .handler(async ({ data, context }): Promise<ReportActionOutcome<ReportCsvExportResult>> => {
    return runReportOutcome(() => exportReportCsv(context.auth, data.kind, data.filter))
  })
