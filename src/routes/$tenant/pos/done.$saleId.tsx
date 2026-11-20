import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyDoneRouteScreen = lazy(() =>
  import('~/components/pos/done/DoneRouteScreen').then((m) => ({
    default: m.DoneRouteScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/done/$saleId')({
  ssr: false,
  component: PosDoneRouteComponent,
})

function PosDoneRouteComponent() {
  const { tenant, saleId } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyDoneRouteScreen tenant={tenant} saleId={saleId} bootResult={bootResult} />
    </Suspense>
  )
}
