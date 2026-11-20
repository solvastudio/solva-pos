import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'
import { formatPublicCode } from '~/lib/contracts/error-codes'
import { Button } from './Button'
import { Check, Copy } from './icons'

export interface ErrorCodeBlockProps {
  code: string
  refId: string
  local?: boolean
  className?: string
}

type CopyState = 'idle' | 'copied' | 'fallback'

const COPY_FEEDBACK_MS = 2000

export function ErrorCodeBlock({ code, refId, local, className }: ErrorCodeBlockProps) {
  const { t } = useTranslation()
  const labelId = useId()
  const codeRef = useRef<HTMLElement>(null)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [copyState, setCopyState] = useState<CopyState>('idle')

  const normalizedCode = code.trim().toUpperCase()
  const normalizedRef = refId.trim().toLowerCase()
  const formatted = formatPublicCode(normalizedCode, normalizedRef)
  const isLocalRef = local ?? normalizedRef.startsWith('d-')

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  function scheduleIdleReset() {
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current)
    }
    resetTimerRef.current = setTimeout(() => {
      setCopyState('idle')
      resetTimerRef.current = null
    }, COPY_FEEDBACK_MS)
  }

  function selectCodeText() {
    const el = codeRef.current
    if (!el || typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }
    const selection = window.getSelection?.()
    if (!selection || typeof document.createRange !== 'function') {
      return
    }
    const range = document.createRange()
    range.selectNodeContents(el)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  async function handleCopy() {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
    if (clipboard && typeof clipboard.writeText === 'function') {
      try {
        await clipboard.writeText(formatted)
        setCopyState('copied')
        scheduleIdleReset()
        return
      } catch {
        // Fall through to text-selection fallback when clipboard permission is denied.
      }
    }

    selectCodeText()
    setCopyState('fallback')
    scheduleIdleReset()
  }

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn(
        'flex flex-col gap-3 rounded-card border border-line bg-surface-sunken p-4 text-left',
        className,
      )}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <p id={labelId} className="text-caption font-medium text-ink-soft">
            {t('error.codeBlock.label')}
          </p>
          <div className="mt-1 overflow-x-auto">
            <code
              ref={codeRef}
              data-testid="error-code-value"
              className="inline-block select-all whitespace-nowrap break-keep font-mono text-code-id font-semibold text-ink"
            >
              {formatted}
            </code>
          </div>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="xl"
          fullWidth
          onClick={() => void handleCopy()}
          className="shrink-0 md:w-auto md:min-w-50"
        >
          {copyState === 'copied' ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          <span>{copyState === 'copied' ? t('error.copy.done') : t('error.codeBlock.copy')}</span>
        </Button>
      </div>

      {isLocalRef ? (
        <p className="text-caption text-ink-soft">{t('error.codeBlock.local')}</p>
      ) : null}

      <div role="status" aria-live="polite" className="min-h-4 text-caption text-ink-soft">
        {copyState === 'copied' ? t('error.copy.done') : null}
        {copyState === 'fallback' ? t('error.copy.fallback') : null}
      </div>
    </div>
  )
}
