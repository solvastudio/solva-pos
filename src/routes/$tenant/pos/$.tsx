import { createFileRoute } from '@tanstack/react-router'
import { PosPlaceholderView } from './-PlaceholderView'

export const Route = createFileRoute('/$tenant/pos/$')({
  ssr: false,
  component: PosSplatRouteComponent,
})

function PosSplatRouteComponent() {
  const { tenant } = Route.useParams()
  return <PosPlaceholderView tenant={tenant} />
}
