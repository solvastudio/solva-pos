import { cva, type VariantProps } from 'class-variance-authority'
import { useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'
import { IconButton } from './IconButton'
import { Eye, EyeOff } from './icons'

const inputWrapperVariants = cva(
  'flex items-center gap-2 rounded-control border bg-surface px-3 transition-colors focus-within:ring-2 focus-within:ring-focus-ring focus-within:ring-offset-0',
  {
    variants: {
      controlSize: {
        sm: 'h-control-sm text-body',
        md: 'h-control-md text-body-lg',
        lg: 'h-control-lg text-body-lg',
      },
      invalid: {
        true: 'border-2 border-danger-solid',
        false: 'border-line-input',
      },
      disabled: {
        true: 'bg-surface-sunken border-line text-ink-disabled cursor-not-allowed',
        false: '',
      },
      readOnly: {
        true: 'bg-surface-subtle text-ink-soft',
        false: '',
      },
    },
    defaultVariants: {
      controlSize: 'lg',
      invalid: false,
      disabled: false,
      readOnly: false,
    },
  },
)

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'>,
    Omit<VariantProps<typeof inputWrapperVariants>, 'disabled' | 'readOnly'> {
  kind?: 'text' | 'number' | 'money' | 'pin'
  invalid?: boolean
  prefix?: ReactNode
  suffix?: ReactNode
}

export function Input({
  className,
  kind = 'text',
  controlSize,
  invalid = false,
  prefix,
  suffix,
  disabled = false,
  readOnly = false,
  type,
  inputMode,
  autoComplete,
  ...rest
}: InputProps) {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState(false)
  const canReveal = type === 'password' && kind !== 'pin' && !suffix && !readOnly
  const resolvedType =
    kind === 'pin' ? 'password' : canReveal && revealed ? 'text' : (type ?? 'text')
  const resolvedInputMode =
    inputMode ??
    (kind === 'money' || kind === 'pin'
      ? 'numeric'
      : kind === 'number'
        ? 'decimal'
        : undefined)
  const resolvedAutoComplete = kind === 'pin' ? (autoComplete ?? 'one-time-code') : autoComplete

  return (
    <div
      className={cn(
        inputWrapperVariants({
          controlSize,
          invalid,
          disabled: Boolean(disabled),
          readOnly: Boolean(readOnly),
        }),
        className,
      )}
    >
      {prefix ? (
        <span className="shrink-0 text-ink-soft select-none" aria-hidden="true">
          {prefix}
        </span>
      ) : null}
      <input
        type={resolvedType}
        inputMode={resolvedInputMode}
        autoComplete={resolvedAutoComplete}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={invalid || undefined}
        className={cn(
          'min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-muted focus:outline-none disabled:text-ink-disabled disabled:cursor-not-allowed read-only:text-ink-soft',
          kind === 'money' ? 'tabular-nums text-right text-num-lg font-semibold' : '',
          kind === 'number' ? 'tabular-nums' : '',
        )}
        {...rest}
      />
      {suffix ? (
        <span className="shrink-0 text-ink-soft">{suffix}</span>
      ) : canReveal ? (
        <IconButton
          label={revealed ? t('auth.login.hidePassword') : t('auth.login.showPassword')}
          icon={revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          variant="ghost"
          size="md"
          className="-mr-1.5"
          disabled={disabled}
          onClick={() => setRevealed((prev) => !prev)}
        />
      ) : null}
    </div>
  )
}
