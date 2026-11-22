import { Checkbox as RadixCheckbox } from 'radix-ui'
import { useId } from 'react'
import { cn } from '~/lib/cn'
import { Check } from './icons'

export interface CheckboxProps {
  id?: string
  label: string
  hideLabel?: boolean
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

export function Checkbox({
  id,
  label,
  hideLabel = false,
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: CheckboxProps) {
  const autoId = useId()
  const controlId = id ?? autoId

  return (
    <div
      className={cn(
        'inline-flex min-h-control-md items-center',
        hideLabel ? 'gap-0' : 'gap-3',
        className,
      )}
    >
      <RadixCheckbox.Root
        id={controlId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="flex size-6 shrink-0 items-center justify-center rounded-xs border-2 border-line-input bg-surface text-on-action transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 data-[state=checked]:border-action data-[state=checked]:bg-action disabled:border-line disabled:bg-surface-sunken disabled:text-ink-disabled disabled:cursor-not-allowed"
      >
        <RadixCheckbox.Indicator>
          <Check className="size-4" aria-hidden="true" />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <label
        htmlFor={controlId}
        className={
          hideLabel
            ? 'sr-only'
            : cn(
                'cursor-pointer select-none py-2 text-body',
                disabled ? 'text-ink-disabled cursor-not-allowed' : 'text-ink',
              )
        }
      >
        {label}
      </label>
    </div>
  )
}
