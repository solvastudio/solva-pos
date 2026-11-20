import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SystemScreen } from '~/components/pos/system/SystemScreen'
import type { SystemVariant } from '~/pos/boot/route-decision'
import { invalidateBootPosCache } from '~/pos/hooks/use-boot'

const VALID_VARIANTS = new Set<SystemVariant>([
  'lease_expired',
  'clock_back',
  'update_required',
  'duplicate_instance',
  'revoked',
  'credential_expired',
  'tenant_suspended',
  'local_db_failed',
])

export const Route = createFileRoute('/$tenant/pos/system')({
  ssr: false,
  component: SystemScreenRouteComponent,
})

function SystemScreenRouteComponent() {
  const { tenant } = Route.useParams()
  const { bootResult, routeDecision } = Route.useRouteContext()
  const navigate = useNavigate()
  const [retrying, setRetrying] = useState(false)

  const searchVariant =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('variant')
      : null

  const variant: SystemVariant =
    routeDecision.to === 'system'
      ? routeDecision.variant
      : searchVariant && VALID_VARIANTS.has(searchVariant as SystemVariant)
        ? (searchVariant as SystemVariant)
        : 'lease_expired'

  const refId = bootResult.kind === 'LOCAL_DB_FAILED' ? bootResult.ref : null

  // If this tab was held passive as a duplicate instance, automatically promote and re-boot once the primary tab closes.
  useEffect(() => {
    if (bootResult.kind !== 'PASSIVE_DUPLICATE' || !bootResult.lockHandle) {
      return
    }
    return bootResult.lockHandle.onPromoted(() => {
      bootResult.releaseLock()
      invalidateBootPosCache(tenant)
      void navigate({ to: '/$tenant/pos', params: { tenant } })
    })
  }, [bootResult, navigate, tenant])

  async function handleRetrySync() {
    setRetrying(true)
    if (bootResult.kind === 'READY' || bootResult.kind === 'PASSIVE_DUPLICATE') {
      bootResult.releaseLock()
    }
    invalidateBootPosCache(tenant)
    await navigate({ to: '/$tenant/pos', params: { tenant } })
    setRetrying(false)
  }

  return (
    <SystemScreen
      variant={variant}
      refId={refId}
      retrying={retrying}
      onRetrySync={() => {
        void handleRetrySync()
      }}
      onReload={() => {
        if (typeof window !== 'undefined' && window.location) {
          window.location.reload()
        }
      }}
      onRepair={() => {
        void navigate({ to: '/$tenant/pos/pair', params: { tenant } })
      }}
    />
  )
}
