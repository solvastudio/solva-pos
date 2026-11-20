import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyCloseShiftScreen = lazy(() =>
  import('~/components/pos/shift/CloseShiftScreen').then((m) => ({
    default: m.CloseShiftScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/shift/close')({
  ssr: false,
  component: PosCloseShiftComponent,
})

function PosCloseShiftComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyCloseShiftScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
