import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Dialog } from '~/components/ui/Dialog'

export interface ShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ShortcutRow {
  readonly id: 'f2' | 'f4' | 'arrows' | 'plusMinus' | 'del' | 'enter' | 'esc' | 'ctrlK'
  readonly keys: readonly string[]
}

const SHORTCUTS: readonly ShortcutRow[] = [
  { id: 'f2', keys: ['F2', '/'] },
  { id: 'f4', keys: ['F4'] },
  { id: 'arrows', keys: ['↑', '↓'] },
  { id: 'plusMinus', keys: ['+', '-'] },
  { id: 'del', keys: ['Delete'] },
  { id: 'enter', keys: ['Enter'] },
  { id: 'esc', keys: ['Esc'] },
  { id: 'ctrlK', keys: ['Ctrl', 'K'] },
]

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('pos.shortcuts.title')}
      size="sm"
      footer={
        <Button type="button" variant="primary" size="md" onClick={() => onOpenChange(false)}>
          {t('common.close')}
        </Button>
      }
    >
      <ul className="divide-y divide-line-subtle text-body text-ink">
        {SHORTCUTS.map(({ id, keys }) => (
          <li key={id} className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
            <span className="text-ink-soft">{t(`pos.shortcuts.${id}`)}</span>
            <span className="flex shrink-0 items-center gap-1">
              {keys.map((keyLabel) => (
                <kbd
                  key={keyLabel}
                  className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-line bg-surface-sunken px-1.5 font-mono text-label-sm font-medium text-ink"
                >
                  {keyLabel}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
