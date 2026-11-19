import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '~/lib/cn'

const iconButtonVariants = cva(
  'relative inline-flex items-center justify-center transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 disabled:bg-surface-sunken disabled:text-ink-disabled disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        ghost: 'bg-transparent text-ink-soft hover:bg-surface-hover active:bg-surface-sunken',
        tonal: 'bg-action-soft text-on-action-soft hover:bg-action-soft-hover',
        filled: 'bg-action text-on-action hover:bg-action-hover active:bg-action-active',
        'danger-ghost': 'bg-transparent text-danger-ink hover:bg-danger-soft',
      },
      size: {
        md: 'h-control-md w-control-md',
        lg: 'h-control-lg w-control-lg',
      },
      shape: {
        square: 'rounded-control',
        circle: 'rounded-full',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md',
      shape: 'square',
    },
  },
)

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>,
    VariantProps<typeof iconButtonVariants> {
  label: string
  icon: ReactNode
  pressed?: boolean
  badge?: number
}

export function IconButton({
  className,
  variant,
  size,
  shape,
  label,
  icon,
  pressed,
  badge,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const badgeText = badge !== undefined && badge > 99 ? '99+' : badge

  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        iconButtonVariants({ variant, size, shape }),
        pressed ? 'bg-action-soft text-on-action-soft' : '',
        className,
      )}
      {...rest}
    >
      <span className="inline-flex size-5 items-center justify-center" aria-hidden="true">
        {icon}
      </span>
      {badge !== undefined && badge > 0 ? (
        <span className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-solid px-1 text-label-sm tabular-nums text-on-action">
          {badgeText}
        </span>
      ) : null}
    </button>
  )
}
