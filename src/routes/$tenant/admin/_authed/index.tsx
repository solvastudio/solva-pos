import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Card } from '~/components/ui'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { tenantHref } from '~/lib/tenancy/tenant-href'

export const Route = createFileRoute('/$tenant/admin/_authed/')({
  component: AdminDashboardPage,
})

function AdminDashboardPage() {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const { session } = Route.useRouteContext()

  if (!session) {
    return null
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1 font-semibold text-ink">{t('admin.dashboard.title')}</h1>
        <p className="mt-1 text-body text-ink-soft">
          {t('admin.dashboard.welcome', { name: session.displayName })}
        </p>
      </div>

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
        <a
          href={tenantHref(slug, '/admin/account')}
          className="mt-3 inline-flex text-body-sm font-semibold text-ink-brand hover:underline"
        >
          {t('admin.shell.accountLink')}
        </a>
      </Card>
    </div>
  )
}
