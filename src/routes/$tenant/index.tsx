import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { SystemPage } from '~/components/layout/SystemPage'
import { TenantBadge } from '~/components/layout/TenantBadge'
import { LayoutDashboard, ShoppingCart } from '~/components/ui'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { tenantHref } from '~/lib/tenancy/tenant-href'

export const Route = createFileRoute('/$tenant/')({
  component: TenantPickerPage,
})

function TenantPickerPage() {
  const { t } = useTranslation()
  const { name, slug } = useCurrentTenant()

  const cardClasses =
    'flex min-h-24 flex-col justify-between gap-2 rounded-lg border border-line bg-surface p-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'

  return (
    <SystemPage wide>
      <TenantBadge variant="hero" name={name} slug={slug} />
      <h1 className="mt-6 text-h2 font-semibold text-ink">{t('sys.picker.title')}</h1>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <a href={tenantHref(slug, '/pos')} className={cardClasses}>
          <ShoppingCart className="size-6 text-ink-brand" aria-hidden="true" />
          <div>
            <p className="text-title font-semibold text-ink">{t('sys.picker.pos.title')}</p>
            <p className="mt-0.5 text-body-sm text-ink-soft">{t('sys.picker.pos.desc')}</p>
          </div>
        </a>
        <a href={tenantHref(slug, '/admin')} className={cardClasses}>
          <LayoutDashboard className="size-6 text-ink-brand" aria-hidden="true" />
          <div>
            <p className="text-title font-semibold text-ink">{t('sys.picker.admin.title')}</p>
            <p className="mt-0.5 text-body-sm text-ink-soft">{t('sys.picker.admin.desc')}</p>
          </div>
        </a>
      </div>
    </SystemPage>
  )
}
