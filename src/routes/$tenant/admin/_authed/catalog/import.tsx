import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ImportWizard } from '~/components/admin/catalog/ImportWizard'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { tenantHref } from '~/lib/tenancy/tenant-href'

export const Route = createFileRoute('/$tenant/admin/_authed/catalog/import')({
  beforeLoad: ({ params, context }) => {
    if (!context.session?.permissions.includes('catalog.manage')) {
      throw redirect({ href: tenantHref(params.tenant, '/admin') })
    }
  },
  component: CatalogImportPage,
})

function CatalogImportPage() {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const { session } = Route.useRouteContext()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-h1 font-semibold text-ink">{t('admin.import.title')}</h1>
        <Link
          to={tenantHref(slug, '/admin/catalog')}
          className="text-body font-medium text-action hover:underline"
        >
          {t('admin.import.backToCatalog')}
        </Link>
      </div>

      <ImportWizard
        tenantSlug={slug}
        canImportCatalog={session?.permissions.includes('catalog.import') ?? false}
      />
    </div>
  )
}
