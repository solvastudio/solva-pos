import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyTablesScreen = lazy(() =>
  import('~/components/pos/fnb/TablesScreen').then((m) => ({
    default: m.TablesScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/tables')({
  ssr: false,
  component: PosTablesRouteComponent,
})

function PosTablesRouteComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyTablesScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
