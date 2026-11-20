import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazySellScreen = lazy(() =>
  import('~/components/pos/sell/SellScreen').then((m) => ({
    default: m.SellScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/sell')({
  ssr: false,
  component: PosSellRouteComponent,
})

function PosSellRouteComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazySellScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
