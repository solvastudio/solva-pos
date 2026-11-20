import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyPosPlaceholderView = lazy(() =>
  import('./-PlaceholderView').then((m) => ({
    default: m.PosPlaceholderView,
  })),
)

export const Route = createFileRoute('/$tenant/pos/$')({
  ssr: false,
  component: PosSplatRouteComponent,
})

function PosSplatRouteComponent() {
  const { tenant } = Route.useParams()
  return (
    <Suspense fallback={null}>
      <LazyPosPlaceholderView tenant={tenant} />
    </Suspense>
  )
}
