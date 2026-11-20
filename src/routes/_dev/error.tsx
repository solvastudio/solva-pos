import { createFileRoute, notFound } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBoundaryArea } from '~/components/layout/ErrorBoundaryArea'
import { Button, Card } from '~/components/ui'

export const Route = createFileRoute('/_dev/error')({
  beforeLoad: () => {
    if (!import.meta.env.DEV && !import.meta.env.VITE_E2E) {
      throw notFound()
    }
  },
  component: DevErrorPage,
})

function CrashableWidget({ shouldCrash }: { shouldCrash: boolean }) {
  if (shouldCrash) {
    throw new Error('Simulated render crash from /_dev/error')
  }
  return null
}

function DevErrorPage() {
  const { t } = useTranslation()
  const [crashed, setCrashed] = useState(false)

  return (
    <main className="mx-auto max-w-content space-y-6 px-4 py-8">
      <Card padding="admin">
        <h1 className="text-h1 font-semibold text-ink">{t('dev.error.title')}</h1>
        <p className="mt-2 text-body text-ink-soft">{t('dev.error.desc')}</p>
        <div className="mt-4">
          <Button variant="danger" size="lg" onClick={() => setCrashed(true)}>
            {t('dev.error.trigger')}
          </Button>
        </div>
      </Card>

      <ErrorBoundaryArea area="dev-error-harness" onReset={() => setCrashed(false)}>
        <CrashableWidget shouldCrash={crashed} />
      </ErrorBoundaryArea>
    </main>
  )
}
