import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'

export interface SkeletonProps {
  className?: string
  label?: string
}

export function Skeleton({ className, label }: SkeletonProps) {
  const { t } = useTranslation()

  return (
    <div aria-busy="true" className="contents">
      <div
        aria-hidden="true"
        className={cn('rounded-md bg-surface-sunken motion-safe:animate-pulse', className)}
      />
      <span className="sr-only">{label ?? t('common.loading')}</span>
    </div>
  )
}
