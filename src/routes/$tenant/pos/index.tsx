import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionState } from '~/pos/session/session'
import { PosPlaceholderView } from './-PlaceholderView'

export const Route = createFileRoute('/$tenant/pos/')({
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
      const open = await getOpenShiftForRegister(
        bootResult.db as Parameters<typeof getOpenShiftForRegister>[0],
        bootResult.device.register_id,
      )
      throw redirect({
        href: open ? `/${cleanSlug}/pos/sell` : `/${cleanSlug}/pos/shift/open`,
      })
    }
  },
  component: PosIndexRouteComponent,
})

function PosIndexRouteComponent() {
  const { tenant } = Route.useParams()
  return <PosPlaceholderView tenant={tenant} />
}
