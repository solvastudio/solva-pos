import { useEffect, useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Dialog } from '~/components/ui/Dialog'
import { Field } from '~/components/ui/Field'
import { Input } from '~/components/ui/Input'
import type { CartCustomer } from '~/pos/domain/cart'

export interface CustomerDialogProps {
  open: boolean
  initialCustomer?: CartCustomer
  onOpenChange: (open: boolean) => void
  onSave: (customer: CartCustomer | undefined) => void
}

export function CustomerDialog({
  open,
  initialCustomer,
  onOpenChange,
  onSave,
}: CustomerDialogProps) {
  const { t } = useTranslation()
  const nameId = useId()
  const phoneId = useId()
  const [name, setName] = useState(initialCustomer?.name ?? '')
  const [phone, setPhone] = useState(initialCustomer?.phone ?? '')

  useEffect(() => {
    if (open) {
      setName(initialCustomer?.name ?? '')
      setPhone(initialCustomer?.phone ?? '')
    }
  }, [initialCustomer, open])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const cleanName = name.trim()
    const cleanPhone = phone.trim()
    if (!cleanName && !cleanPhone) {
      onSave(undefined)
    } else {
      onSave({
        ...(cleanName ? { name: cleanName } : {}),
        ...(cleanPhone ? { phone: cleanPhone } : {}),
      })
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('pos.cart.customerTitle')} size="sm">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field htmlFor={nameId} label={t('pos.cart.customerNameLabel')}>
          <Input
            id={nameId}
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field htmlFor={phoneId} label={t('pos.cart.customerPhoneLabel')}>
          <Input
            id={phoneId}
            type="tel"
            value={phone}
            maxLength={40}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onSave(undefined)
              onOpenChange(false)
            }}
          >
            {t('pos.cart.customerClear')}
          </Button>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" size="md">
              {t('pos.cart.customerSave')}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}
