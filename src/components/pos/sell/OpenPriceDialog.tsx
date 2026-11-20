import { useEffect, useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Dialog } from '~/components/ui/Dialog'
import { Field } from '~/components/ui/Field'
import { MoneyInput } from '~/components/ui/MoneyInput'

export interface OpenPriceDialogProps {
  open: boolean
  productName: string
  initialPrice: number | null
  onOpenChange: (open: boolean) => void
  onConfirm: (price: number) => void
}

export function OpenPriceDialog({
  open,
  productName,
  initialPrice,
  onOpenChange,
  onConfirm,
}: OpenPriceDialogProps) {
  const { t } = useTranslation()
  const inputId = useId()
  const [price, setPrice] = useState<number | null>(initialPrice)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPrice(initialPrice)
      setError(null)
    }
  }, [initialPrice, open])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (price === null || !Number.isSafeInteger(price) || price <= 0) {
      setError(t('pos.cart.openPriceInvalid'))
      return
    }
    onConfirm(price)
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('pos.cart.openPriceTitle', { name: productName })}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field htmlFor={inputId} label={t('pos.cart.openPriceLabel')} error={error ?? undefined}>
          <MoneyInput
            id={inputId}
            value={price}
            onChange={(val) => {
              setError(null)
              setPrice(val)
            }}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary">
            {t('pos.cart.openPriceSave')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
