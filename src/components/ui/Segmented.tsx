import { cn } from '~/lib/cn'

export interface SegmentedOption {
  readonly value: string
  readonly label: string
}

export interface SegmentedProps {
  options: readonly SegmentedOption[]
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  size?: 'sm' | 'md'
  className?: string
}

export function Segmented({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  className,
}: SegmentedProps) {
  const heightCls = size === 'sm' ? 'h-control-sm text-body' : 'h-control-md text-label'

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex rounded-control bg-surface-sunken p-1 gap-1', className)}
    >
      {options.map((opt, idx) => {
        const checked = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault()
                const next = options[(idx + 1) % options.length]
                if (next) onChange(next.value)
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault()
                const prev = options[(idx - 1 + options.length) % options.length]
                if (prev) onChange(prev.value)
              }
            }}
            className={cn(
              'flex-1 rounded-md px-3 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1',
              heightCls,
              checked ? 'bg-surface font-semibold text-ink shadow-pill' : 'text-ink-soft hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
