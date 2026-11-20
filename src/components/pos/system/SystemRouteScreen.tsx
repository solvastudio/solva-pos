import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { SystemScreen } from '~/components/pos/system/SystemScreen'
import type { BootResult } from '~/pos/boot/boot'
import type { RouteDecision, SystemVariant } from '~/pos/boot/route-decision'
import { findTenantIdBySlug } from '~/pos/db/registry'
import { invalidateBootPosCache } from '~/pos/hooks/use-boot'
import {
  exportPending,
  exportPendingDynamic,
  triggerBlobDownload,
} from '~/pos/maintenance/export-pending'

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

export function SystemRouteScreen({
  tenant,
  bootResult,
  routeDecision,
}: {
  tenant: string
  bootResult: BootResult
  routeDecision: RouteDecision
}) {
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

  async function handleExportPending() {
    if (bootResult.kind === 'READY') {
      const exp = await exportPending(bootResult.db)
      triggerBlobDownload(exp.blob, exp.filename)
      return
    }
    const tid = await findTenantIdBySlug(tenant)
    if (tid) {
      const exp = await exportPendingDynamic(tid)
      if (exp) {
        triggerBlobDownload(exp.blob, exp.filename)
      }
    }
  }

  return (
    <SystemScreen
      variant={variant}
      refId={refId}
      retrying={retrying}
      onExportPending={() => {
        void handleExportPending()
      }}
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
