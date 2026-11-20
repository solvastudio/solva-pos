import { useEffect, useState } from 'react'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { ErrorBoundaryArea } from '~/components/layout/ErrorBoundaryArea'
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
    const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null
    clearBootCrashHistory(tenant, storage)

    const win = window as unknown as { __solvaPosMarkBootOk?: () => void }
    win.__solvaPosMarkBootOk?.()

    const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
    notifyPosBootOk({ appVersion, dbVersion: 0 })
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

  return (
    <ErrorBoundaryArea area="pos-shell" homeHref={`/${tenant}/pos/`}>
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
