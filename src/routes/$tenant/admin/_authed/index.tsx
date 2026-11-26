import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChartSvg } from '~/components/admin/reports/BarChartSvg'
import { DataTableCmp10 } from '~/components/admin/reports/DataTableCmp10'
import { KpiCard } from '~/components/admin/reports/KpiCard'
import { ReportBusy } from '~/components/admin/reports/ReportBusy'
import { ReportFilters } from '~/components/admin/reports/ReportFilters'
import { getDefaultReportDateRange } from '~/components/admin/reports/report-download'
import { ShiftVarianceCell } from '~/components/admin/reports/ShiftVarianceCell'
import { SpaLink } from '~/components/layout/SpaLink'
import { Card, Chip, type DataTableColumn } from '~/components/ui'
import { listOutletsFn } from '~/functions/identity/org.fn'
import { getDashboardFn } from '~/functions/reporting/reports.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { formatDateTime, formatMoney, toMoney } from '~/lib/kernel'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import type { ShiftReportRow } from '~/modules/reporting/shared'

export const Route = createFileRoute('/$tenant/admin/_authed/')({
  component: AdminDashboardPage,
})

function AdminDashboardPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const { slug } = useCurrentTenant()
  const { session } = Route.useRouteContext()

  const defaults = getDefaultReportDateRange()
  const [selectedOutletId, setSelectedOutletId] = useState('')
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)
  const [appliedFilter, setAppliedFilter] = useState({
    outletId: '',
    from: defaults.from,
    to: defaults.to,
  })
  const [isOffline, setIsOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onOnline = () => setIsOffline(false)
    const onOffline = () => setIsOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const canViewReports = Boolean(session?.permissions.includes('report.view'))

  const outletsQuery = useQuery({
    queryKey: ['admin', slug, 'outlets-list'],
    queryFn: () => listOutletsFn(),
    enabled: canViewReports,
  })

  const dashboardQuery = useQuery({
    queryKey: ['admin', slug, 'dashboard', appliedFilter],
    queryFn: () =>
      getDashboardFn({
        data: {
          outletIds: appliedFilter.outletId ? [appliedFilter.outletId] : [],
          from: appliedFilter.from,
          to: appliedFilter.to,
          groupBy: 'DAY',
        },
      }),
    enabled: canViewReports,
  })

  if (!session) {
    return null
  }

  const outcome = dashboardQuery.data
  const isBusy = Boolean(outcome && !outcome.ok && outcome.busy)
  const dash = outcome && outcome.ok ? outcome.data : null

  const shiftColumns: readonly DataTableColumn<ShiftReportRow>[] = [
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
      id: 'opened',
      header: t('admin.report.shifts.colOpenedClosed'),
      cell: (r) => (
        <span className="font-mono text-caption">
          {formatDateTime(r.openedAt, r.outletTimezone, locale)}
        </span>
      ),
    },
    {
      id: 'expected',
      header: t('admin.report.shifts.colExpectedCash'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {formatMoney(toMoney(r.expectedCash), locale)}
        </span>
      ),
    },
    {
      id: 'counted',
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
      <div>
        <h1 className="text-h1 font-semibold text-ink">{t('admin.dashboard.title')}</h1>
        <p className="mt-1 text-body text-ink-soft">
          {t('admin.dashboard.welcome', { name: session.displayName })}
        </p>
      </div>

      {isOffline ? (
        <div
          role="alert"
          className="rounded-control border border-warning-line bg-warning-soft p-3 text-body-sm text-warning-ink"
        >
          {t('admin.dashboard.offlineBanner')}
        </div>
      ) : null}

      {canViewReports ? (
        <>
          <ReportFilters
            outlets={outletsQuery.data ?? []}
            selectedOutletId={selectedOutletId}
            from={from}
            to={to}
            loading={dashboardQuery.isFetching}
            busy={isBusy}
            onOutletChange={setSelectedOutletId}
            onFromChange={setFrom}
            onToChange={setTo}
            onSubmit={() => {
              setAppliedFilter({ outletId: selectedOutletId, from, to })
            }}
          />

          {isBusy ? (
            <ReportBusy
              loading={dashboardQuery.isFetching}
              onRetry={() => {
                void dashboardQuery.refetch()
              }}
            />
          ) : null}

          {dash ? (
            <>
              <Card className="flex flex-wrap items-center justify-between gap-4 border-info-line bg-info-soft p-4">
                <div className="flex flex-col gap-1">
                  <h2 className="text-h3 font-semibold text-info-ink">
                    {t('admin.dashboard.attentionCardTitle', {
                      total: dash.attentionCounts.totalNeedsAttention,
                    })}
                  </h2>
                  <div className="flex flex-wrap gap-4 text-body-sm text-info-ink">
                    <span>
                      {t('admin.dashboard.attentionFlags', {
                        count: dash.attentionCounts.dataFlagsCount,
                      })}
                    </span>
                    <span>
                      {t('admin.dashboard.attentionGaps', {
                        count: dash.attentionCounts.openGapsCount,
                      })}
                    </span>
                    <span>
                      {t('admin.dashboard.attentionQueue', {
                        count: dash.attentionCounts.openAttentionCount,
                      })}
                    </span>
                  </div>
                </div>
                <SpaLink
                  href={tenantHref(slug, '/admin/attention')}
                  className="rounded-control bg-surface px-3 py-2 text-body-sm font-semibold text-ink shadow-card hover:bg-surface-hover"
                >
                  {t('admin.dashboard.attentionAction')}
                </SpaLink>
              </Card>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  label={t('admin.dashboard.kpiNetSales')}
                  value={formatMoney(toMoney(dash.kpis.netSales), locale)}
                />
                <KpiCard
                  label={t('admin.dashboard.kpiTransactions')}
                  value={String(dash.kpis.transactionCount)}
                  subtitle={t('admin.dashboard.kpiVoidSub', { count: dash.kpis.voidCount })}
                />
                <KpiCard
                  label={t('admin.dashboard.kpiAverageTx')}
                  value={formatMoney(toMoney(dash.kpis.averageTransaction), locale)}
                />
                <KpiCard
                  label={t('admin.dashboard.kpiReturns')}
                  value={formatMoney(toMoney(dash.kpis.returns), locale)}
                />
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <BarChartSvg
                    title={t('admin.dashboard.dailyChartTitle')}
                    points={dash.dailySeries.map((pt) => ({
                      label: pt.businessDate,
                      value: pt.netSales,
                    }))}
                  />
                </div>

                <Card className="flex flex-col gap-3 p-4">
                  <h2 className="text-h3 font-semibold text-ink">
                    {t('admin.dashboard.paymentMethodsTitle')}
                  </h2>
                  {dash.byPaymentMethod.length === 0 ? (
                    <p className="text-body-sm text-ink-soft">
                      {t('admin.report.sales.emptyTitle')}
                    </p>
                  ) : (
                    <ul className="divide-y divide-line-subtle">
                      {dash.byPaymentMethod.map((pm) => (
                        <li
                          key={pm.methodCode}
                          className="flex items-center justify-between py-2 text-body-sm"
                        >
                          <span className="font-medium text-ink">
                            {`${pm.methodName} (${pm.methodCode})`}
                          </span>
                          <span className="font-mono font-semibold tabular-nums text-ink">
                            {formatMoney(toMoney(pm.amountApplied), locale)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              <section className="flex flex-col gap-3">
                <h2 className="text-h3 font-semibold text-ink">
                  {t('admin.dashboard.recentShiftsTitle')}
                </h2>
                <DataTableCmp10
                  caption={t('admin.dashboard.recentShiftsTitle')}
                  columns={shiftColumns}
                  rows={dash.recentShifts}
                  getRowKey={(r) => r.shiftId}
                  emptyTitle={t('admin.report.shifts.emptyTitle')}
                />
              </section>
            </>
          ) : null}
        </>
      ) : null}

      <Card className="p-6">
        <p className="text-label font-medium text-ink-soft">{t('admin.dashboard.rolesSummary')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {session.roleCodes.map((code: string) => (
            <span
              key={code}
              className="inline-flex items-center rounded-md border border-line bg-surface-subtle px-2.5 py-1 text-label-sm font-medium text-ink"
            >
              {code}
            </span>
          ))}
        </div>
        <p className="mt-4 text-body-sm text-ink-soft">{t('admin.dashboard.accountHint')}</p>
        <SpaLink
          href={tenantHref(slug, '/admin/account')}
          className="mt-3 inline-flex text-body-sm font-semibold text-ink-brand hover:underline"
        >
          {t('admin.shell.accountLink')}
        </SpaLink>
      </Card>
    </div>
  )
}
