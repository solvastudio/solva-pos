import { createFileRoute, useRouteContext } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const LazyQueueScreen = lazy(() =>
  import('~/components/pos/sync/QueueScreen').then((m) => ({
    default: m.QueueScreen,
  })),
)

function QueueRoute() {
  const { tenant } = Route.useParams()
  const { bootResult } = useRouteContext({ from: '/$tenant/pos' })

  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <LazyQueueScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}

export const Route = createFileRoute('/$tenant/pos/queue')({
  ssr: false,
  component: QueueRoute,
})
