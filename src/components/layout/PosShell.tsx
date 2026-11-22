import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { RefreshCw } from '~/components/ui/icons'
import { useSyncState } from '~/pos/hooks/use-sync-state'
import { Banners } from './Banners'
import { LangToggle } from './LangToggle'
import { SyncIndicator } from './SyncIndicator'
import { TenantBadge } from './TenantBadge'

export interface PosShellProps {
  tenantName: string
  tenantSlug: string
  registerName?: string
  onSyncNow?: () => void
  onLocaleChange?: (locale: 'id-ID' | 'en-US') => void | Promise<void>
  children: ReactNode
}

export function PosShell({
  tenantName,
  tenantSlug,
  registerName,
  onSyncNow,
  onLocaleChange,
  children,
}: PosShellProps) {
  const { t } = useTranslation()
  const { indicator } = useSyncState()

  return (
    <div className="flex min-h-screen flex-col bg-app">
      <header className="sticky top-0 z-header flex h-topbar items-center justify-between gap-3 border-b border-line bg-surface px-4">
        <div className="flex min-w-0 items-center gap-3">
          <TenantBadge variant="compact" name={tenantName} slug={tenantSlug} />
          <span className="truncate text-label font-semibold text-ink">
            {registerName ?? t('pos.shell.registerFallback')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <SyncIndicator indicator={indicator} />
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
          <LangToggle onLocaleChange={onLocaleChange} />
        </div>
      </header>

      <Banners banners={indicator.banners} />

      <div className="flex-1">{children}</div>
    </div>
  )
}
