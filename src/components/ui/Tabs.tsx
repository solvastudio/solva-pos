import { Tabs as RadixTabs } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'

export interface TabItem {
  readonly value: string
  readonly label: string
  readonly badge?: number | string
  readonly content?: ReactNode
}

export interface TabsProps {
  items: readonly TabItem[]
  value: string
  onValueChange: (value: string) => void
  size?: 'sm' | 'md' | 'lg'
  ariaLabel?: string
  className?: string
}

const TRIGGER_SIZE: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-control-sm px-3 text-body',
  md: 'h-control-md px-4 text-label',
  lg: 'h-control-lg px-4 text-label',
}

export function Tabs({
  items,
  value,
  onValueChange,
  size = 'lg',
  ariaLabel,
  className,
}: TabsProps) {
  const hasPanels = items.some((item) => item.content !== undefined)

  if (!hasPanels) {
    // Filter-only tab pill bar (DESIGN CMP-06: role="radiogroup" without dangling aria-controls)
    return (
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className={cn('flex items-center gap-2 overflow-x-auto pb-1', className)}
      >
        {items.map((item) => {
          const active = item.value === value
          return (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onValueChange(item.value)}
              className={cn(
                'inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
                TRIGGER_SIZE[size],
                active
                  ? 'bg-action text-on-action'
                  : 'bg-surface-sunken text-ink hover:bg-line',
              )}
            >
              <span>{item.label}</span>
              {item.badge !== undefined ? (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-surface px-1.5 text-label-sm tabular-nums text-ink">
                  {item.badge}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange} className={className}>
      <RadixTabs.List
        aria-label={ariaLabel}
        className="flex items-center gap-2 overflow-x-auto pb-1"
      >
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className={cn(
              'inline-flex shrink-0 items-center justify-center gap-2 rounded-control bg-surface-sunken font-medium text-ink transition-colors hover:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 data-[state=active]:bg-action data-[state=active]:text-on-action',
              TRIGGER_SIZE[size],
            )}
          >
            <span>{item.label}</span>
            {item.badge !== undefined ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-surface px-1.5 text-label-sm tabular-nums text-ink">
                {item.badge}
              </span>
            ) : null}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} value={item.value} className="mt-3">
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  )
}
