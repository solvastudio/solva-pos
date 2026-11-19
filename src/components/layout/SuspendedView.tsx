import { useTranslation } from 'react-i18next'
import { CirclePause } from '~/components/ui'
import { SystemPage } from './SystemPage'

export function SuspendedView() {
  const { t } = useTranslation()

  return (
    <SystemPage>
      <div className="flex flex-col items-center text-center">
        <CirclePause className="size-10 text-ink-muted" aria-hidden="true" />
        <h1 className="mt-4 text-h2 font-semibold text-ink">{t('sys.unavailable.title')}</h1>
        <p className="mt-2 text-body-lg text-ink-soft">{t('sys.unavailable.body')}</p>
      </div>
    </SystemPage>
  )
}
