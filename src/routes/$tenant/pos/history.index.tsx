import { lazy, Suspense } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionState } from '~/pos/session/session'

const LazyHistoryListScreen = lazy(() =>
  import('~/components/pos/history/HistoryListScreen').then((m) => ({
    default: m.HistoryListScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/history/')({
  ssr: false,
  beforeLoad: ({ params }) => {
    const cleanSlug = params.tenant.toLowerCase()
    if (!getSessionState().staff) {
      throw redirect({ href: `/${cleanSlug}/pos/login` })
    }
  },
  component: PosHistoryIndexComponent,
})

function PosHistoryIndexComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyHistoryListScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
