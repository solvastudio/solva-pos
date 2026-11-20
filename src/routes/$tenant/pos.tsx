import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createFileRoute, Outlet, redirect, useNavigate } from '@tanstack/react-router'
import { PosRootBoundary } from '~/components/layout/PosRootBoundary'
import { changeLocale } from '~/i18n'
import type { BootResult } from '~/pos/boot/boot'
import { decideRoute, type RouteDecision } from '~/pos/boot/route-decision'
import { getCachedBootPos, invalidateBootPosCache } from '~/pos/hooks/use-boot'
import { createIdleLockController } from '~/pos/session/idle-lock'
import { clearSession, getSessionState } from '~/pos/session/session'
import type { SyncController } from '~/pos/sync'
import type { PersistentUpdateController } from '~/pos/sync/update-manager'
import { clearBootCrashHistory } from '~/pwa/boot-guard'
import { notifyPosBootOk, registerPosServiceWorker } from '~/pwa/register'
import type { UpdateManager, UpdateStatus } from '~/pwa/update-manager'

const LazyUpdateDialog = lazy(() =>
  import('~/components/pos/sync/UpdateDialog').then((m) => ({
    default: m.UpdateDialog,
  })),
)

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

    if (
      routeDecision.to === 'login' &&
      ((path !== loginPath &&
        path !== pairPath &&
        path !== systemPath &&
        getSessionState().staff === null) ||
        path === pairPath ||
        path === systemPath)
    ) {
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
  const navigate = useNavigate()
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('none')
  const [updateManager, setUpdateManager] = useState<UpdateManager | null>(null)
  const persistentUpdateRef = useRef<PersistentUpdateController | null>(null)
  const [updatePrompt, setUpdatePrompt] = useState<{
    visible: boolean
    mandatory: boolean
    canSnooze: boolean
  }>({ visible: false, mandatory: false, canSnooze: false })

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

  // 10-minute monotonic inactivity lock (BR-AUT-015, FLOW-20) preserving active cart/bill state
  useEffect(() => {
    if (bootResult.kind !== 'READY') return
    const { db } = bootResult

    const ctrl = createIdleLockController({
      isActive: () => getSessionState().staff !== null,
      isPaused: () => {
        const st = getSessionState()
        return st.paymentInProgress || st.supervisorDialogOpen
      },
      onLock: async () => {
        const staff = getSessionState().staff
        if (!staff) return
        const { getMeta, setMeta } = await import('~/pos/data/meta.repo')
        const clock = await getMeta(db, 'clock')
        const lockedAt = new Date(Date.now() + (clock?.offset_ms ?? 0)).toISOString()
        await setMeta(db, 'idle_lock', {
          locked: true,
          locked_staff_id: staff.staffId,
          locked_at: lockedAt,
        })
        clearSession()
        void navigate({ href: `/${tenant.toLowerCase()}/pos/login` })
      },
    })

    const onActivity = () => ctrl.markActivity()
    window.addEventListener('pointerdown', onActivity)
    window.addEventListener('keydown', onActivity)
    window.addEventListener('solva:scan', onActivity)

    return () => {
      ctrl.stop()
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
      window.removeEventListener('solva:scan', onActivity)
    }
  }, [bootResult, navigate, tenant])

  // Start background Sync Engine strictly after first paint and only on active primary lock.
  useEffect(() => {
    if (bootResult.kind !== 'READY') return
    if (
      bootResult.state.kind !== 'OK' &&
      bootResult.state.kind !== 'LEASE_WARNING' &&
      bootResult.state.kind !== 'UPDATE_REQUIRED'
    ) {
      return
    }

    let cancelled = false
    let controller: SyncController | null = null

    const startAfterPaint = () => {
      if (cancelled) return
      if (import.meta.env.VITE_E2E) {
        void import('~/pos/dev/e2e-hooks').then(({ installE2eHooks }) => {
          if (!cancelled) {
            installE2eHooks({
              db: bootResult.db,
              getController: () => controller,
            })
          }
        })
      }
      void import('~/pos/printing/runtime').then((m) => {
        if (!cancelled) {
          void m.startPrintRuntime(bootResult.db, {
            isActiveInstance: () => !cancelled,
          })
        }
      })

      void import('~/pos/sync').then(({ startSyncEngine }) => {
        if (cancelled) return
        void startSyncEngine({
          db: bootResult.db,
          tenantId: bootResult.tenantId,
          deviceId: bootResult.device.device_id,
          isPrimaryLock: true,
          onTerminalLockDetected: (code) => {
            const variant =
              code === 'DEVICE_REVOKED'
                ? 'revoked'
                : code === 'CREDENTIAL_EXPIRED'
                  ? 'credential_expired'
                  : 'tenant_suspended'
            controller?.stop()
            bootResult.releaseLock()
            invalidateBootPosCache(tenant)
            void navigate({
              href: `/${tenant.toLowerCase()}/pos/system?variant=${variant}`,
            })
          },
        }).then((ctrl) => {
          if (cancelled) {
            ctrl.stop()
            return
          }
          controller = ctrl
        })
      })
    }

    const g = globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    let idleId: number | null = null
    let timerId: ReturnType<typeof setTimeout> | null = null

    if (typeof g.requestIdleCallback === 'function') {
      idleId = g.requestIdleCallback(startAfterPaint, { timeout: 500 })
    } else {
      timerId = setTimeout(startAfterPaint, 0)
    }

    return () => {
      cancelled = true
      if (idleId !== null && typeof g.cancelIdleCallback === 'function') {
        g.cancelIdleCallback(idleId)
      }
      if (timerId !== null) {
        clearTimeout(timerId)
      }
      controller?.stop()
    }
  }, [bootResult, navigate, tenant])

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

  useEffect(() => {
    if (bootResult.kind !== 'READY') return
    if (updateStatus === 'none' && !updateManager) return

    let cancelled = false
    void Promise.all([
      import('~/pos/sync/update-manager'),
      import('~/pos/data/meta.repo'),
      import('~/pos/data/shift.repo'),
      import('~/pos/state/cart-store'),
      import('~/lib/app-version'),
      import('~/lib/contracts'),
    ]).then(
      async ([
        { createPersistentUpdateController },
        { getMeta },
        { getOpenShiftForRegister },
        { posCartStore },
        { APP_VERSION },
        { SCHEMA_VERSION },
      ]) => {
        if (cancelled) return
        if (!persistentUpdateRef.current) {
          persistentUpdateRef.current = createPersistentUpdateController({
            db: bootResult.db,
            appVersion: APP_VERSION,
            schemaVersion: SCHEMA_VERSION,
            transport: {
              sendSkipWaiting: () => {
                updateManager?.applyUpdate()
              },
              reloadPage: () => window.location.reload(),
            },
          })
        }
        const [minSup, shift, idleLock] = await Promise.all([
          getMeta(bootResult.db, 'min_supported'),
          getOpenShiftForRegister(bootResult.db, bootResult.device.register_id),
          getMeta(bootResult.db, 'idle_lock'),
        ])
        if (cancelled) return
        const snap = await persistentUpdateRef.current.evaluate({
          release: minSup
            ? {
                latest: minSup.latest ?? minSup.app_version,
                min_supported_app_version: minSup.app_version,
                min_supported_schema_version: minSup.schema_version,
                is_mandatory: minSup.is_mandatory,
                accept_previous_until: minSup.accept_previous_until ?? null,
                max_schema_version: minSup.max_schema_version ?? minSup.schema_version,
              }
            : null,
          hasWaitingWorker: updateStatus === 'available' || updateStatus === 'pending_apply',
          context: {
            cartActive: posCartStore.getState().cart.lines.length > 0,
            paymentActive: getSessionState().paymentInProgress,
            shiftOpen: Boolean(shift),
            idleLocked: Boolean(idleLock?.locked),
          },
        })
        if (!cancelled) {
          setUpdatePrompt({
            visible: snap.promptVisible,
            mandatory: snap.mandatory,
            canSnooze: snap.canSnooze,
          })
        }
      },
    )

    return () => {
      cancelled = true
    }
  }, [bootResult, updateStatus, updateManager])

  return (
    <PosRootBoundary tenantSlug={tenant}>
      <div
        data-pos-shell="true"
        data-tenant={tenant}
        data-sw-update={updateStatus}
        data-has-manager={updateManager ? 'true' : 'false'}
      >
        <Outlet />
        {updatePrompt.visible ? (
          <Suspense fallback={null}>
            <LazyUpdateDialog
              open={updatePrompt.visible}
              mandatory={updatePrompt.mandatory}
              canSnooze={updatePrompt.canSnooze}
              onSnooze={() => {
                void persistentUpdateRef.current?.snooze().then((s) => {
                  setUpdatePrompt({
                    visible: s.promptVisible,
                    mandatory: s.mandatory,
                    canSnooze: s.canSnooze,
                  })
                })
              }}
              onReloadNow={() => {
                void persistentUpdateRef.current?.applyNow()
              }}
            />
          </Suspense>
        ) : null}
      </div>
    </PosRootBoundary>
  )
}
