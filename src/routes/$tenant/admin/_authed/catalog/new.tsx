import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ProductForm } from '~/components/admin/catalog/ProductForm'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import { categoriesQueryOptions, uomsQueryOptions } from '~/queries/catalog.queries'

export const Route = createFileRoute('/$tenant/admin/_authed/catalog/new')({
  beforeLoad: ({ params, context }) => {
    if (!context.session?.permissions.includes('catalog.manage')) {
      throw redirect({ href: tenantHref(params.tenant, '/admin/catalog') })
    }
  },
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(categoriesQueryOptions(params.tenant)),
      context.queryClient.ensureQueryData(uomsQueryOptions(params.tenant)),
    ])
  },
  component: NewProductPage,
})

function NewProductPage() {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const { session } = Route.useRouteContext()
  const { data: categories = [] } = useQuery(categoriesQueryOptions(slug))
  const { data: uoms = [] } = useQuery(uomsQueryOptions(slug))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-h1 font-semibold text-ink">{t('admin.catalog.newTitle')}</h1>
        <Link
          to={tenantHref(slug, '/admin/catalog')}
          className="text-body font-medium text-action hover:underline"
        >
          {t('common.back')}
        </Link>
      </div>

      <ProductForm
        tenantSlug={slug}
        categories={categories}
        uoms={uoms}
        canEditMaster
        canManageTenantWide={session?.outletIds === null}
        scopedOutletIds={session?.outletIds ?? null}
      />
    </div>
  )
}
