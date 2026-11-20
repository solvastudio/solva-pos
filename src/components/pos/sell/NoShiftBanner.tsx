import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from '~/components/ui/icons'

export interface NoShiftBannerProps {
  tenantSlug: string
}

export function NoShiftBanner({ tenantSlug }: NoShiftBannerProps) {
  const { t } = useTranslation()
  const cleanSlug = tenantSlug.toLowerCase()

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-warning-line bg-warning-soft px-4 py-3 text-warning-ink"
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <span className="text-label font-semibold">{t('pos.shift.bannerRequiredTitle')}</span>
          <span className="text-caption">{t('pos.shift.bannerRequiredBody')}</span>
        </div>
      </div>

      <Link
        to="/$tenant/pos/shift/open"
        params={{ tenant: cleanSlug }}
        className="inline-flex min-h-touch items-center justify-center rounded-button bg-action px-4 text-label font-semibold text-on-action transition-colors hover:bg-action-hover"
      >
        {t('pos.shift.openShiftCta')}
      </Link>
    </div>
  )
}
