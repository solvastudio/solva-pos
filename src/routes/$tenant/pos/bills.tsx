import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyBillsListScreen = lazy(() =>
  import('~/components/pos/fnb/BillsListScreen').then((m) => ({
    default: m.BillsListScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/bills')({
  ssr: false,
  component: PosBillsRouteComponent,
})

function PosBillsRouteComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyBillsListScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
