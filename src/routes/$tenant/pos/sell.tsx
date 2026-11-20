import { lazy, Suspense } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionState } from '~/pos/session/session'

const LazySellScreen = lazy(() =>
  import('~/components/pos/sell/SellScreen').then((m) => ({
    default: m.SellScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/sell')({
  ssr: false,
  beforeLoad: ({ params }) => {
    const cleanSlug = params.tenant.toLowerCase()
    if (!getSessionState().staff) {
      throw redirect({ href: `/${cleanSlug}/pos/login` })
    }
  },
  component: PosSellRouteComponent,
})

function PosSellRouteComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazySellScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
