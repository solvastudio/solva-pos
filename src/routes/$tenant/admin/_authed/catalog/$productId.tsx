import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ProductForm } from '~/components/admin/catalog/ProductForm'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import {
  categoriesQueryOptions,
  productDetailQueryOptions,
  uomsQueryOptions,
} from '~/queries/catalog.queries'

export const Route = createFileRoute('/$tenant/admin/_authed/catalog/$productId')({
  beforeLoad: ({ params, context }) => {
    const permissions = context.session?.permissions ?? []
    if (!permissions.includes('catalog.view') && !permissions.includes('catalog.manage')) {
      throw redirect({ href: tenantHref(params.tenant, '/admin') })
    }
  },
  loader: async ({ params, context }) => {
    const [detail] = await Promise.all([
      context.queryClient.ensureQueryData(productDetailQueryOptions(params.tenant, params.productId)),
      context.queryClient.ensureQueryData(categoriesQueryOptions(params.tenant)),
      context.queryClient.ensureQueryData(uomsQueryOptions(params.tenant)),
    ])
    if (!detail) {
      throw notFound()
    }
  },
  component: EditProductPage,
})

function EditProductPage() {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const { productId } = Route.useParams()
  const { session } = Route.useRouteContext()

  const { data: detail } = useQuery(productDetailQueryOptions(slug, productId))
  const { data: categories = [] } = useQuery(categoriesQueryOptions(slug))
  const { data: uoms = [] } = useQuery(uomsQueryOptions(slug))

  if (!detail) {
    return null
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-h1 font-semibold text-ink">
          {t('admin.catalog.editTitle', { name: detail.product.name })}
        </h1>
        <Link
          to={tenantHref(slug, '/admin/catalog')}
          className="text-body font-medium text-action hover:underline"
        >
          {t('common.back')}
        </Link>
      </div>

      <ProductForm
        tenantSlug={slug}
        detail={detail}
        categories={categories}
        uoms={uoms}
        canEditMaster={session?.permissions.includes('catalog.manage') ?? false}
        canManageTenantWide={session?.outletIds === null}
        scopedOutletIds={session?.outletIds ?? null}
      />
    </div>
  )
}
