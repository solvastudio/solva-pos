import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Banners } from '~/components/layout/Banners'
import { LangToggle } from '~/components/layout/LangToggle'
import { SyncIndicator } from '~/components/layout/SyncIndicator'
import { TenantBadge } from '~/components/layout/TenantBadge'
import { Button } from '~/components/ui/Button'
import {
  Clock,
  Lock,
  LogOut,
  Menu,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
} from '~/components/ui/icons'
import { cn } from '~/lib/cn'
import { useSyncState } from '~/pos/hooks/use-sync-state'

export type PosNavKey = 'sell' | 'history' | 'shift' | 'more'

export interface PosWorkspaceShellProps {
  tenantName: string
  tenantSlug: string
  outletLabel?: string
  staffName?: string
  shiftOpen?: boolean
  activeNav: PosNavKey
  onSyncNow?: () => void
  onLocaleChange?: (locale: 'id-ID' | 'en-US') => void | Promise<void>
  onLockScreen?: () => void
  onSwitchStaff?: () => void
  onOpenShortcuts?: () => void
  children: ReactNode
}

export function PosWorkspaceShell({
  tenantName,
  tenantSlug,
  outletLabel,
  staffName,
  shiftOpen = false,
  activeNav,
  onSyncNow,
  onLocaleChange,
  onLockScreen,
  onSwitchStaff,
  onOpenShortcuts,
  children,
}: PosWorkspaceShellProps) {
  const { t } = useTranslation()
  const { indicator } = useSyncState()
  const navigate = useNavigate()
  const cleanSlug = tenantSlug.toLowerCase()

  const navItems: {
    key: PosNavKey
    label: string
    href: string
    icon: typeof ShoppingCart
  }[] = [
    { key: 'sell', label: t('pos.shellNav.sell'), href: `/${cleanSlug}/pos/sell`, icon: ShoppingCart },
    {
      key: 'history',
      label: t('pos.shellNav.history'),
      href: `/${cleanSlug}/pos/history`,
      icon: ReceiptText,
    },
    {
      key: 'shift',
      label: t('pos.shellNav.shift'),
      href: shiftOpen ? `/${cleanSlug}/pos/shift` : `/${cleanSlug}/pos/shift/open`,
      icon: Clock,
    },
    { key: 'more', label: t('pos.shellNav.more'), href: `/${cleanSlug}/pos/more`, icon: Menu },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-app md:h-dvh md:overflow-hidden">
      <header className="sticky top-0 z-header flex h-topbar shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-3 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <TenantBadge variant="compact" name={tenantName} slug={cleanSlug} />
          <span className="truncate text-label font-semibold text-ink">
            {outletLabel ?? t('pos.shell.registerFallback')}
          </span>
          {shiftOpen ? (
            <span className="hidden shrink-0 rounded-full bg-success-soft px-2 py-0.5 text-caption font-medium text-success-ink sm:inline-flex">
              {t('pos.shellNav.shiftOpenBadge')}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {staffName ? (
            <span className="hidden text-caption font-medium text-ink-soft lg:inline">
              {t('pos.shellNav.staffLabel', { name: staffName })}
            </span>
          ) : null}

          <SyncIndicator indicator={indicator} compact />

          {onSyncNow ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('pos.shell.syncNow')}
              onClick={onSyncNow}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
            </Button>
          ) : null}

          {onOpenShortcuts ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
              onClick={onOpenShortcuts}
            >
              {t('pos.shellNav.shortcuts')}
            </Button>
          ) : null}

          <LangToggle onLocaleChange={onLocaleChange} />

          {onLockScreen ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('pos.shellNav.lockScreen')}
              onClick={onLockScreen}
            >
              <Lock className="size-4" aria-hidden="true" />
            </Button>
          ) : null}

          {onSwitchStaff ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('pos.shellNav.logout')}
              onClick={onSwitchStaff}
            >
              <LogOut className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </header>

      <Banners banners={indicator.banners} />

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t('pos.shellNav.navLabel')}
          className="hidden w-pos-rail shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-line bg-surface py-3 md:flex"
        >
          {navItems.map((item) => {
            const Icon = item.icon
            const active = item.key === activeNav
            return (
              <a
                key={item.key}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  void navigate({ href: item.href })
                }}
                className={cn(
                  'flex min-h-control-md w-14 flex-col items-center justify-center gap-1 rounded-card px-1 py-2 text-caption font-medium transition-colors',
                  active
                    ? 'bg-action text-on-action'
                    : 'text-ink-soft hover:bg-surface-sunken hover:text-ink',
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                <span>{item.label}</span>
              </a>
            )
          })}
        </nav>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col pb-16 md:overflow-y-auto md:pb-0">{children}</main>
      </div>

      <nav
        aria-label={t('pos.shellNav.navLabel')}
        className="fixed inset-x-0 bottom-0 z-header flex h-16 items-center justify-around border-t border-line bg-surface px-2 md:hidden"
      >
        {navItems.map((item) => {
          const Icon = item.icon
          const active = item.key === activeNav
          return (
            <a
              key={item.key}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault()
                void navigate({ href: item.href })
              }}
              className={cn(
                'flex min-h-control-md min-w-16 flex-col items-center justify-center gap-0.5 rounded-card px-2 py-1 text-caption font-medium',
                active ? 'text-action font-semibold' : 'text-ink-soft',
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
              <span>{item.label}</span>
            </a>
          )
        })}
      </nav>
    </div>
  )
}
