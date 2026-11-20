import { lazy, Suspense } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionState } from '~/pos/session/session'

const LazyOpenShiftScreen = lazy(() =>
  import('~/components/pos/shift/OpenShiftScreen').then((m) => ({
    default: m.OpenShiftScreen,
  })),
)

export const Route = createFileRoute('/$tenant/pos/shift/open')({
  ssr: false,
  beforeLoad: async ({ params, context }) => {
    const cleanSlug = params.tenant.toLowerCase()
    const staff = getSessionState().staff
    if (!staff) {
      throw redirect({ href: `/${cleanSlug}/pos/login` })
    }
    const { bootResult } = context as {
      bootResult?: { kind: string; db?: unknown; device?: { register_id: string } }
    }
    if (bootResult?.kind === 'READY' && bootResult.db && bootResult.device) {
      const { getOpenShiftForRegister } = await import('~/pos/data/shift.repo')
      const existing = await getOpenShiftForRegister(
        bootResult.db as Parameters<typeof getOpenShiftForRegister>[0],
        bootResult.device.register_id,
      )
      if (existing) {
        throw redirect({ href: `/${cleanSlug}/pos/sell` })
      }
    }
  },
  component: PosShiftOpenRouteComponent,
})

function PosShiftOpenRouteComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  return (
    <Suspense fallback={null}>
      <LazyOpenShiftScreen tenant={tenant} bootResult={bootResult} />
    </Suspense>
  )
}
