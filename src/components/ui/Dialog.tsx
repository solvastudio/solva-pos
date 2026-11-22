import { Dialog as RadixDialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/cn'
import { IconButton } from './IconButton'
import { X } from './icons'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'dialog' | 'sheet'
  dismissible?: boolean
  overlayClassName?: string
  contentClassName?: string
  children: ReactNode
  footer?: ReactNode
}

const SIZE_CLASSES: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
  sm: 'max-w-dialog-sm',
  md: 'max-w-dialog-md',
  lg: 'max-w-dialog-lg',
  xl: 'max-w-dialog-xl',
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  variant = 'dialog',
  dismissible = true,
  overlayClassName,
  contentClassName,
  children,
  footer,
}: DialogProps) {
  const { t } = useTranslation()

  const contentLayout =
    variant === 'sheet'
      ? 'fixed inset-x-0 bottom-0 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 rounded-t-modal md:rounded-modal w-full'
      : 'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-modal w-[calc(100%-2rem)]'

  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!dismissible && !next) return
        onOpenChange(next)
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={cn('fixed inset-0 z-modal-backdrop bg-scrim', overlayClassName)} />
        <RadixDialog.Content
          onEscapeKeyDown={(e) => {
            if (!dismissible) e.preventDefault()
          }}
          onPointerDownOutside={(e) => {
            if (!dismissible) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (!dismissible) e.preventDefault()
          }}
          className={cn(
            contentLayout,
            SIZE_CLASSES[size],
            'z-modal flex max-h-[90dvh] flex-col overflow-hidden border border-line bg-surface p-6 text-ink shadow-modal focus:outline-none',
            contentClassName,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="text-h2 font-semibold text-ink">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-body text-ink-soft">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            {dismissible ? (
              <IconButton
                label={t('common.close')}
                icon={<X className="size-5" aria-hidden="true" />}
                size="md"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              />
            ) : null}
          </div>

          <div className="-mx-1 mt-4 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-1 pb-1">
            {children}
          </div>

          {footer ? (
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {footer}
            </div>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
