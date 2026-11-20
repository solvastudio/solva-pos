import { lazy, Suspense } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionState } from '~/pos/session/session'

const LazyShiftOverviewScreen = lazy(() =>
  import('~/components/pos/shift/ShiftOverviewScreen').then((m) => ({
    default: m.ShiftOverviewScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/shift/')({
  ssr: false,
  beforeLoad: ({ params }) => {
    const cleanSlug = params.tenant.toLowerCase()
    if (!getSessionState().staff) {
      throw redirect({ href: `/${cleanSlug}/pos/login` })
    }
  },
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
