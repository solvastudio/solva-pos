import { useEffect, useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Dialog } from '~/components/ui/Dialog'
import { Field } from '~/components/ui/Field'
import { Input } from '~/components/ui/Input'

export interface VoidItemDialogProps {
  open: boolean
  itemName: string
  submitting?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reasonText: string) => void | Promise<void>
}

export function VoidItemDialog({
  open,
  itemName,
  submitting = false,
  onOpenChange,
  onConfirm,
}: VoidItemDialogProps) {
  const { t } = useTranslation()
  const reasonId = useId()
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (open) setReason('')
  }, [open])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const clean = reason.trim()
    if (!clean) return
    void onConfirm(clean)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${t('pos.bill.voidDialogTitle')} — ${itemName}`}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field htmlFor={reasonId} label={t('pos.bill.voidReasonLabel')}>
          <Input
            id={reasonId}
            value={reason}
            maxLength={200}
            required
            placeholder={t('pos.bill.voidReasonPlaceholder')}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="danger"
            size="md"
            disabled={reason.trim().length === 0}
            loading={submitting}
          >
            {t('pos.bill.voidSubmit')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
