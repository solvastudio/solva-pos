import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'

export interface MoneyInputProps {
  id?: string
  value: number | null
  onChange: (value: number | null) => void
  placeholder?: string
  disabled?: boolean
  error?: boolean
  ariaLabel?: string
  ariaInvalid?: boolean
  ariaDescribedBy?: string
  className?: string
  dirty?: boolean
}

function formatRupiahDigits(n: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(n)
}

export function MoneyInput({
  id,
  value,
  onChange,
  placeholder,
  disabled = false,
  error = false,
  ariaLabel,
  ariaInvalid,
  ariaDescribedBy,
  className,
  dirty = false,
}: MoneyInputProps) {
  const { t } = useTranslation()
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState<string>(value === null ? '' : String(value))

  useEffect(() => {
    if (!focused) {
      setDraft(value === null ? '' : formatRupiahDigits(value))
    }
  }, [value, focused])

  return (
    <div className={cn('relative inline-flex w-full items-center', className)}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 text-caption font-medium text-ink-soft"
      >
        {t('common.currencyPrefix')}
      </span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={focused ? draft : value === null ? '' : formatRupiahDigits(value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || error || undefined}
        aria-describedby={ariaDescribedBy}
        onFocus={() => {
          setFocused(true)
          setDraft(value === null ? '' : String(value))
        }}
        onBlur={() => {
          setFocused(false)
          const clean = draft.replace(/[^\d]/g, '')
          if (clean.length === 0) {
            onChange(null)
            setDraft('')
            return
          }
          const num = Number(clean)
          if (Number.isSafeInteger(num) && num >= 0) {
            onChange(num)
            setDraft(formatRupiahDigits(num))
          }
        }}
        onChange={(e) => {
          const digitsOnly = e.target.value.replace(/[^\d]/g, '')
          setDraft(digitsOnly)
          if (digitsOnly.length === 0) {
            onChange(null)
            return
          }
          const num = Number(digitsOnly)
          if (Number.isSafeInteger(num) && num >= 0) {
            onChange(num)
          }
        }}
        className={cn(
          'min-h-control-md w-full rounded-sm border bg-surface pl-9 pr-3 text-right font-mono tabular-nums text-body text-ink placeholder:text-ink-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-disabled',
          error
            ? 'border-danger-line focus-visible:ring-danger-solid'
            : dirty
              ? 'border-warning-line bg-warning-soft'
              : 'border-line-input',
        )}
      />
    </div>
  )
}
