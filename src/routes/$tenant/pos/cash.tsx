import { lazy, Suspense } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionState } from '~/pos/session/session'

const LazyCashMovementScreen = lazy(() =>
  import('~/components/pos/cash/CashMovementScreen').then((m) => ({
    default: m.CashMovementScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/cash')({
  ssr: false,
  beforeLoad: ({ params }) => {
    const cleanSlug = params.tenant.toLowerCase()
    if (!getSessionState().staff) {
      throw redirect({ href: `/${cleanSlug}/pos/login` })
    }
  },
  component: PosCashRouteComponent,
})

function PosCashRouteComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyCashMovementScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
