import { useTranslation } from 'react-i18next'
import { ClockAlert, Download, Info, LockKeyhole, TriangleAlert, WifiOff } from '~/components/ui'
import type { SyncBannerItem } from '~/pos/sync'

export interface BannersProps {
  banners: readonly SyncBannerItem[]
}

function formatAgeDuration(oldestAt: string | null): string {
  if (!oldestAt) return '0m'
  const ms = Date.parse(oldestAt)
  if (!Number.isFinite(ms)) return '0m'
  const diffMin = Math.max(1, Math.floor((Date.now() - ms) / 60_000))
  if (diffMin < 60) return `${diffMin}m`
  const hours = Math.floor(diffMin / 60)
  return `${hours}h`
}

export function Banners({ banners }: BannersProps) {
  const { t } = useTranslation()

  if (banners.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col border-b border-line" role="region" aria-live="polite">
      {banners.map((item) => {
        switch (item.kind) {
          case 'update_required':
            return (
              <div
                key="update_required"
                className="flex items-center gap-2 bg-danger-soft px-4 py-2 text-caption font-medium text-danger-ink"
              >
                <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
                <span>{t('banner.updateRequired')}</span>
              </div>
            )
          case 'lease_warning':
            return (
              <div
                key="lease_warning"
                className="flex items-center gap-2 bg-warning-soft px-4 py-2 text-caption font-medium text-warning-ink"
              >
                <LockKeyhole className="size-4 shrink-0" aria-hidden="true" />
                <span>{t('banner.leaseWarning', { count: item.hoursLeft })}</span>
              </div>
            )
          case 'offline':
            return (
              <div
                key="offline"
                className="flex items-center gap-2 bg-warning-soft px-4 py-2 text-caption font-medium text-warning-ink"
              >
                <WifiOff className="size-4 shrink-0" aria-hidden="true" />
                <span>{t('banner.offline')}</span>
              </div>
            )
          case 'pending':
            return (
              <div
                key="pending"
                className="flex items-center gap-2 bg-info-soft px-4 py-2 text-caption font-medium text-info-ink"
              >
                <Info className="size-4 shrink-0" aria-hidden="true" />
                <span>
                  {t('banner.pending', {
                    count: item.count,
                    durasi: formatAgeDuration(item.oldestAt),
                  })}
                </span>
              </div>
            )
          case 'clock_warning':
            return (
              <div
                key="clock_warning"
                className="flex items-center gap-2 bg-warning-soft px-4 py-2 text-caption font-medium text-warning-ink"
              >
                <ClockAlert className="size-4 shrink-0" aria-hidden="true" />
                <span>{t('banner.clockWarning')}</span>
              </div>
            )
          case 'update_available':
            return (
              <div
                key="update_available"
                className="flex items-center gap-2 bg-info-soft px-4 py-2 text-caption font-medium text-info-ink"
              >
                <Download className="size-4 shrink-0" aria-hidden="true" />
                <span>{t('banner.updateAvailable')}</span>
              </div>
            )
        }
      })}
    </div>
  )
}
