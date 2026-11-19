import { RadioGroup as RadixRadioGroup } from 'radix-ui'
import { useId } from 'react'
import { cn } from '~/lib/cn'

export interface RadioOption {
  readonly value: string
  readonly label: string
  readonly disabled?: boolean
}

export interface RadioProps {
  options: readonly RadioOption[]
  value: string
  onValueChange: (value: string) => void
  ariaLabel: string
  disabled?: boolean
  className?: string
}

export function Radio({
  options,
  value,
  onValueChange,
  ariaLabel,
  disabled = false,
  className,
}: RadioProps) {
  const baseId = useId()

  return (
    <RadixRadioGroup.Root
      value={value}
      onValueChange={onValueChange}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn('flex flex-col gap-1', className)}
    >
      {options.map((opt) => {
        const itemId = `${baseId}-${opt.value}`
        const isDisabled = Boolean(disabled || opt.disabled)
        return (
          <div key={opt.value} className="inline-flex min-h-control-md items-center gap-3">
            <RadixRadioGroup.Item
              id={itemId}
              value={opt.value}
              disabled={isDisabled}
              className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-line-input bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 data-[state=checked]:border-action disabled:border-line disabled:bg-surface-sunken disabled:cursor-not-allowed"
            >
              <RadixRadioGroup.Indicator className="flex items-center justify-center">
                <span className="size-3 rounded-full bg-action" aria-hidden="true" />
              </RadixRadioGroup.Indicator>
            </RadixRadioGroup.Item>
            <label
              htmlFor={itemId}
              className={cn(
                'cursor-pointer select-none py-2 text-body',
                isDisabled ? 'text-ink-disabled cursor-not-allowed' : 'text-ink',
              )}
            >
              {opt.label}
            </label>
          </div>
        )
      })}
    </RadixRadioGroup.Root>
  )
}
