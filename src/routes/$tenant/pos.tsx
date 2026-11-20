import { useEffect, useState } from 'react'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { PosRootBoundary } from '~/components/layout/PosRootBoundary'
import { changeLocale } from '~/i18n'
import type { BootResult } from '~/pos/boot/boot'
import { decideRoute, type RouteDecision } from '~/pos/boot/route-decision'
import { getCachedBootPos } from '~/pos/hooks/use-boot'
import { clearBootCrashHistory } from '~/pwa/boot-guard'
import { notifyPosBootOk, registerPosServiceWorker } from '~/pwa/register'
import type { UpdateManager, UpdateStatus } from '~/pwa/update-manager'

export interface PosRouteContext {
  bootResult: BootResult
  routeDecision: RouteDecision
}

export const Route = createFileRoute('/$tenant/pos')({
  ssr: false,
  beforeLoad: async ({ params, location }): Promise<PosRouteContext> => {
    const bootResult = await getCachedBootPos(params.tenant)
    const routeDecision = decideRoute(bootResult)
    const cleanSlug = params.tenant.toLowerCase()
    const path = location.pathname.replace(/\/+$/, '')

    const pairPath = `/${cleanSlug}/pos/pair`
    const systemPath = `/${cleanSlug}/pos/system`
    const loginPath = `/${cleanSlug}/pos/login`

    if (routeDecision.to === 'pair' && path !== pairPath) {
      throw redirect({
        href: `${pairPath}${location.hash ?? ''}`,
      })
    }

    if (routeDecision.to === 'system') {
      const canRepairFromSystem =
        (routeDecision.variant === 'revoked' ||
          routeDecision.variant === 'credential_expired') &&
        path === pairPath

      if (!canRepairFromSystem && path !== systemPath) {
        throw redirect({
          href: `${systemPath}?variant=${routeDecision.variant}`,
        })
      }
    }

    if (routeDecision.to === 'login' && (path === `/${cleanSlug}/pos` || path === pairPath || path === systemPath)) {
      throw redirect({
        href: loginPath,
      })
    }

    return { bootResult, routeDecision }
  },
  head: () => ({
    links: [{ rel: 'manifest', href: './manifest.webmanifest' }],
  }),
  component: PosLayoutComponent,
})

function PosLayoutComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('none')
  const [updateManager, setUpdateManager] = useState<UpdateManager | null>(null)

  useEffect(() => {
    clearBootCrashHistory(tenant)

    const win = window as unknown as { __solvaPosMarkBootOk?: () => void }
    win.__solvaPosMarkBootOk?.()

    if (bootResult.kind === 'READY') {
      void changeLocale(bootResult.locale)
    }

    const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
    notifyPosBootOk({ appVersion, dbVersion: 1 })
  }, [bootResult, tenant])

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
    <PosRootBoundary tenantSlug={tenant}>
      <div
        data-pos-shell="true"
        data-tenant={tenant}
        data-sw-update={updateStatus}
        data-has-manager={updateManager ? 'true' : 'false'}
      >
        <Outlet />
      </div>
    </PosRootBoundary>
  )
}
