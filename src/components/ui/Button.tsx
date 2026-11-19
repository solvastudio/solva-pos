import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'
import { Loader2 } from './icons'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors whitespace-nowrap select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 disabled:bg-surface-sunken disabled:text-ink-disabled disabled:border-line disabled:shadow-none disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary: 'bg-action text-on-action hover:bg-action-hover active:bg-action-active',
        secondary:
          'bg-surface text-ink border border-line-strong hover:bg-surface-hover active:bg-surface-sunken',
        tonal: 'bg-action-soft text-on-action-soft hover:bg-action-soft-hover',
        ghost: 'bg-transparent text-ink-soft hover:bg-surface-hover active:bg-surface-sunken',
        danger: 'bg-danger-solid text-on-action hover:bg-danger-ink active:bg-danger-ink',
        'danger-outline':
          'bg-surface text-danger-ink border border-danger-solid hover:bg-danger-soft',
        link: 'bg-transparent text-ink-brand underline-offset-4 hover:underline disabled:bg-transparent',
      },
      size: {
        sm: 'h-control-sm px-3 text-button',
        md: 'h-control-md px-4 text-button',
        lg: 'h-control-lg px-5 text-button-lg',
        xl: 'h-control-xl px-6 text-button-lg',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'lg',
      fullWidth: false,
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
  loadingLabel?: string
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}

export function Button({
  className,
  variant,
  size,
  fullWidth,
  loading = false,
  loadingLabel,
  leadingIcon,
  trailingIcon,
  disabled,
  type = 'button',
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const { t } = useTranslation()
  const isDisabled = Boolean(disabled || loading)

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onClick={(e) => {
        if (isDisabled) {
          e.preventDefault()
          return
        }
        onClick?.(e)
      }}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...rest}
    >
      {loading ? (
        <>
          <Loader2 className="size-5 motion-safe:animate-spin shrink-0" aria-hidden="true" />
          <span>{loadingLabel ?? t('common.loading')}</span>
        </>
      ) : (
        <>
          {leadingIcon ? (
            <span className="inline-flex shrink-0" aria-hidden="true">
              {leadingIcon}
            </span>
          ) : null}
          {children}
          {trailingIcon ? (
            <span className="inline-flex shrink-0" aria-hidden="true">
              {trailingIcon}
            </span>
          ) : null}
        </>
      )}
    </button>
  )
}
