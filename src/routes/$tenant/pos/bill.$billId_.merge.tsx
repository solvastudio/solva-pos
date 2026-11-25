import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyMergeScreen = lazy(() =>
  import('~/components/pos/fnb/MergeScreen').then((m) => ({ default: m.MergeScreen })),
)

export const Route = createFileRoute('/$tenant/pos/bill/$billId_/merge')({
  ssr: false,
  component: PosBillMergeRouteComponent,
})

function PosBillMergeRouteComponent() {
  const { tenant, billId } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyMergeScreen tenant={tenant} billId={billId} bootResult={bootResult} />
    </Suspense>
  )
}
