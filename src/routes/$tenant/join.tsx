import { createFileRoute } from '@tanstack/react-router'
import { RedeemCodeForm } from '~/components/layout/RedeemCodeForm'
import { useCurrentTenant } from '~/hooks/use-current-tenant'

export const Route = createFileRoute('/$tenant/join')({
  component: TenantJoinPage,
})

function TenantJoinPage() {
  const { name, slug } = useCurrentTenant()
  return <RedeemCodeForm kind="join" tenantName={name} tenantSlug={slug} />
}
