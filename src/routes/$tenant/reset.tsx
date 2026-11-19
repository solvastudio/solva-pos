import { createFileRoute } from '@tanstack/react-router'
import { RedeemCodeForm } from '~/components/layout/RedeemCodeForm'
import { useCurrentTenant } from '~/hooks/use-current-tenant'

export const Route = createFileRoute('/$tenant/reset')({
  component: TenantResetPage,
})

function TenantResetPage() {
  const { name, slug } = useCurrentTenant()
  return <RedeemCodeForm kind="reset" tenantName={name} tenantSlug={slug} />
}
