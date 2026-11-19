import { Switch as RadixSwitch } from 'radix-ui'
import { useId } from 'react'
import { cn } from '~/lib/cn'

export interface SwitchProps {
  id?: string
  label: string
  stateText?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

export function Switch({
  id,
  label,
  stateText,
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: SwitchProps) {
  const autoId = useId()
  const controlId = id ?? autoId

  return (
    <div className={cn('inline-flex min-h-control-md items-center gap-3', className)}>
      <RadixSwitch.Root
        id={controlId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border border-line-input bg-surface-sunken transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 data-[state=checked]:border-action data-[state=checked]:bg-action disabled:border-line disabled:bg-surface-sunken disabled:cursor-not-allowed"
      >
        <RadixSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-surface shadow-pill transition-transform data-[state=checked]:translate-x-6" />
      </RadixSwitch.Root>
      <label
        htmlFor={controlId}
        className={cn(
          'cursor-pointer select-none py-2 text-body',
          disabled ? 'text-ink-disabled cursor-not-allowed' : 'text-ink',
        )}
      >
        <span>{label}</span>
        {stateText ? <span className="ml-2 text-caption text-ink-soft">{stateText}</span> : null}
      </label>
    </div>
  )
}
