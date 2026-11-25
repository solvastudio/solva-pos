import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazySplitScreen = lazy(() =>
  import('~/components/pos/fnb/SplitScreen').then((m) => ({ default: m.SplitScreen })),
)

export const Route = createFileRoute('/$tenant/pos/bill/$billId_/split')({
  ssr: false,
  component: PosBillSplitRouteComponent,
})

function PosBillSplitRouteComponent() {
  const { tenant, billId } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazySplitScreen tenant={tenant} billId={billId} bootResult={bootResult} />
    </Suspense>
  )
}
