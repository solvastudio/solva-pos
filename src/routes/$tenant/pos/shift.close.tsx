import { lazy, Suspense } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionState } from '~/pos/session/session'

const LazyCloseShiftScreen = lazy(() =>
  import('~/components/pos/shift/CloseShiftScreen').then((m) => ({
    default: m.CloseShiftScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/shift/close')({
  ssr: false,
  beforeLoad: ({ params }) => {
    const cleanSlug = params.tenant.toLowerCase()
    if (!getSessionState().staff) {
      throw redirect({ href: `/${cleanSlug}/pos/login` })
    }
  },
  component: PosCloseShiftComponent,
})

function PosCloseShiftComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyCloseShiftScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
