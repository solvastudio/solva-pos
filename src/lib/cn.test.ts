import { describe, expect, it } from 'vitest'
import { buttonVariants } from '~/components/ui/Button'
import { cn } from './cn'

describe('lib/cn', () => {
  it('preserves both text color tokens and custom font-size tokens in Button and typography classes', () => {
    const primaryBtn = cn(buttonVariants({ variant: 'primary', size: 'md' }))
    expect(primaryBtn).toContain('text-on-action')
    expect(primaryBtn).toContain('text-button')
    expect(primaryBtn).toContain('bg-action')

    const largeBtn = cn(buttonVariants({ variant: 'primary', size: 'lg' }))
    expect(largeBtn).toContain('text-on-action')
    expect(largeBtn).toContain('text-button-lg')

    expect(cn('text-ink-soft text-body-sm')).toBe('text-ink-soft text-body-sm')
    expect(cn('text-button text-h1 text-on-action text-ink')).toBe('text-h1 text-ink')
    expect(cn('rounded-control rounded-card shadow-card shadow-popover')).toBe(
      'rounded-card shadow-popover',
    )
  })
})
