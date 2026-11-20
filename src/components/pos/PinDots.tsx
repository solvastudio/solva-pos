import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'

export interface PinDotsProps {
  length: number
  maxLength?: number
  invalid?: boolean
  className?: string
}

export function PinDots({
  length,
  maxLength = 6,
  invalid = false,
  className,
}: PinDotsProps) {
  const { t } = useTranslation()
  const clampedMax = Math.max(4, Math.min(6, maxLength))

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div
        role="status"
        aria-live="polite"
        aria-label={t('pos.login.pinDotsAria', { count: length, max: clampedMax })}
        className="flex items-center justify-center gap-3"
      >
        {Array.from({ length: clampedMax }, (_, idx) => {
          const filled = idx < length
          return (
            <span
              key={idx}
              aria-hidden="true"
              className={cn(
                'size-3.5 rounded-full border-2 transition-colors',
                filled
                  ? invalid
                    ? 'border-danger-solid bg-danger-solid'
                    : 'border-accent bg-accent'
                  : invalid
                    ? 'border-danger-solid bg-transparent'
                    : 'border-line-strong bg-transparent',
              )}
            />
          )
        })}
        <span className="sr-only">{t('pos.login.pinEnteredCount', { count: length })}</span>
      </div>
    </div>
  )
}
