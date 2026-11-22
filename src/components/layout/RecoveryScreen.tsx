import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { ErrorCodeBlock } from '~/components/ui/ErrorCodeBlock'
import { RefreshCw, TriangleAlert } from '~/components/ui/icons'
import { LOCAL_REF_PATTERN } from '~/lib/contracts/device-log'
import { isErrorCode, parsePublicCode } from '~/lib/contracts/error-codes'
import { newLocalRef } from '~/lib/client-errors/local-ref'
import { logClientError } from '~/lib/client-errors/report-schema'
import {
  bootFailStorageKey,
  clearBootCrashHistory,
  DEFAULT_BOOT_FAIL_WINDOW_MS,
  recordBootCrashTimestamp,
  type BootFailureStorage,
} from '~/pwa/boot-guard'
import { SystemPage } from './SystemPage'

export const BOOTFAIL_WINDOW_MS = DEFAULT_BOOT_FAIL_WINDOW_MS
export const BOOTFAIL_THRESHOLD = 2

export type BootCrashStorage = BootFailureStorage

export { bootFailStorageKey }

/**
 * Records a root boot crash in tenant-prefixed session storage without touching IndexedDB/Dexie.
 * Triggers full recovery mode when 2+ crashes occur within 60 seconds.
 */
export function recordRootBootCrash(
  tenantKey: string,
  nowMs: number = Date.now(),
  storage?: BootCrashStorage | null,
): { count: number; shouldRecover: boolean } {
  return recordBootCrashTimestamp(tenantKey, nowMs, storage, BOOTFAIL_WINDOW_MS)
}

export function clearRootBootCrash(
  tenantKey: string,
  storage?: Pick<BootCrashStorage, 'removeItem'> | null,
): void {
  clearBootCrashHistory(tenantKey, storage)
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

function extractPublicErrorFromError(error: unknown): { code: string; ref: string } | null {
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : null
  if (!msg) return null
  const parsed = parsePublicCode(msg.trim())
  if (!parsed || !isErrorCode(parsed.code)) return null
  return parsed
}

export function RecoveryScreen({
  code,
  refId,
  error,
  clockOffsetMs,
  onReload,
  onExportPending,
  safeModeHref,
}: RecoveryScreenProps) {
  const { t } = useTranslation()
  const [generatedRef] = useState(() => newLocalRef(clockOffsetMs))
  const parsedFromError = code === undefined && refId === undefined ? extractPublicErrorFromError(error) : null
  const resolvedCode = code ?? parsedFromError?.code ?? 'APP_ERROR'
  const resolvedRef = refId ?? parsedFromError?.ref ?? generatedRef
  const isValidLocalRef = LOCAL_REF_PATTERN.test(resolvedRef)

  useEffect(() => {
    if (!error) {
      return
    }
    const errObj = error instanceof Error ? error : new Error(String(error))
    logClientError({
      refLocal: isValidLocalRef ? resolvedRef : undefined,
      code: resolvedCode,
      level: 'error',
      route: typeof window !== 'undefined' && window.location ? window.location.pathname : 'root',
      stack: errObj.stack ?? errObj.message,
      clockOffsetMs,
      ctx: {
        surface: 'recovery',
        errorName: errObj.name,
        ...(isValidLocalRef ? {} : { serverRef: resolvedRef }),
      },
    })
  }, [clockOffsetMs, error, isValidLocalRef, resolvedCode, resolvedRef])

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

        <ErrorCodeBlock code={resolvedCode} refId={resolvedRef} className="w-full" />

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
