import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChartSvg } from '~/components/admin/reports/BarChartSvg'
import { DataTableCmp10 } from '~/components/admin/reports/DataTableCmp10'
import { KpiCard } from '~/components/admin/reports/KpiCard'
import { ReportBusy } from '~/components/admin/reports/ReportBusy'
import { ReportFilters } from '~/components/admin/reports/ReportFilters'
import {
  downloadReportCsvFile,
  getDefaultReportDateRange,
} from '~/components/admin/reports/report-download'
import { Card, useToast, type DataTableColumn } from '~/components/ui'
import { listOutletOptionsFn } from '~/functions/identity/org.fn'
import { exportReportCsvFn, getSalesReportFn } from '~/functions/reporting/reports.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { formatMoney, toMoney } from '~/lib/kernel'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import type {
  CashierSalesBreakdownItem,
  PaymentMethodBreakdownItem,
  ReportGroupBy,
  SalesReportGroupRow,
} from '~/modules/reporting/shared'

export const Route = createFileRoute('/$tenant/admin/_authed/reports/sales')({
  beforeLoad: ({ params, context }) => {
    if (!context.session?.permissions.includes('report.view')) {
      throw redirect({ href: tenantHref(params.tenant, '/admin') })
    }
  },
  component: AdminSalesReportPage,
})

function AdminSalesReportPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const { slug } = useCurrentTenant()
  const toast = useToast()

  const defaults = getDefaultReportDateRange()
  const [selectedOutletId, setSelectedOutletId] = useState('')
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)
  const [groupBy, setGroupBy] = useState<ReportGroupBy>('DAY')
  const [appliedFilter, setAppliedFilter] = useState({
    outletId: '',
    from: defaults.from,
    to: defaults.to,
    groupBy: 'DAY' as ReportGroupBy,
  })

  const outletsQuery = useQuery({
    queryKey: ['admin', slug, 'outlet-options'],
    queryFn: () => listOutletOptionsFn(),
  })

  const reportQuery = useQuery({
    queryKey: ['admin', slug, 'report-sales', appliedFilter],
    queryFn: () =>
      getSalesReportFn({
        data: {
          outletIds: appliedFilter.outletId ? [appliedFilter.outletId] : [],
          from: appliedFilter.from,
          to: appliedFilter.to,
          groupBy: appliedFilter.groupBy,
        },
      }),
  })

  const exportMut = useMutation({
    mutationFn: () =>
      exportReportCsvFn({
        data: {
          kind: 'sales',
          filter: {
            outletIds: appliedFilter.outletId ? [appliedFilter.outletId] : [],
            from: appliedFilter.from,
            to: appliedFilter.to,
            groupBy: appliedFilter.groupBy,
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

  const columns: readonly DataTableColumn<SalesReportGroupRow>[] = [
    {
      id: 'period',
      header: t('admin.report.sales.colPeriod'),
      stickyFirst: true,
      cell: (r) => <span className="whitespace-nowrap font-mono font-medium">{r.periodKey}</span>,
    },
    {
      id: 'outlet',
      header: t('admin.report.sales.colOutlet'),
      cell: (r) => <span className="whitespace-nowrap">{`${r.outletCode} — ${r.outletName}`}</span>,
    },
    {
      id: 'txCount',
      header: t('admin.report.sales.colTxCount'),
      align: 'right',
      numeric: true,
      cell: (r) => <span className="font-mono tabular-nums">{r.transactionCount}</span>,
    },
    {
      id: 'gross',
      header: t('admin.report.sales.colGross'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">{formatMoney(toMoney(r.gross), locale)}</span>
      ),
    },
    {
      id: 'discount',
      header: t('admin.report.sales.colDiscount'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">{formatMoney(toMoney(r.discount), locale)}</span>
      ),
    },
    {
      id: 'netSubtotal',
      header: t('admin.report.sales.colNetSubtotal'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {formatMoney(toMoney(r.netSubtotal), locale)}
        </span>
      ),
    },
    {
      id: 'serviceCharge',
      header: t('admin.report.sales.colServiceCharge'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {formatMoney(toMoney(r.serviceCharge), locale)}
        </span>
      ),
    },
    {
      id: 'tax',
      header: t('admin.report.sales.colTax'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">{formatMoney(toMoney(r.tax), locale)}</span>
      ),
    },
    {
      id: 'rounding',
      header: t('admin.report.sales.colRounding'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">{formatMoney(toMoney(r.rounding), locale)}</span>
      ),
    },
    {
      id: 'totalReceived',
      header: t('admin.report.sales.colTotalReceived'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {formatMoney(toMoney(r.totalReceived), locale)}
        </span>
      ),
    },
    {
      id: 'returns',
      header: t('admin.report.sales.colReturns'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">{formatMoney(toMoney(r.returns), locale)}</span>
      ),
    },
    {
      id: 'netSales',
      header: t('admin.report.sales.colNetSales'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono font-semibold tabular-nums">
          {formatMoney(toMoney(r.netSales), locale)}
        </span>
      ),
    },
    {
      id: 'voidCount',
      header: t('admin.report.sales.colVoidCount'),
      align: 'right',
      numeric: true,
      cell: (r) => <span className="font-mono tabular-nums">{r.voidCount}</span>,
    },
  ]

  const methodColumns: readonly DataTableColumn<PaymentMethodBreakdownItem>[] = [
    {
      id: 'method',
      header: t('admin.report.sales.colMethod'),
      cell: (r) => `${r.methodName} (${r.methodCode})`,
    },
    {
      id: 'txCount',
      header: t('admin.report.sales.colTxCount'),
      align: 'right',
      numeric: true,
      cell: (r) => <span className="font-mono tabular-nums">{r.transactionCount}</span>,
    },
    {
      id: 'amount',
      header: t('admin.report.sales.colAmount'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono font-semibold tabular-nums">
          {formatMoney(toMoney(r.amountApplied), locale)}
        </span>
      ),
    },
  ]

  const cashierColumns: readonly DataTableColumn<CashierSalesBreakdownItem>[] = [
    {
      id: 'cashier',
      header: t('admin.report.sales.colCashier'),
      cell: (r) => r.cashierName,
    },
    {
      id: 'txCount',
      header: t('admin.report.sales.colTxCount'),
      align: 'right',
      numeric: true,
      cell: (r) => <span className="font-mono tabular-nums">{r.transactionCount}</span>,
    },
    {
      id: 'amount',
      header: t('admin.report.sales.colAmount'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono font-semibold tabular-nums">
          {formatMoney(toMoney(r.totalReceived), locale)}
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-semibold text-ink">{t('admin.report.sales.title')}</h1>

      <ReportFilters
        outlets={outletsQuery.data ?? []}
        selectedOutletId={selectedOutletId}
        from={from}
        to={to}
        groupBy={groupBy}
        showGroupBy={true}
        loading={reportQuery.isFetching || exportMut.isPending}
        busy={isBusy}
        onOutletChange={setSelectedOutletId}
        onFromChange={setFrom}
        onToChange={setTo}
        onGroupByChange={setGroupBy}
        onSubmit={() => {
          setAppliedFilter({ outletId: selectedOutletId, from, to, groupBy })
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
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label={t('admin.dashboard.kpiNetSales')}
              value={formatMoney(toMoney(rpt.totals.netSales), locale)}
            />
            <KpiCard
              label={t('admin.dashboard.kpiTransactions')}
              value={String(rpt.totals.transactionCount)}
              subtitle={t('admin.dashboard.kpiVoidSub', { count: rpt.totals.voidCount })}
            />
            <KpiCard
              label={t('admin.dashboard.kpiAverageTx')}
              value={formatMoney(toMoney(rpt.totals.averageTransaction), locale)}
            />
            <KpiCard
              label={t('admin.dashboard.kpiReturns')}
              value={formatMoney(toMoney(rpt.totals.returns), locale)}
            />
          </div>

          <BarChartSvg
            title={t('admin.report.sales.title')}
            points={rpt.rows.map((r) => ({
              label: `${r.periodKey} ${r.outletCode}`,
              value: r.netSales,
            }))}
          />

          <DataTableCmp10
            caption={t('admin.report.sales.title')}
            columns={columns}
            rows={rpt.rows}
            getRowKey={(r) => `${r.periodKey}-${r.outletId}`}
            emptyTitle={t('admin.report.sales.emptyTitle')}
            truncated={rpt.truncated}
            footer={
              <Card className="flex flex-wrap items-center justify-between gap-4 bg-surface-subtle p-4 text-body-sm">
                <span className="font-semibold text-ink">
                  {t('admin.report.sales.totalsLabel')}
                </span>
                <div className="flex flex-wrap gap-6 font-mono tabular-nums text-ink">
                  <span>{`${t('admin.report.sales.colGross')}: ${formatMoney(toMoney(rpt.totals.gross), locale)}`}</span>
                  <span>{`${t('admin.report.sales.colDiscount')}: ${formatMoney(toMoney(rpt.totals.discount), locale)}`}</span>
                  <span>{`${t('admin.report.sales.colTax')}: ${formatMoney(toMoney(rpt.totals.tax), locale)}`}</span>
                  <span>{`${t('admin.report.sales.colTotalReceived')}: ${formatMoney(toMoney(rpt.totals.totalReceived), locale)}`}</span>
                  <span>{`${t('admin.report.sales.colReturns')}: ${formatMoney(toMoney(rpt.totals.returns), locale)}`}</span>
                  <span className="font-bold">{`${t('admin.report.sales.colNetSales')}: ${formatMoney(toMoney(rpt.totals.netSales), locale)}`}</span>
                </div>
              </Card>
            }
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="flex flex-col gap-3">
              <h2 className="text-h3 font-semibold text-ink">
                {t('admin.report.sales.byMethodTitle')}
              </h2>
              <DataTableCmp10
                caption={t('admin.report.sales.byMethodTitle')}
                columns={methodColumns}
                rows={rpt.byPaymentMethod}
                getRowKey={(r) => r.methodCode}
                emptyTitle={t('admin.report.sales.emptyTitle')}
              />
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-h3 font-semibold text-ink">
                {t('admin.report.sales.byCashierTitle')}
              </h2>
              <DataTableCmp10
                caption={t('admin.report.sales.byCashierTitle')}
                columns={cashierColumns}
                rows={rpt.byCashier}
                getRowKey={(r) => r.cashierId}
                emptyTitle={t('admin.report.sales.emptyTitle')}
              />
            </section>
          </div>
        </>
      ) : null}
    </div>
  )
}
