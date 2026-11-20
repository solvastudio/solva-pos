import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazySettingsScreen = lazy(() =>
  import('~/components/pos/settings/SettingsScreen').then((m) => ({
    default: m.SettingsScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/settings')({
  ssr: false,
  component: PosSettingsRouteComponent,
})

function PosSettingsRouteComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazySettingsScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
