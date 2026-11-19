import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'
import { CircleAlert } from './icons'

export interface FieldProps {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  className?: string
  children: ReactNode
}

export function Field({ label, htmlFor, hint, error, className, children }: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined
  const errorId = error ? `${htmlFor}-error` : undefined

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-label font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={errorId} className="flex items-center gap-1.5 text-body-sm text-danger-ink">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="text-caption text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
