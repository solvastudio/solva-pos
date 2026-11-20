import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Dialog } from '~/components/ui/Dialog'

export interface ShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const SHORTCUT_KEYS = ['f2', 'f4', 'arrows', 'plusMinus', 'del', 'enter', 'esc', 'ctrlK'] as const

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('pos.shortcuts.title')}
      size="sm"
      footer={
        <Button type="button" variant="primary" onClick={() => onOpenChange(false)}>
          {t('common.close')}
        </Button>
      }
    >
      <ul className="flex flex-col gap-2 text-body text-ink">
        {SHORTCUT_KEYS.map((key) => (
          <li key={key} className="rounded-card border border-line bg-surface-sunken px-3 py-2">
            {t(`pos.shortcuts.${key}`)}
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
