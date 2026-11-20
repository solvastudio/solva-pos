import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PosShell } from '~/components/layout/PosShell'
import { Card } from '~/components/ui/Card'
import { APP_VERSION } from '~/lib/app-version'
import { listActiveStaff } from '~/pos/data/master.repo'
import { setMeta } from '~/pos/data/meta.repo'

export const Route = createFileRoute('/$tenant/pos/login')({
  ssr: false,
  component: PosLoginPlaceholderRouteComponent,
})

function PosLoginPlaceholderRouteComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  const { t } = useTranslation()
  const [staffNames, setStaffNames] = useState<string[]>([])

  const tenantName =
    bootResult.kind === 'READY' && bootResult.tenant?.name ? bootResult.tenant.name : tenant
  const appVersion = typeof APP_VERSION === 'string' ? APP_VERSION : 'dev'

  useEffect(() => {
    if (bootResult.kind !== 'READY') return
    let cancelled = false
    void listActiveStaff(bootResult.db)
      .then((rows) => {
        if (!cancelled) {
          setStaffNames(rows.map((r) => r.display_name))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [bootResult])

  function handleLocaleChange(nextLocale: 'id-ID' | 'en-US') {
    if (bootResult.kind === 'READY') {
      void setMeta(bootResult.db, 'locale', nextLocale)
    }
  }

  return (
    <PosShell tenantName={tenantName} tenantSlug={tenant} onLocaleChange={handleLocaleChange}>
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <Card className="w-full max-w-dialog-md p-6 md:p-8">
          <h1 className="text-h2 font-semibold text-ink">{t('pos.login.placeholder.title')}</h1>
          <p className="mt-2 text-body text-ink-soft">{t('pos.login.placeholder.body')}</p>

          <div className="mt-6 rounded-card border border-line bg-surface-sunken p-4">
            <p className="text-label font-medium text-ink">
              {t('pos.login.placeholder.staffHeading')}
            </p>
            {staffNames.length === 0 ? (
              <p className="mt-2 text-caption text-ink-soft">
                {t('pos.login.placeholder.noStaff')}
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {staffNames.map((name, idx) => (
                  <li
                    key={`${name}-${idx}`}
                    className="rounded-md border border-line bg-surface px-3 py-1.5 text-body font-medium text-ink"
                  >
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <footer className="mt-6 border-t border-line pt-4 text-center text-caption text-ink-muted">
            {t('pos.login.placeholder.appVersion', { version: appVersion })}
          </footer>
        </Card>
      </div>
    </PosShell>
  )
}
