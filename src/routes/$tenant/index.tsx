import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { SystemPage } from '~/components/layout/SystemPage'
import { TenantBadge } from '~/components/layout/TenantBadge'
import { LayoutDashboard, ShoppingCart } from '~/components/ui/icons'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { tenantHref } from '~/lib/tenancy/tenant-href'

export const Route = createFileRoute('/$tenant/')({
  component: TenantPickerPage,
})

function TenantPickerPage() {
  const { t } = useTranslation()
  const { name, slug } = useCurrentTenant()

  const apps = [
    {
      path: '/pos',
      Icon: ShoppingCart,
      title: t('sys.picker.pos.title'),
      desc: t('sys.picker.pos.desc'),
    },
    {
      path: '/admin',
      Icon: LayoutDashboard,
      title: t('sys.picker.admin.title'),
      desc: t('sys.picker.admin.desc'),
    },
  ] as const

  return (
    <SystemPage wide>
      <div className="border-b border-line-subtle pb-5">
        <TenantBadge variant="hero" name={name} slug={slug} />
      </div>
      <h1 className="mt-5 text-h3 font-semibold text-ink">{t('sys.picker.title')}</h1>
      <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {apps.map(({ path, Icon, title, desc }) => (
          <a
            key={path}
            href={tenantHref(slug, path)}
            className="group flex items-center gap-4 rounded-card border border-line bg-surface p-4 text-left transition-all hover:border-line-strong hover:bg-surface-subtle hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-action-soft text-ink-brand transition-colors group-hover:bg-action-soft-hover">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-title font-semibold text-ink">{title}</span>
              <span className="mt-0.5 block text-body-sm text-ink-soft">{desc}</span>
            </span>
          </a>
        ))}
      </div>
    </SystemPage>
  )
}
