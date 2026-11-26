import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { LogOut, Store, Plus } from '~/components/ui/icons'
import { cn } from '~/lib/cn'
import { LangToggle } from './LangToggle'
import { SpaLink } from './SpaLink'

export interface PlatformShellProps {
  operatorEmail?: string | null
  activeSection?: 'tenants' | 'create'
  children: ReactNode
}

export function PlatformShell({
  operatorEmail,
  activeSection,
  children,
}: PlatformShellProps) {
  const { t } = useTranslation()
  const [signingOut, setSigningOut] = useState(false)

  async function handleLogout() {
    setSigningOut(true)
    try {
      await fetch('/platform/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    } finally {
      window.location.assign('/platform/login')
    }
  }

  return (
    <div className="min-h-screen bg-app text-ink">
      <header className="sticky top-0 z-header flex h-16 items-center justify-between gap-4 border-b border-line bg-surface px-4 md:px-6">
        <div className="flex items-center gap-6">
          <SpaLink href="/platform" className="flex items-center gap-2 text-title font-bold text-ink">
            <Store className="size-5 text-ink-brand" aria-hidden="true" />
            <span>{t('platform.brandTitle')}</span>
          </SpaLink>
          <nav className="hidden items-center gap-2 sm:flex">
            <SpaLink
              href="/platform"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-body-sm font-medium transition-colors',
                activeSection === 'tenants'
                  ? 'bg-action-soft text-on-action-soft'
                  : 'text-ink-soft hover:bg-surface-hover hover:text-ink',
              )}
            >
              <span>{t('platform.nav.tenants')}</span>
            </SpaLink>
            <SpaLink
              href="/platform/tenants/new"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-body-sm font-medium transition-colors',
                activeSection === 'create'
                  ? 'bg-action-soft text-on-action-soft'
                  : 'text-ink-soft hover:bg-surface-hover hover:text-ink',
              )}
            >
              <Plus className="size-4" aria-hidden="true" />
              <span>{t('platform.nav.createTenant')}</span>
            </SpaLink>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <LangToggle />
          {operatorEmail ? (
            <span className="hidden text-body-sm text-ink-soft md:inline">{operatorEmail}</span>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            loading={signingOut}
            leadingIcon={<LogOut className="size-4" />}
            onClick={() => void handleLogout()}
          >
            {t('platform.signOut')}
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-screen-xl p-4 md:p-6">{children}</main>
    </div>
  )
}
