import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Dialog } from '~/components/ui/Dialog'
import { CircleAlert } from '~/components/ui/icons'
import type { CashMasterRecord } from '~/pos/db/types'

export interface HandoverDialogProps {
  open: boolean
  billRef: string
  cashierRegisters: readonly CashMasterRecord[]
  submitting?: boolean
  errorMessage?: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: (targetRegisterId: string) => void | Promise<void>
}

export function HandoverDialog({
  open,
  billRef,
  cashierRegisters,
  submitting = false,
  errorMessage = null,
  onOpenChange,
  onConfirm,
}: HandoverDialogProps) {
  const { t } = useTranslation()
  const [selectedRegId, setSelectedRegId] = useState<string>('')

  useEffect(() => {
    if (open) {
      setSelectedRegId(cashierRegisters[0]?.id ?? '')
    }
  }, [cashierRegisters, open])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!selectedRegId) return
    void onConfirm(selectedRegId)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('pos.handover.dialogTitle')} size="sm">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-soft">
          {t('pos.handover.dialogSubtitle', { ref: billRef })}
        </p>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-label font-semibold text-ink">
            {t('pos.handover.targetRegisterLabel')}
          </legend>
          <div className="flex flex-col gap-2">
            {cashierRegisters.map((reg) => (
              <label
                key={reg.id}
                className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-card border border-line bg-surface px-3 py-2 text-body hover:border-action has-[:checked]:border-action has-[:checked]:bg-primary-50"
              >
                <span className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    name="handover-target-register"
                    checked={selectedRegId === reg.id}
                    onChange={() => setSelectedRegId(reg.id)}
                    className="size-4 accent-action"
                  />
                  <span className="font-medium text-ink">{reg.name}</span>
                </span>
                <span className="font-mono text-caption text-ink-soft">{reg.code}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {errorMessage ? (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-card bg-danger-soft px-3 py-2 text-body-sm text-danger-ink"
          >
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!selectedRegId}
            loading={submitting}
          >
            {t('pos.handover.confirmButton')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
