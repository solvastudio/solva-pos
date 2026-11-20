import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { Download } from '~/components/ui/icons'

export interface UpdateDialogProps {
  open: boolean
  mandatory: boolean
  canSnooze: boolean
  onReloadNow: () => void
  onSnooze?: () => void
}

/**
 * Non-blocking update prompt dialog (CMP-17 / SCR-P15-variant):
 * - SOFT: offers "Nanti" (2h snooze) + "Perbarui sekarang". Hidden automatically while cart/payment active.
 * - HARD / REQUIRED: no "Nanti" button; explains auto-apply at safe moment.
 */
export function UpdateDialog({
  open,
  mandatory,
  canSnooze,
  onReloadNow,
  onSnooze,
}: UpdateDialogProps) {
  const { t } = useTranslation()

  if (!open) {
    return null
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="solva-update-dialog-title"
      className="fixed bottom-4 right-4 z-50 w-full max-w-sm px-4 sm:px-0"
      data-testid="update-dialog"
    >
      <Card className="border-line bg-surface p-4 shadow-card">
        <div className="flex items-start gap-3">
          <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-info-soft text-info-ink">
            <Download className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="solva-update-dialog-title"
              className="text-label font-semibold text-ink"
            >
              {mandatory ? t('pos.update.hardTitle') : t('pos.update.softTitle')}
            </h2>
            <p className="mt-1 text-caption text-ink-soft">
              {mandatory ? t('pos.update.hardBody') : t('pos.update.softBody')}
            </p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {canSnooze && onSnooze ? (
                <Button type="button" variant="secondary" size="sm" onClick={onSnooze}>
                  {t('pos.update.laterButton')}
                </Button>
              ) : null}
              <Button type="button" variant="primary" size="sm" onClick={onReloadNow}>
                {t('pos.update.reloadNowButton')}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
