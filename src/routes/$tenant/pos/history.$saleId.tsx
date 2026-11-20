import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazySaleDetailScreen = lazy(() =>
  import('~/components/pos/history/SaleDetailScreen').then((m) => ({
    default: m.SaleDetailScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/history/$saleId')({
  ssr: false,
  component: PosHistoryDetailComponent,
})

function PosHistoryDetailComponent() {
  const { tenant, saleId } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazySaleDetailScreen tenant={tenant} saleId={saleId} bootResult={bootResult} />
    </Suspense>
  )
}
