import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazySystemRouteScreen = lazy(() =>
  import('~/components/pos/system/SystemRouteScreen').then((m) => ({
    default: m.SystemRouteScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/system')({
  ssr: false,
  component: SystemScreenRouteComponent,
})

function SystemScreenRouteComponent() {
  const { tenant } = Route.useParams()
  const { bootResult, routeDecision } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazySystemRouteScreen
        tenant={tenant}
        bootResult={bootResult}
        routeDecision={routeDecision}
      />
    </Suspense>
  )
}
