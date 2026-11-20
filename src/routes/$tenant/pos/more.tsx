import { lazy, Suspense } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionState } from '~/pos/session/session'

const LazyMoreScreen = lazy(() =>
  import('~/components/pos/more/MoreScreen').then((m) => ({
    default: m.MoreScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/more')({
  ssr: false,
  beforeLoad: ({ params }) => {
    const cleanSlug = params.tenant.toLowerCase()
    if (!getSessionState().staff) {
      throw redirect({ href: `/${cleanSlug}/pos/login` })
    }
  },
  component: PosMoreComponent,
})

function PosMoreComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyMoreScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
