import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyLoginRouteScreen = lazy(() =>
  import('~/components/pos/login/LoginRouteScreen').then((m) => ({
    default: m.LoginRouteScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/login')({
  ssr: false,
  component: PosLoginRouteComponent,
})

function PosLoginRouteComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyLoginRouteScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
