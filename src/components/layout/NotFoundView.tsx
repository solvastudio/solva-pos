import { useTranslation } from 'react-i18next'
import { Compass } from '~/components/ui'
import { SystemPage } from './SystemPage'

export function NotFoundView() {
  const { t } = useTranslation()

  return (
    <SystemPage>
      <div className="flex flex-col items-center text-center">
        <Compass className="size-10 text-ink-muted" aria-hidden="true" />
        <h1 className="mt-4 text-h2 font-semibold text-ink">{t('sys.notFound.title')}</h1>
        <p className="mt-2 text-body-lg text-ink-soft">{t('sys.notFound.body')}</p>
      </div>
    </SystemPage>
  )
}
