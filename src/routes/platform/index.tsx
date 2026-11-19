import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PlatformShell } from '~/components/layout/PlatformShell'
import { Card, EmptyState, Plus, Skeleton, Store } from '~/components/ui'

interface TenantListRow {
  id: string
  name: string
  slug: string
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED'
  createdAt: string
}

export const Route = createFileRoute('/platform/')({
  component: PlatformTenantsPage,
})

function PlatformTenantsPage() {
  const { t } = useTranslation()
  const [operatorEmail, setOperatorEmail] = useState<string | null>(null)
  const [tenants, setTenants] = useState<TenantListRow[] | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      const sessRes = await fetch('/platform/api/session', { credentials: 'same-origin' })
      if (!sessRes.ok) {
        window.location.assign('/platform/login')
        return
      }
      const sessJson = (await sessRes.json()) as { session: { email: string } | null }
      if (!sessJson.session) {
        window.location.assign('/platform/login')
        return
      }
      if (!active) return
      setOperatorEmail(sessJson.session.email)

      const listRes = await fetch('/platform/api/tenants', { credentials: 'same-origin' })
      if (listRes.status === 401) {
        window.location.assign('/platform/login')
        return
      }
      if (listRes.ok && active) {
        const body = (await listRes.json()) as { tenants: TenantListRow[] }
        setTenants(body.tenants)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  return (
    <PlatformShell operatorEmail={operatorEmail} activeSection="tenants">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-h1 font-semibold text-ink">{t('platform.tenants.title')}</h1>
        <a
          href="/platform/tenants/new"
          className="inline-flex h-control-md items-center gap-2 rounded-control bg-action px-4 text-button font-semibold text-on-action transition-colors hover:bg-action-hover"
        >
          <Plus className="size-4" aria-hidden="true" />
          <span>{t('platform.tenants.newButton')}</span>
        </a>
      </div>

      {tenants === null ? (
        <div className="mt-6 flex flex-col gap-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : tenants.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<Store className="size-8" aria-hidden="true" />}
            title={t('platform.tenants.emptyTitle')}
            description={t('platform.tenants.emptyDesc')}
          />
        </div>
      ) : (
        <Card className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-surface-subtle text-label-sm font-semibold text-ink-soft">
                <th className="px-4 py-3">{t('platform.tenants.colName')}</th>
                <th className="px-4 py-3">{t('platform.tenants.colSlug')}</th>
                <th className="px-4 py-3">{t('platform.tenants.colStatus')}</th>
                <th className="px-4 py-3 text-right">{t('platform.tenants.colAction')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="hover:bg-surface-hover">
                  <td className="px-4 py-3 text-body font-medium text-ink">{tenant.name}</td>
                  <td className="px-4 py-3 font-mono text-body-sm text-ink-soft">/{tenant.slug}</td>
                  <td className="px-4 py-3 text-body-sm text-ink">
                    {t(`platform.tenants.status${tenant.status}`)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <a
                      href={`/platform/tenants/${tenant.id}`}
                      className="text-body-sm font-semibold text-ink-brand hover:underline"
                    >
                      {t('platform.tenants.openDetail')}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </PlatformShell>
  )
}
