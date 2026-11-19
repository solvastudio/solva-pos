import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'

export interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
  secondaryAction?: ReactNode
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-card p-8 text-center',
        className,
      )}
    >
      <div
        className="flex size-24 items-center justify-center rounded-full bg-surface-sunken text-ink-muted"
        aria-hidden="true"
      >
        <span className="size-12 inline-flex items-center justify-center">{icon}</span>
      </div>
      <h3 className="mt-4 text-h3 font-semibold text-ink">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-body text-ink-soft">{description}</p> : null}
      {action || secondaryAction ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  )
}
