import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyPairRouteScreen = lazy(() =>
  import('~/components/pos/pairing/PairRouteScreen').then((m) => ({
    default: m.PairRouteScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/pair')({
  ssr: false,
  component: PairScreenRouteComponent,
})

function PairScreenRouteComponent() {
  const { tenant } = Route.useParams()
  return (
    <Suspense fallback={null}>
      <LazyPairRouteScreen tenant={tenant} />
    </Suspense>
  )
}
