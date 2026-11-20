import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { ErrorBoundaryArea, type ErrorBoundaryErrorDetails } from '~/components/layout/ErrorBoundaryArea'
import { findTenantIdBySlug } from '~/pos/db/registry'
import { openTenantDb } from '~/pos/db/solva-db'
import { logDevice } from '~/pos/maintenance/device-log'
import { clearBootCrashHistory } from '~/pwa/boot-guard'
import { notifyPosBootOk, registerPosServiceWorker } from '~/pwa/register'
import type { UpdateManager, UpdateStatus } from '~/pwa/update-manager'

export const Route = createFileRoute('/$tenant/pos')({
  ssr: false,
  head: () => ({
    links: [{ rel: 'manifest', href: './manifest.webmanifest' }],
  }),
  component: PosLayoutComponent,
})

function PosLayoutComponent() {
  const { tenant } = Route.useParams()
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('none')
  const [updateManager, setUpdateManager] = useState<UpdateManager | null>(null)

  useEffect(() => {
    clearBootCrashHistory(tenant)

    const win = window as unknown as { __solvaPosMarkBootOk?: () => void }
    win.__solvaPosMarkBootOk?.()

    const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
    notifyPosBootOk({ appVersion, dbVersion: 1 })
  }, [tenant])

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    void registerPosServiceWorker(tenant, {
      onUpdateAvailable: (mgr) => {
        if (!cancelled) {
          setUpdateStatus(mgr.getStatus())
        }
      },
    }).then((mgr) => {
      if (!mgr || cancelled) return
      setUpdateManager(mgr)
      setUpdateStatus(mgr.getStatus())
      unsubscribe = mgr.subscribe((status) => {
        if (!cancelled) {
          setUpdateStatus(status)
        }
      })
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [tenant])

  const handlePosBoundaryError = useCallback(
    (_refLocal: string, error: Error, details?: ErrorBoundaryErrorDetails) => {
      void findTenantIdBySlug(tenant)
        .then(async (tenantId) => {
          if (!tenantId) return
          const db = await openTenantDb(tenantId)
          await logDevice(db, {
            level: 'error',
            code: 'APP_ERROR',
            route: details?.route ?? `/${tenant}/pos`,
            stack: error.stack ?? error.message,
            componentStack: details?.componentStack,
            ctx: { area: 'pos-shell', errorName: error.name },
          })
        })
        .catch(() => {
          // Swallow Dexie logging errors so boundary recovery UI always renders.
        })
    },
    [tenant],
  )

  return (
    <ErrorBoundaryArea area="pos-shell" homeHref={`/${tenant}/pos/`} onError={handlePosBoundaryError}>
      <div
        data-pos-shell="true"
        data-tenant={tenant}
        data-sw-update={updateStatus}
        data-has-manager={updateManager ? 'true' : 'false'}
      >
        <Outlet />
      </div>
    </ErrorBoundaryArea>
  )
}
