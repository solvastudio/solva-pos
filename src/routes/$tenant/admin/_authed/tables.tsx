import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BillReportTable } from '~/components/admin/fnb/BillReportTable'
import { TablesTable } from '~/components/admin/fnb/TablesTable'
import { getDefaultReportDateRange } from '~/components/admin/reports/report-download'
import { Tabs, type TabItem } from '~/components/ui'
import { getOpsReportFn } from '~/functions/reporting/reports.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import { catalogOutletsQueryOptions } from '~/queries/catalog.queries'
import { fnbTablesQueryOptions } from '~/queries/fnb.queries'

export const Route = createFileRoute('/$tenant/admin/_authed/tables')({
  beforeLoad: ({ params, context }) => {
    if (!context.session?.permissions.includes('catalog.manage')) {
      throw redirect({ href: tenantHref(params.tenant, '/admin') })
    }
  },
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(fnbTablesQueryOptions(params.tenant)),
      context.queryClient.ensureQueryData(catalogOutletsQueryOptions(params.tenant)),
    ])
  },
  component: TablesAdminPage,
})

function TablesAdminPage() {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const { session } = Route.useRouteContext()
  const [tab, setTab] = useState<'master' | 'bills'>('master')
  const { data: tables = [], isLoading } = useQuery(fnbTablesQueryOptions(slug))
  const { data: outlets = [] } = useQuery(catalogOutletsQueryOptions(slug))
  const canViewReports = Boolean(session?.permissions.includes('report.view'))
  const range = getDefaultReportDateRange()
  const opsQuery = useQuery({
    queryKey: ['admin', slug, 'tables-bill-report', range],
    enabled: canViewReports && tab === 'bills',
    queryFn: () =>
      getOpsReportFn({
        data: { outletIds: [], from: range.from, to: range.to, groupBy: 'DAY' },
      }),
  })
  const sec = opsQuery.data && opsQuery.data.ok ? opsQuery.data.data.sections : null

  const tabItems: TabItem[] = [
    {
      value: 'master',
      label: t('admin.tables.masterTab'),
      content: (
        <div className="mt-4">
          <TablesTable tenantSlug={slug} outlets={outlets} tables={tables} loading={isLoading} />
        </div>
      ),
    },
    ...(canViewReports
      ? [
          {
            value: 'bills',
            label: t('admin.tables.anomalyTab'),
            content: (
              <div className="mt-4 flex flex-col gap-6">
                <BillReportTable
                  mode="ORPHAN"
                  orphanRows={sec?.orphanBills ?? []}
                  loading={opsQuery.isLoading}
                />
                <BillReportTable
                  mode="DUPLICATE"
                  duplicateRows={sec?.duplicateBills ?? []}
                  loading={opsQuery.isLoading}
                />
              </div>
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1 font-semibold text-ink">{t('admin.tables.title')}</h1>
        <p className="mt-1 text-body text-ink-soft">{t('admin.tables.subtitle')}</p>
      </div>

      <Tabs
        items={tabItems}
        value={tab}
        onValueChange={(v) => setTab(v === 'bills' ? 'bills' : 'master')}
        size="md"
        ariaLabel={t('admin.tables.tabsLabel')}
      />
    </div>
  )
}
