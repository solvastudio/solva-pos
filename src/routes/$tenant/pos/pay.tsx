import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyPayRouteScreen = lazy(() =>
  import('~/components/pos/pay/PayRouteScreen').then((m) => ({
    default: m.PayRouteScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/pay')({
  ssr: false,
  component: PosPayRouteComponent,
})

function PosPayRouteComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyPayRouteScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
