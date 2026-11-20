import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { FeatureFlagsPanel } from '~/components/admin/features/FeatureFlagsPanel'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import { featureFlagsQueryOptions } from '~/queries/catalog.queries'

export const Route = createFileRoute('/$tenant/admin/_authed/features')({
  beforeLoad: ({ params, context }) => {
    if (!context.session?.permissions.includes('flag.manage')) {
      throw redirect({ href: tenantHref(params.tenant, '/admin') })
    }
  },
  loader: async ({ params, context }) => {
    await context.queryClient.ensureQueryData(featureFlagsQueryOptions(params.tenant))
  },
  component: FeaturesPage,
})

function FeaturesPage() {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const { data: flags = [] } = useQuery(featureFlagsQueryOptions(slug))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-semibold text-ink">{t('admin.features.title')}</h1>
      <FeatureFlagsPanel tenantSlug={slug} flags={flags} />
    </div>
  )
}
