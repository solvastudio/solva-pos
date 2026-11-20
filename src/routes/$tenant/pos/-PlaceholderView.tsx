import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Chip } from '~/components/ui/Chip'
import { LangToggle } from '~/components/layout/LangToggle'

export function PosPlaceholderView({ tenant }: { tenant: string }) {
  const { t } = useTranslation()
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return (
    <main className="mx-auto flex min-h-screen max-w-dialog-md flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-4 flex items-center gap-2">
        <Chip
          status={online ? 'online' : 'offline'}
          label={online ? t('pos.placeholder.onlineStatus') : t('pos.placeholder.offlineStatus')}
          announce
        />
        <Chip status="synced" label={t('pos.placeholder.offlineReady')} />
      </div>

      <h1 className="text-h2 font-semibold text-ink">{t('pos.placeholder.title')}</h1>
      <p className="mt-2 text-body-lg text-ink-soft">{t('pos.placeholder.body')}</p>
      <p className="mt-3 text-caption text-ink-muted">
        {`${t('pos.placeholder.tenantLabel')}: ${tenant}`}
      </p>

      <div className="fixed bottom-4 right-4">
        <LangToggle />
      </div>
    </main>
  )
}
