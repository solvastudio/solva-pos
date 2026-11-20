import { useTranslation } from 'react-i18next'
import { Chip, type ChipStatus } from '~/components/ui/Chip'
import type { DerivedSyncIndicator } from '~/pos/sync'

export interface SyncIndicatorProps {
  indicator: DerivedSyncIndicator
  compact?: boolean
}

function formatSyncTime(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function SyncIndicator({ indicator, compact = false }: SyncIndicatorProps) {
  const { t } = useTranslation()

  let status: ChipStatus
  let label: string

  switch (indicator.primary) {
    case 'device_locked':
      status = 'device_locked'
      label = t('status.sync.deviceLocked')
      break
    case 'needs_attention':
      status = 'needs_attention'
      label = t('status.sync.needsAttention', { count: indicator.attentionCount })
      break
    case 'syncing':
      status = 'syncing'
      label = t('status.sync.syncing')
      break
    case 'offline':
      status = 'offline'
      label = t('status.sync.offline')
      break
    case 'synced': {
      status = 'synced'
      const jam = formatSyncTime(indicator.lastSuccessAt)
      label = jam ? t('status.sync.synced', { jam }) : t('status.sync.online')
      break
    }
    case 'online':
      status = 'online'
      label = t('status.sync.online')
      break
  }

  return (
    <div className="flex items-center gap-1.5" data-testid="sync-indicator">
      <Chip status={status} label={label} size={compact ? 'sm' : 'md'} announce />
      {indicator.pendingBadge ? (
        <Chip
          status="pending"
          size="sm"
          label={t('status.sync.pendingCount', { count: indicator.pendingBadge.count })}
        />
      ) : null}
    </div>
  )
}
