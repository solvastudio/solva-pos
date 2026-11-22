import { Select as RadixSelect } from 'radix-ui'
import { cn } from '~/lib/cn'
import { Check, ChevronDown } from './icons'

export interface SelectOption {
  readonly value: string
  readonly label: string
}

export interface SelectProps {
  options: readonly SelectOption[]
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  id?: string
  invalid?: boolean
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-control-sm text-body',
  md: 'h-control-md text-body',
  lg: 'h-control-lg text-body-lg',
}

const EMPTY_OPTION_VALUE = '__SELECT_EMPTY__'

export function Select({
  options,
  value,
  onValueChange,
  placeholder,
  ariaLabel,
  id,
  invalid = false,
  disabled = false,
  size = 'lg',
  className,
}: SelectProps) {
  const hasEmptyOption = options.some((opt) => opt.value === '')
  const normalizedValue =
    hasEmptyOption && value === '' ? EMPTY_OPTION_VALUE : value

  return (
    <RadixSelect.Root
      value={normalizedValue}
      onValueChange={
        onValueChange
          ? (next) => onValueChange(next === EMPTY_OPTION_VALUE ? '' : next)
          : undefined
      }
      disabled={disabled}
    >
      <RadixSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn(
          'inline-flex w-full items-center justify-between gap-2 rounded-control border bg-surface px-3 text-left text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 disabled:bg-surface-sunken disabled:text-ink-disabled disabled:border-line disabled:cursor-not-allowed [&>span]:min-w-0 [&>span]:truncate',
          SIZE_CLASSES[size],
          invalid ? 'border-2 border-danger-solid' : 'border-line-input',
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon asChild>
          <ChevronDown className="size-5 shrink-0 text-ink-soft" aria-hidden="true" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-dropdown max-h-80 min-w-44 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-popover"
        >
          <RadixSelect.Viewport>
            {options.map((opt) => {
              const itemVal = opt.value === '' ? EMPTY_OPTION_VALUE : opt.value
              return (
                <RadixSelect.Item
                  key={itemVal}
                  value={itemVal}
                  className="relative flex min-h-control-md cursor-pointer select-none items-center justify-between gap-2 rounded-md px-3 text-body text-ink outline-none hover:bg-surface-hover focus:bg-surface-hover data-[state=checked]:bg-action-soft data-[state=checked]:text-on-action-soft"
                >
                  <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator>
                    <Check className="size-4 text-ink-brand" aria-hidden="true" />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              )
            })}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}
