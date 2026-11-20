import { createFileRoute } from '@tanstack/react-router'
import { PosPlaceholderView } from './-PlaceholderView'

export const Route = createFileRoute('/$tenant/pos/')({
  ssr: false,
  component: PosIndexRouteComponent,
})

function PosIndexRouteComponent() {
  const { tenant } = Route.useParams()
  return <PosPlaceholderView tenant={tenant} />
}
