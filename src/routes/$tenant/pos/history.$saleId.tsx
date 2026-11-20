import { lazy, Suspense } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionState } from '~/pos/session/session'

const LazySaleDetailScreen = lazy(() =>
  import('~/components/pos/history/SaleDetailScreen').then((m) => ({
    default: m.SaleDetailScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/history/$saleId')({
  ssr: false,
  beforeLoad: ({ params }) => {
    const cleanSlug = params.tenant.toLowerCase()
    if (!getSessionState().staff) {
      throw redirect({ href: `/${cleanSlug}/pos/login` })
    }
  },
  component: PosHistoryDetailComponent,
})

function PosHistoryDetailComponent() {
  const { tenant, saleId } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazySaleDetailScreen tenant={tenant} saleId={saleId} bootResult={bootResult} />
    </Suspense>
  )
}
