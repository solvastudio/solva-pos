import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RecoveryScreen } from '~/components/layout/RecoveryScreen'
import { newLocalRef } from '~/lib/client-errors/local-ref'
import { logClientError } from '~/lib/client-errors/report-schema'
import { findTenantIdBySlug } from '~/pos/db/registry'
import { openTenantDb } from '~/pos/db/solva-db'
import { logDevice } from '~/pos/maintenance/device-log'
import { recordBootCrashTimestamp } from '~/pwa/boot-guard'

export interface PosRootBoundaryProps {
  tenantSlug: string
  onExportPending?: () => void
  safeModeHref?: string
  children: ReactNode
}

interface PosRootBoundaryState {
  hasError: boolean
  error: Error | null
  refLocal: string | null
}

/**
 * Root error boundary for the `/<slug>/pos` shell rendering SCR-P17 (`RecoveryScreen`),
 * recording `APP_ERROR` into `device_log` when Dexie is open, and escalating to static
 * `/recovery.html` after 2 root crashes within 60 seconds.
 */
export class PosRootBoundary extends Component<PosRootBoundaryProps, PosRootBoundaryState> {
  state: PosRootBoundaryState = {
    hasError: false,
    error: null,
    refLocal: null,
  }

  static getDerivedStateFromError(error: Error): PosRootBoundaryState {
    return {
      hasError: true,
      error,
      refLocal: newLocalRef(),
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const refLocal = this.state.refLocal ?? newLocalRef()
    const route =
      typeof window !== 'undefined' && window.location
        ? window.location.pathname
        : `/${this.props.tenantSlug}/pos`

    logClientError({
      refLocal,
      code: 'APP_ERROR',
      level: 'error',
      route,
      stack: error.stack ?? error.message,
      componentStack: info.componentStack ?? undefined,
      ctx: { surface: 'pos-root', errorName: error.name },
    })

    void findTenantIdBySlug(this.props.tenantSlug)
      .then(async (tenantId) => {
        if (!tenantId) return
        const db = await openTenantDb(tenantId)
        await logDevice(db, {
          level: 'error',
          code: 'APP_ERROR',
          route,
          stack: error.stack ?? error.message,
          componentStack: info.componentStack ?? undefined,
          ctx: { surface: 'pos-root', errorName: error.name },
        })
      })
      .catch(() => {
        // Never allow recovery logging failures to mask SCR-P17.
      })

    const crash = recordBootCrashTimestamp(this.props.tenantSlug, Date.now())
    if (crash.shouldRecover && typeof window !== 'undefined' && window.location) {
      window.location.replace(
        `/${this.props.tenantSlug}/pos/recovery?code=APP_ERROR&ref=${encodeURIComponent(refLocal)}`,
      )
    }
  }

  private handleReload = () => {
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload()
    }
  }

  render() {
    if (this.state.hasError && this.state.refLocal) {
      return (
        <RecoveryScreen
          code="APP_ERROR"
          refId={this.state.refLocal}
          onReload={this.handleReload}
          onExportPending={this.props.onExportPending}
          safeModeHref={this.props.safeModeHref}
        />
      )
    }

    return this.props.children
  }
}
