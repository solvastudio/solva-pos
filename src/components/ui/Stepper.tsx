import { cn } from '~/lib/cn'
import { Check } from './icons'

export interface StepperStep {
  readonly id: string
  readonly label: string
}

export interface StepperProps {
  steps: readonly StepperStep[]
  activeIndex: number
  ariaLabel: string
  className?: string
}

export function Stepper({ steps, activeIndex, ariaLabel, className }: StepperProps) {
  return (
    <nav aria-label={ariaLabel} className={cn('w-full', className)}>
      <ol className="flex flex-wrap items-center gap-3">
        {steps.map((step, idx) => {
          const completed = idx < activeIndex
          const current = idx === activeIndex
          return (
            <li
              key={step.id}
              aria-current={current ? 'step' : undefined}
              className="flex items-center gap-2"
            >
              <span
                className={cn(
                  'inline-flex size-7 items-center justify-center rounded-full border text-caption font-semibold',
                  completed
                    ? 'border-success-solid bg-success-solid text-on-action'
                    : current
                      ? 'border-action bg-action text-on-action'
                      : 'border-line bg-surface-sunken text-ink-soft',
                )}
              >
                {completed ? <Check className="size-4" /> : idx + 1}
              </span>
              <span
                className={cn(
                  'text-body',
                  current ? 'font-semibold text-ink' : completed ? 'text-ink' : 'text-ink-soft',
                )}
              >
                {step.label}
              </span>
              {idx < steps.length - 1 ? (
                <span aria-hidden="true" className="mx-1 h-px w-6 bg-line" />
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
