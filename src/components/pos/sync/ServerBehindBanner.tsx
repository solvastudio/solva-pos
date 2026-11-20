import { useTranslation } from 'react-i18next'
import { Info } from '~/components/ui/icons'

export function ServerBehindBanner() {
  const { t } = useTranslation()
  return (
    <div
      className="flex items-center gap-2 bg-info-soft px-4 py-2 text-caption font-medium text-info-ink"
      data-testid="server-behind-banner"
    >
      <Info className="size-4 shrink-0" aria-hidden="true" />
      <span>{t('banner.serverBehind')}</span>
    </div>
  )
}
