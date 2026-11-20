import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyHistoryListScreen = lazy(() =>
  import('~/components/pos/history/HistoryListScreen').then((m) => ({
    default: m.HistoryListScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/history/')({
  ssr: false,
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
