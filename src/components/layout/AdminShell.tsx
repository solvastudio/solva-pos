import { useRouterState } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { IconButton } from '~/components/ui/IconButton'
import { LogOut, Menu, X } from '~/components/ui/icons'
import { setPreferredLocaleFn, type AdminSessionView } from '~/functions/auth/session.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { cn } from '~/lib/cn'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import { visibleAdminNavItems } from './admin-nav'
import { LangToggle } from './LangToggle'
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

  const navItems = visibleAdminNavItems(session.permissions)

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
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-header flex h-16 items-center justify-between gap-3 border-b border-line bg-surface px-4 md:px-6">
        <div className="flex items-center gap-3">
          <IconButton
            label={drawerOpen ? t('admin.shell.menuClose') : t('admin.shell.menuOpen')}
            icon={drawerOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            variant="ghost"
            size="md"
            className="md:hidden"
            onClick={() => setDrawerOpen((prev) => !prev)}
          />
          <TenantBadge variant="bar" name={name} slug={slug} />
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:block">
            <LangToggle onLocaleChange={(loc) => setPreferredLocaleFn({ data: { locale: loc } }).then(() => undefined)} />
          </div>
          <a
            href={tenantHref(slug, '/admin/account')}
            className="hidden text-body-sm font-medium text-ink-soft hover:text-ink sm:inline"
          >
            {session.displayName}
          </a>
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

      <div className="mx-auto flex w-full max-w-screen-xl">
        <aside
          aria-label={t('admin.shell.navLabel')}
          className={cn(
            'w-60 shrink-0 border-r border-line bg-surface p-4 md:block md:min-h-screen',
            drawerOpen ? 'fixed inset-y-16 left-0 z-nav shadow-card' : 'hidden',
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
                <a
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
                </a>
              )
            })}
          </nav>

          <div className="mt-6 border-t border-line pt-4 sm:hidden">
            <LangToggle onLocaleChange={(loc) => setPreferredLocaleFn({ data: { locale: loc } }).then(() => undefined)} />
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
