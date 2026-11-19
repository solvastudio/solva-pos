import { useTranslation } from 'react-i18next'
import { BRAND_NAME } from '~/lib/brand'
import { cn } from '~/lib/cn'

export interface TenantBadgeProps {
  name: string
  slug?: string
  variant: 'hero' | 'bar' | 'compact'
}

function getInitials(rawName: string): string {
  const words = rawName
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
  if (words.length === 0) {
    return 'S'
  }
  if (words.length === 1) {
    return words[0]!.slice(0, 2).toUpperCase()
  }
  return `${words[0]![0]!}${words[1]![0]!}`.toUpperCase()
}

export function TenantBadge({ name, slug, variant }: TenantBadgeProps) {
  const { t } = useTranslation()
  const displayName = name.trim().length > 0 ? name.trim() : BRAND_NAME
  const initials = getInitials(displayName)
  const slugLabel = slug ? `/${slug}` : ''

  return (
    <div
      aria-label={t('tenant.badgeLabel', { name: displayName })}
      title={displayName}
      className={cn('flex min-w-0 items-center', variant === 'hero' ? 'gap-4' : 'gap-2.5')}
    >
      <div
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-primary-700 font-semibold text-on-action select-none',
          variant === 'hero' ? 'size-14 text-h2' : 'size-8 text-label',
        )}
      >
        {initials}
      </div>
      {variant !== 'compact' && (
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-ink font-semibold',
              variant === 'hero' ? 'line-clamp-2 text-h2' : 'truncate text-label',
            )}
          >
            {displayName}
          </p>
          {variant === 'hero' && slugLabel && (
            <p className="mt-0.5 truncate font-mono text-caption text-ink-muted">{slugLabel}</p>
          )}
        </div>
      )}
    </div>
  )
}
