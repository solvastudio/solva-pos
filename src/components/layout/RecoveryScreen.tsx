import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ErrorCodeBlock, RefreshCw, TriangleAlert } from '~/components/ui'
import { newLocalRef } from '~/lib/client-errors/local-ref'
import { logClientError } from '~/lib/client-errors/report-schema'
import { SystemPage } from './SystemPage'

export const BOOTFAIL_WINDOW_MS = 60_000
export const BOOTFAIL_THRESHOLD = 2

export interface BootCrashStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export function bootFailStorageKey(tenantKey: string): string {
  return `solva:${tenantKey}:bootfail`
}

/**
 * Records a root boot crash in sessionStorage without touching IndexedDB/Dexie.
 * Triggers full recovery mode when 2+ crashes occur within 60 seconds.
 */
export function recordRootBootCrash(
  tenantKey: string,
  nowMs: number = Date.now(),
  storage: BootCrashStorage | null = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
): { count: number; shouldRecover: boolean } {
  if (!storage) {
    return { count: 1, shouldRecover: false }
  }

  const key = bootFailStorageKey(tenantKey)
  const cutoff = nowMs - BOOTFAIL_WINDOW_MS
  let recent: number[] = []

  try {
    const raw = storage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        recent = parsed.filter(
          (ts): ts is number => typeof ts === 'number' && Number.isFinite(ts) && ts >= cutoff && ts <= nowMs,
        )
      }
    }
    recent.push(nowMs)
    storage.setItem(key, JSON.stringify(recent))
  } catch {
    return { count: 1, shouldRecover: false }
  }

  return {
    count: recent.length,
    shouldRecover: recent.length >= BOOTFAIL_THRESHOLD,
  }
}

export function clearRootBootCrash(
  tenantKey: string,
  storage: Pick<BootCrashStorage, 'removeItem'> | null =
    typeof sessionStorage !== 'undefined' ? sessionStorage : null,
): void {
  if (!storage) {
    return
  }
  try {
    storage.removeItem(bootFailStorageKey(tenantKey))
  } catch {
    // Ignore storage restriction errors during recovery cleanup.
  }
}

export interface RecoveryScreenProps {
  code?: string
  refId?: string
  error?: unknown
  clockOffsetMs?: number
  onReload?: () => void
  onExportPending?: () => void
  safeModeHref?: string
}

export function RecoveryScreen({
  code = 'APP_ERROR',
  refId,
  error,
  clockOffsetMs,
  onReload,
  onExportPending,
  safeModeHref,
}: RecoveryScreenProps) {
  const { t } = useTranslation()
  const [resolvedRef] = useState(() => refId ?? newLocalRef(clockOffsetMs))

  useEffect(() => {
    if (!error) {
      return
    }
    const errObj = error instanceof Error ? error : new Error(String(error))
    logClientError({
      refLocal: resolvedRef,
      code,
      level: 'error',
      route: typeof window !== 'undefined' && window.location ? window.location.pathname : 'root',
      stack: errObj.stack ?? errObj.message,
      clockOffsetMs,
      ctx: { surface: 'recovery', errorName: errObj.name },
    })
  }, [clockOffsetMs, code, error, resolvedRef])

  function handleReload() {
    if (onReload) {
      onReload()
      return
    }
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload()
    }
  }

  return (
    <SystemPage>
      <div role="alert" aria-live="assertive" className="flex flex-col items-start gap-4">
        <div className="inline-flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger-ink">
          <TriangleAlert className="size-8" aria-hidden="true" />
        </div>

        <div>
          <h1 className="text-h2 font-semibold text-ink">{t('error.recovery.title')}</h1>
          <p className="mt-2 text-body text-ink-soft">{t('error.recovery.body')}</p>
        </div>

        <ErrorCodeBlock code={code} refId={resolvedRef} local className="w-full" />

        <div className="flex w-full flex-col gap-3">
          <Button type="button" variant="primary" size="xl" fullWidth onClick={handleReload}>
            <RefreshCw className="size-4" aria-hidden="true" />
            <span>{t('error.recovery.reload')}</span>
          </Button>

          {onExportPending ? (
            <Button
              type="button"
              variant="secondary"
              size="xl"
              fullWidth
              onClick={onExportPending}
            >
              {t('error.recovery.exportPending')}
            </Button>
          ) : null}

          {safeModeHref ? (
            <a
              href={safeModeHref}
              className="inline-flex h-12 w-full items-center justify-center rounded-input border border-line-strong bg-surface px-5 text-button font-semibold text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {t('error.recovery.safeMode')}
            </a>
          ) : null}
        </div>
      </div>
    </SystemPage>
  )
}
