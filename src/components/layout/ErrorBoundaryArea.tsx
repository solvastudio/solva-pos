import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { ErrorCodeBlock } from '~/components/ui/ErrorCodeBlock'
import { RefreshCw, TriangleAlert } from '~/components/ui/icons'
import { logClientError } from '~/lib/client-errors/report-schema'
import { newLocalRef } from '~/lib/client-errors/local-ref'

export interface ErrorBoundaryErrorDetails {
  route: string
  componentStack?: string
}

export interface ErrorBoundaryAreaProps {
  area: string
  homeHref?: string
  clockOffsetMs?: number
  onError?: (refLocal: string, error: Error, details?: ErrorBoundaryErrorDetails) => void
  onReset?: () => void
  children: ReactNode
}

interface ErrorBoundaryAreaState {
  hasError: boolean
  refLocal: string | null
  consecutiveCrashes: number
  attempt: number
}

const RELOAD_THRESHOLD = 2

interface ErrorBoundaryFallbackProps {
  refLocal: string
  homeHref?: string
  showReload: boolean
  onRetry: () => void
  onReload: () => void
}

function ErrorBoundaryFallback({
  refLocal,
  homeHref,
  showReload,
  onRetry,
  onReload,
}: ErrorBoundaryFallbackProps) {
  const { t } = useTranslation()

  return (
    <section
      role="alert"
      aria-live="assertive"
      className="mx-auto my-6 w-full max-w-dialog-md rounded-card border border-line bg-surface p-6 shadow-card"
    >
      <div className="flex flex-col items-start gap-4">
        <div className="inline-flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger-ink">
          <TriangleAlert className="size-8" aria-hidden="true" />
        </div>

        <div>
          <h2 className="text-h2 font-semibold text-ink">{t('error.boundary.title')}</h2>
          <p className="mt-1.5 text-body text-ink-soft">{t('error.APP_ERROR.action')}</p>
        </div>

        <ErrorCodeBlock code="APP_ERROR" refId={refLocal} local className="w-full" />

        <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button type="button" variant="primary" size="xl" onClick={onRetry}>
            {t('error.boundary.retry')}
          </Button>

          {showReload ? (
            <Button type="button" variant="danger-outline" size="xl" onClick={onReload}>
              <RefreshCw className="size-4" aria-hidden="true" />
              <span>{t('error.boundary.reload')}</span>
            </Button>
          ) : null}

          {homeHref ? (
            <a
              href={homeHref}
              className="inline-flex h-12 items-center justify-center rounded-input border border-line-strong bg-surface px-5 text-button font-semibold text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {t('error.boundary.home')}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export class ErrorBoundaryArea extends Component<ErrorBoundaryAreaProps, ErrorBoundaryAreaState> {
  state: ErrorBoundaryAreaState = {
    hasError: false,
    refLocal: null,
    consecutiveCrashes: 0,
    attempt: 0,
  }

  static getDerivedStateFromError(): Partial<ErrorBoundaryAreaState> {
    return {
      hasError: true,
      refLocal: newLocalRef(),
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const correctedNow = Date.now() + (this.props.clockOffsetMs ?? 0)
    const refLocal = this.state.refLocal ?? newLocalRef(correctedNow)
    const route =
      typeof window !== 'undefined' && window.location ? window.location.pathname : this.props.area

    logClientError({
      refLocal,
      code: 'APP_ERROR',
      route,
      stack: error.stack ?? error.message,
      componentStack: info.componentStack ?? undefined,
      clockOffsetMs: this.props.clockOffsetMs,
      ctx: {
        area: this.props.area,
        errorName: error.name,
      },
    })

    this.setState((prev) => ({
      refLocal,
      consecutiveCrashes: prev.consecutiveCrashes + 1,
    }))
    this.props.onError?.(refLocal, error, {
      route,
      componentStack: info.componentStack ?? undefined,
    })
  }

  private handleRetry = () => {
    this.props.onReset?.()
    this.setState((prev) => ({
      hasError: false,
      refLocal: null,
      attempt: prev.attempt + 1,
    }))
  }

  private handleReload = () => {
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload()
    }
  }

  render() {
    if (this.state.hasError && this.state.refLocal) {
      return (
        <ErrorBoundaryFallback
          refLocal={this.state.refLocal}
          homeHref={this.props.homeHref}
          showReload={this.state.consecutiveCrashes >= RELOAD_THRESHOLD}
          onRetry={this.handleRetry}
          onReload={this.handleReload}
        />
      )
    }

    return <div key={this.state.attempt}>{this.props.children}</div>
  }
}
