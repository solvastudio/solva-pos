import { useRouterState } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { IconButton } from '~/components/ui/IconButton'
import { LogOut, Menu, X } from '~/components/ui/icons'
import { setPreferredLocaleFn, type AdminSessionView } from '~/functions/auth/session.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { APP_VERSION } from '~/lib/app-version'
import { cn } from '~/lib/cn'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import { visibleAdminNavItems } from './admin-nav'
import { LangToggle } from './LangToggle'
import { SpaLink } from './SpaLink'
import { TenantBadge } from './TenantBadge'

export interface AdminShellProps {
  session: AdminSessionView
  children: ReactNode
}

export function AdminShell({ session, children }: AdminShellProps) {
  const { t } = useTranslation()
  const { name, slug } = useCurrentTenant()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const appVersion = typeof APP_VERSION === 'string' ? APP_VERSION : 'dev'

  const navItems = visibleAdminNavItems(session.permissions)

  useEffect(() => {
    if (!drawerOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDrawerOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [drawerOpen])

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await fetch(tenantHref(slug, '/admin/api/auth/sign-out'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    } finally {
      window.location.assign(tenantHref(slug, '/admin/login'))
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-app text-ink">
      <header className="sticky top-0 z-header flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 md:px-6">
        <div className="flex items-center gap-3">
          <IconButton
            label={drawerOpen ? t('admin.shell.menuClose') : t('admin.shell.menuOpen')}
            icon={drawerOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            variant="ghost"
            size="md"
            className="md:hidden"
            aria-expanded={drawerOpen}
            aria-controls="admin-nav-drawer"
            onClick={() => setDrawerOpen((prev) => !prev)}
          />
          <TenantBadge variant="bar" name={name} slug={slug} />
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:block">
            <LangToggle onLocaleChange={(loc) => setPreferredLocaleFn({ data: { locale: loc } }).then(() => undefined)} />
          </div>
          <SpaLink
            href={tenantHref(slug, '/admin/account')}
            className="hidden text-body-sm font-medium text-ink-soft hover:text-ink sm:inline"
          >
            {session.displayName}
          </SpaLink>
          <Button
            variant="ghost"
            size="sm"
            loading={signingOut}
            leadingIcon={<LogOut className="size-4" />}
            onClick={() => void handleSignOut()}
          >
            {t('account.signOut')}
          </Button>
        </div>
      </header>

      <div className="flex w-full flex-1">
        {drawerOpen ? (
          <div
            data-testid="admin-drawer-backdrop"
            aria-hidden="true"
            className="fixed inset-x-0 top-16 bottom-0 z-nav bg-scrim md:hidden"
            onClick={() => setDrawerOpen(false)}
          />
        ) : null}
        <aside
          id="admin-nav-drawer"
          aria-label={t('admin.shell.navLabel')}
          className={cn(
            'fixed top-16 bottom-0 left-0 z-nav w-60 overflow-y-auto overscroll-contain border-r border-line bg-surface p-4',
            drawerOpen ? 'block shadow-modal md:shadow-none' : 'hidden md:block',
          )}
        >
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const itemHref = tenantHref(slug, item.path)
              const active =
                item.path === '/admin'
                  ? pathname === itemHref || pathname === `${itemHref}/`
                  : pathname.startsWith(itemHref)
              return (
                <SpaLink
                  key={item.id}
                  href={itemHref}
                  onClick={() => setDrawerOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-control px-3 py-2.5 text-body font-medium transition-colors',
                    active
                      ? 'bg-action-soft text-on-action-soft'
                      : 'text-ink-soft hover:bg-surface-hover hover:text-ink',
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span>{t(item.labelKey)}</span>
                </SpaLink>
              )
            })}
          </nav>

          <div className="mt-6 flex flex-col items-start gap-3 border-t border-line pt-4 sm:hidden">
            <SpaLink
              href={tenantHref(slug, '/admin/account')}
              onClick={() => setDrawerOpen(false)}
              className="w-full truncate px-1 text-body-sm font-medium text-ink-soft hover:text-ink"
            >
              {session.displayName}
            </SpaLink>
            <LangToggle onLocaleChange={(loc) => setPreferredLocaleFn({ data: { locale: loc } }).then(() => undefined)} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col md:pl-60">
          <main className="min-w-0 flex-1 p-4 md:p-6">
            <div className="mx-auto w-full max-w-screen-xl">{children}</div>
          </main>
          <footer className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-line-subtle bg-surface px-4 py-3 text-center text-caption text-ink-soft md:px-6">
            <span>
              {t('admin.shell.footerMadeBy')}{' '}
              <a
                href="https://www.solvastudio.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-ink-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded-xs"
              >
                {t('admin.shell.footerStudioUrl')}
              </a>
            </span>
            <span aria-hidden="true" className="text-ink-muted">
              {'·'}
            </span>
            <span className="font-mono text-ink-muted">
              {t('admin.shell.footerVersion', { version: appVersion })}
            </span>
          </footer>
        </div>
      </div>
    </div>
  )
}
