import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '~/lib/cn'

const cardVariants = cva('rounded-card border transition-colors', {
  variants: {
    variant: {
      default: 'bg-surface border-line shadow-card text-ink',
      selected: 'bg-action-soft border-2 border-action shadow-card text-ink',
      hero: 'bg-action border-action text-on-action shadow-card',
    },
    padding: {
      pos: 'p-4',
      admin: 'p-5',
    },
  },
  defaultVariants: {
    variant: 'default',
    padding: 'pos',
  },
})

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export function Card({ className, variant, padding, ...rest }: CardProps) {
  return <div className={cn(cardVariants({ variant, padding }), className)} {...rest} />
}
