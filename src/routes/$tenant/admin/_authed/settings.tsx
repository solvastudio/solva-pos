import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LegalEntitiesSection } from '~/components/admin/settings/LegalEntitiesSection'
import { OutletsSection } from '~/components/admin/settings/OutletsSection'
import { Tabs, type TabItem } from '~/components/ui'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import { legalEntitiesQueryOptions, outletsQueryOptions } from '~/queries/identity.queries'

export const Route = createFileRoute('/$tenant/admin/_authed/settings')({
  beforeLoad: ({ params, context }) => {
    if (!context.session?.permissions.includes('user.manage')) {
      throw redirect({ href: tenantHref(params.tenant, '/admin') })
    }
  },
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(legalEntitiesQueryOptions(params.tenant)),
      context.queryClient.ensureQueryData(outletsQueryOptions(params.tenant)),
    ])
  },
  component: AdminSettingsPage,
})

function AdminSettingsPage() {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const { session } = Route.useRouteContext()
  const [activeTab, setActiveTab] = useState('general')
  const canManageTenantWide = session?.outletIds === null

  const tabItems: readonly TabItem[] = [
    {
      value: 'general',
      label: t('admin.settings.tabGeneral'),
      content: (
        <div className="mt-6 flex flex-col gap-10">
          <LegalEntitiesSection
            tenantSlug={slug}
            canManageTenantWide={canManageTenantWide}
          />
          <OutletsSection tenantSlug={slug} canCreateOutlet={canManageTenantWide} />
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-semibold text-ink">{t('admin.settings.title')}</h1>
      <Tabs
        items={tabItems}
        value={activeTab}
        onValueChange={setActiveTab}
        size="md"
        ariaLabel={t('admin.settings.tabsLabel')}
      />
    </div>
  )
}
