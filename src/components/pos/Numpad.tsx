import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'
import { Check, Undo2 } from '~/components/ui/icons'

export interface NumpadProps {
  onDigit: (digit: string) => void
  onBackspace: () => void
  onSubmit: () => void
  disabled?: boolean
  submitDisabled?: boolean
  keyboardEnabled?: boolean
  className?: string
}

const KEY_ROWS: readonly (readonly (string | 'BACKSPACE' | 'SUBMIT')[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['BACKSPACE', '0', 'SUBMIT'],
]

export function Numpad({
  onDigit,
  onBackspace,
  onSubmit,
  disabled = false,
  submitDisabled = false,
  keyboardEnabled = true,
  className,
}: NumpadProps) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!keyboardEnabled || disabled) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        onDigit(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        onBackspace()
      } else if (e.key === 'Enter' && !submitDisabled) {
        e.preventDefault()
        onSubmit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [disabled, keyboardEnabled, onBackspace, onDigit, onSubmit, submitDisabled])

  return (
    <div
      role="group"
      aria-label={t('pos.numpad.groupLabel')}
      className={cn('grid grid-cols-3 gap-2.5', className)}
    >
      {KEY_ROWS.flat().map((key) => {
        if (key === 'BACKSPACE') {
          return (
            <button
              key="backspace"
              type="button"
              disabled={disabled}
              aria-label={t('pos.numpad.backspace')}
              onClick={onBackspace}
              className="flex min-h-14 min-w-14 size-key w-full items-center justify-center rounded-control border border-line-strong bg-surface text-ink transition-colors hover:bg-surface-hover active:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-disabled"
            >
              <Undo2 className="size-5" aria-hidden="true" />
            </button>
          )
        }

        if (key === 'SUBMIT') {
          return (
            <button
              key="submit"
              type="button"
              disabled={disabled || submitDisabled}
              aria-label={t('pos.numpad.submit')}
              onClick={onSubmit}
              className="flex min-h-14 min-w-14 size-key w-full items-center justify-center rounded-control bg-accent text-accent-ink font-semibold transition-colors hover:bg-accent-hover active:bg-accent-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-disabled"
            >
              <Check className="size-5" aria-hidden="true" />
            </button>
          )
        }

        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            aria-label={t('pos.numpad.digitAria', { digit: key })}
            onClick={() => onDigit(key)}
            className="flex min-h-14 min-w-14 size-key w-full items-center justify-center rounded-control border border-line-strong bg-surface text-h2 font-semibold tabular-nums text-ink transition-colors hover:bg-surface-hover active:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-disabled"
          >
            {t('pos.numpad.digit', { digit: key })}
          </button>
        )
      })}
    </div>
  )
}
