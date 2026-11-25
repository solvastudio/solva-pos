import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyBillDetailScreen = lazy(() =>
  import('~/components/pos/fnb/BillDetailScreen').then((m) => ({
    default: m.BillDetailScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/bill/$billId')({
  ssr: false,
  component: PosBillDetailRouteComponent,
})

function PosBillDetailRouteComponent() {
  const { tenant, billId } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyBillDetailScreen tenant={tenant} billId={billId} bootResult={bootResult} />
    </Suspense>
  )
}
