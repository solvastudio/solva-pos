import { lazy, Suspense } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionState } from '~/pos/session/session'

const LazyPayRouteScreen = lazy(() =>
  import('~/components/pos/pay/PayRouteScreen').then((m) => ({
    default: m.PayRouteScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/pay')({
  ssr: false,
  beforeLoad: ({ params }) => {
    const cleanSlug = params.tenant.toLowerCase()
    if (!getSessionState().staff) {
      throw redirect({ href: `/${cleanSlug}/pos/login` })
    }
  },
  component: PosPayRouteComponent,
})

function PosPayRouteComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyPayRouteScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
