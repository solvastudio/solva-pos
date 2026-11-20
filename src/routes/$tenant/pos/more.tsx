import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyMoreScreen = lazy(() =>
  import('~/components/pos/more/MoreScreen').then((m) => ({
    default: m.MoreScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/more')({
  ssr: false,
  component: PosMoreComponent,
})

function PosMoreComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyMoreScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
