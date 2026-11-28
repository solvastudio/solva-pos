import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTableCmp10 } from '~/components/admin/reports/DataTableCmp10'
import { ReportBusy } from '~/components/admin/reports/ReportBusy'
import { ReportFilters } from '~/components/admin/reports/ReportFilters'
import {
  downloadReportCsvFile,
  getDefaultReportDateRange,
} from '~/components/admin/reports/report-download'
import { ShiftVarianceCell } from '~/components/admin/reports/ShiftVarianceCell'
import { Chip, useToast, type DataTableColumn } from '~/components/ui'
import { listOutletOptionsFn } from '~/functions/identity/org.fn'
import { exportReportCsvFn, getShiftReportFn } from '~/functions/reporting/reports.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { formatDateTime, formatMoney, toMoney } from '~/lib/kernel'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import type { ShiftReportRow } from '~/modules/reporting/shared'

export const Route = createFileRoute('/$tenant/admin/_authed/reports/shifts')({
  beforeLoad: ({ params, context }) => {
    if (!context.session?.permissions.includes('report.view')) {
      throw redirect({ href: tenantHref(params.tenant, '/admin') })
    }
  },
  component: AdminShiftReportPage,
})

function AdminShiftReportPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const { slug } = useCurrentTenant()
  const toast = useToast()

  const defaults = getDefaultReportDateRange()
  const [selectedOutletId, setSelectedOutletId] = useState('')
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)
  const [appliedFilter, setAppliedFilter] = useState({
    outletId: '',
    from: defaults.from,
    to: defaults.to,
  })

  const outletsQuery = useQuery({
    queryKey: ['admin', slug, 'outlet-options'],
    queryFn: () => listOutletOptionsFn(),
  })

  const reportQuery = useQuery({
    queryKey: ['admin', slug, 'report-shifts', appliedFilter],
    queryFn: () =>
      getShiftReportFn({
        data: {
          outletIds: appliedFilter.outletId ? [appliedFilter.outletId] : [],
          from: appliedFilter.from,
          to: appliedFilter.to,
          groupBy: 'DAY',
        },
      }),
  })

  const exportMut = useMutation({
    mutationFn: () =>
      exportReportCsvFn({
        data: {
          kind: 'shifts',
          filter: {
            outletIds: appliedFilter.outletId ? [appliedFilter.outletId] : [],
            from: appliedFilter.from,
            to: appliedFilter.to,
            groupBy: 'DAY',
          },
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.show({ tone: 'warning', message: t('admin.report.busy') })
        return
      }
      downloadReportCsvFile(res.data.csv, res.data.filename)
    },
  })

  const outcome = reportQuery.data
  const isBusy = Boolean(outcome && !outcome.ok && outcome.busy)
  const rpt = outcome && outcome.ok ? outcome.data : null

  const columns: readonly DataTableColumn<ShiftReportRow>[] = [
    {
      id: 'register',
      header: t('admin.report.shifts.colRegister'),
      cell: (r) => <span className="font-mono font-semibold">{r.registerLabel}</span>,
    },
    {
      id: 'cashier',
      header: t('admin.report.shifts.colCashier'),
      cell: (r) => r.cashierName,
    },
    {
      id: 'openedClosed',
      header: t('admin.report.shifts.colOpenedClosed'),
      cell: (r) => (
        <div className="flex flex-col font-mono text-caption">
          <span>{formatDateTime(r.openedAt, r.outletTimezone, locale)}</span>
          <span className="text-ink-soft">
            {r.closedAt
              ? formatDateTime(r.closedAt, r.outletTimezone, locale)
              : t('admin.report.shifts.statusOPEN')}
          </span>
        </div>
      ),
    },
    {
      id: 'openingCash',
      header: t('admin.report.shifts.colOpeningCash'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {formatMoney(toMoney(r.openingCash), locale)}
        </span>
      ),
    },
    {
      id: 'cashSales',
      header: t('admin.report.shifts.colCashSales'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {formatMoney(toMoney(r.cashSales), locale)}
        </span>
      ),
    },
    {
      id: 'cashIn',
      header: t('admin.report.shifts.colCashIn'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">{formatMoney(toMoney(r.cashIn), locale)}</span>
      ),
    },
    {
      id: 'cashOut',
      header: t('admin.report.shifts.colCashOut'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">{formatMoney(toMoney(r.cashOut), locale)}</span>
      ),
    },
    {
      id: 'cashRefunds',
      header: t('admin.report.shifts.colCashRefunds'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {formatMoney(toMoney(r.cashRefunds), locale)}
        </span>
      ),
    },
    {
      id: 'expectedCash',
      header: t('admin.report.shifts.colExpectedCash'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono font-medium tabular-nums">
          {formatMoney(toMoney(r.expectedCash), locale)}
        </span>
      ),
    },
    {
      id: 'countedCash',
      header: t('admin.report.shifts.colCountedCash'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {r.countedCash !== null
            ? formatMoney(toMoney(r.countedCash), locale)
            : t('common.dash')}
        </span>
      ),
    },
    {
      id: 'variance',
      header: t('admin.report.shifts.colVariance'),
      align: 'right',
      numeric: true,
      cell: (r) => <ShiftVarianceCell variance={r.variance} />,
    },
    {
      id: 'nonCash',
      header: t('admin.report.shifts.colNonCash'),
      cell: (r) =>
        r.nonCashByMethod.length === 0 ? (
          <span className="text-caption text-ink-soft">{t('common.dash')}</span>
        ) : (
          <div className="flex flex-col text-caption">
            {r.nonCashByMethod.map((nc) => (
              <span key={nc.methodCode} className="font-mono tabular-nums">
                {`${nc.methodName}: ${formatMoney(toMoney(nc.amountApplied), locale)}`}
              </span>
            ))}
          </div>
        ),
    },
    {
      id: 'status',
      header: t('admin.report.shifts.colStatus'),
      cell: (r) => (
        <Chip
          status={
            r.status === 'COMPLETE'
              ? 'synced'
              : r.status === 'OPEN'
                ? 'shift_open'
                : r.status === 'FORCE_CLOSED'
                  ? 'force_closed'
                  : 'flag_warning'
          }
          label={t(`admin.report.shifts.status${r.status}`)}
          size="sm"
        />
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-semibold text-ink">{t('admin.report.shifts.title')}</h1>

      <ReportFilters
        outlets={outletsQuery.data ?? []}
        selectedOutletId={selectedOutletId}
        from={from}
        to={to}
        loading={reportQuery.isFetching || exportMut.isPending}
        busy={isBusy}
        onOutletChange={setSelectedOutletId}
        onFromChange={setFrom}
        onToChange={setTo}
        onSubmit={() => {
          setAppliedFilter({ outletId: selectedOutletId, from, to })
        }}
        onExportCsv={() => exportMut.mutate()}
      />

      {isBusy ? (
        <ReportBusy
          loading={reportQuery.isFetching}
          onRetry={() => {
            void reportQuery.refetch()
          }}
        />
      ) : null}

      {rpt ? (
        <DataTableCmp10
          caption={t('admin.report.shifts.title')}
          columns={columns}
          rows={rpt.rows}
          getRowKey={(r) => r.shiftId}
          emptyTitle={t('admin.report.shifts.emptyTitle')}
          truncated={rpt.truncated}
        />
      ) : null}
    </div>
  )
}
