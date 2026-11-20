import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'

export interface StickyFooterProps {
  message: ReactNode
  actions: ReactNode
  className?: string
}

export function StickyFooter({ message, actions, className }: StickyFooterProps) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3 shadow-card',
        className,
      )}
    >
      <div aria-live="polite" className="text-body font-medium text-ink">
        {message}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  )
}
