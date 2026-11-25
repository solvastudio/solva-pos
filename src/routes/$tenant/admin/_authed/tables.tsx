import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { TablesTable } from '~/components/admin/fnb/TablesTable'
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
  const { data: tables = [], isLoading } = useQuery(fnbTablesQueryOptions(slug))
  const { data: outlets = [] } = useQuery(catalogOutletsQueryOptions(slug))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1 font-semibold text-ink">{t('admin.tables.title')}</h1>
        <p className="mt-1 text-body text-ink-soft">{t('admin.tables.subtitle')}</p>
      </div>

      <TablesTable tenantSlug={slug} outlets={outlets} tables={tables} loading={isLoading} />
    </div>
  )
}
