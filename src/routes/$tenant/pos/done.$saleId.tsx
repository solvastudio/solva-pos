import { lazy, Suspense } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionState } from '~/pos/session/session'

const LazyDoneRouteScreen = lazy(() =>
  import('~/components/pos/done/DoneRouteScreen').then((m) => ({
    default: m.DoneRouteScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/done/$saleId')({
  ssr: false,
  beforeLoad: ({ params }) => {
    const cleanSlug = params.tenant.toLowerCase()
    if (!getSessionState().staff) {
      throw redirect({ href: `/${cleanSlug}/pos/login` })
    }
  },
  component: PosDoneRouteComponent,
})

function PosDoneRouteComponent() {
  const { tenant, saleId } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyDoneRouteScreen tenant={tenant} saleId={saleId} bootResult={bootResult} />
    </Suspense>
  )
}
