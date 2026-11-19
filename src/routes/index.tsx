import { createFileRoute, notFound } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw notFound()
  },
  notFoundComponent: RootNotFound,
})

function RootNotFound() {
  const { t } = useTranslation()
  return (
    <main className="p-6">
      <h1 className="text-lg font-semibold">{t('error.notFound.title')}</h1>
      <p className="mt-1 text-sm">{t('error.notFound.body')}</p>
    </main>
  )
}
