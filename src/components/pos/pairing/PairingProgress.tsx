import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'

export interface PairingProgressProps {
  step: number
  total: number
  className?: string
}

export function PairingProgress({ step, total, className }: PairingProgressProps) {
  const { t } = useTranslation()
  const safeTotal = Math.max(1, total)
  const safeStep = Math.max(0, Math.min(safeTotal, step))

  return (
    <div
      role="progressbar"
      aria-label={t('pos.pair.progress.label')}
      aria-valuemin={0}
      aria-valuemax={safeTotal}
      aria-valuenow={safeStep}
      aria-live="polite"
      className={cn('flex flex-col gap-2', className)}
    >
      <div className="flex gap-1.5">
        {Array.from({ length: safeTotal }, (_, i) => {
          const filled = i < safeStep
          return (
            <span
              key={i}
              aria-hidden="true"
              className={cn(
                'h-2 flex-1 rounded-full transition-colors',
                filled ? 'bg-action' : 'bg-surface-sunken',
              )}
            />
          )
        })}
      </div>
      <p className="text-caption font-medium text-ink-soft">
        {t('pos.pair.progress.downloading', { step: safeStep, total: safeTotal })}
      </p>
    </div>
  )
}
