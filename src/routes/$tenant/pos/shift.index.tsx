import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyShiftOverviewScreen = lazy(() =>
  import('~/components/pos/shift/ShiftOverviewScreen').then((m) => ({
    default: m.ShiftOverviewScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/shift/')({
  ssr: false,
  component: PosShiftOverviewComponent,
})

function PosShiftOverviewComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyShiftOverviewScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
