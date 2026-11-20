import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { Field } from '~/components/ui/Field'
import { CircleAlert, TriangleAlert } from '~/components/ui/icons'
import { MoneyInput } from '~/components/ui/MoneyInput'
import { formatMoney, toMoney } from '~/lib/kernel'
import { OPEN_SHIFT_QUICK_AMOUNTS } from '~/pos/domain/quick-amounts'

export interface OpenShiftFormProps {
  staffName: string
  outletName: string
  registerName: string
  mandatoryUpdateBlocked?: boolean
  submitting?: boolean
  errorMessage?: string | null
  onSubmit: (openingCash: number) => void | Promise<void>
}

export function OpenShiftForm({
  staffName,
  outletName,
  registerName,
  mandatoryUpdateBlocked = false,
  submitting = false,
  errorMessage = null,
  onSubmit,
}: OpenShiftFormProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const inputId = useId()
  const [amount, setAmount] = useState<number | null>(0)
  const [localError, setLocalError] = useState<string | null>(null)

  const displayError = errorMessage ?? localError
  const disabled = submitting || mandatoryUpdateBlocked

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault()
    if (disabled) return
    const value = amount ?? 0
    if (!Number.isSafeInteger(value) || value < 0) {
      setLocalError(t('pos.shift.invalidAmount'))
      return
    }
    setLocalError(null)
    void onSubmit(value)
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 items-center justify-center p-4">
      <Card className="w-full p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-h2 font-semibold text-ink">{t('pos.shift.openTitle')}</h1>
          <p className="text-body text-ink-soft">{t('pos.shift.openSubtitle')}</p>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-2 rounded-card border border-line bg-surface-sunken p-3 text-caption">
          <div>
            <dt className="text-ink-soft">{t('pos.shift.cashierLabel')}</dt>
            <dd className="truncate font-semibold text-ink">{staffName}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{t('pos.shift.outletLabel')}</dt>
            <dd className="truncate font-semibold text-ink">{outletName}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{t('pos.shift.registerLabel')}</dt>
            <dd className="truncate font-semibold text-ink">{registerName}</dd>
          </div>
        </dl>

        {mandatoryUpdateBlocked ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-card border border-warning-line bg-warning-soft p-3 text-body text-warning-ink"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{t('pos.shift.updateBlockedReason')}</span>
          </div>
        ) : null}

        {displayError ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-card border border-danger-line bg-danger-soft p-3 text-body text-danger-ink"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{displayError}</span>
          </div>
        ) : null}

        <form onSubmit={handleFormSubmit} className="mt-5 flex flex-col gap-4">
          <Field
            htmlFor={inputId}
            label={t('pos.shift.openingCashLabel')}
            hint={t('pos.shift.openingCashHint')}
          >
            <MoneyInput
              id={inputId}
              value={amount}
              onChange={(next) => {
                setLocalError(null)
                setAmount(next)
              }}
              disabled={disabled}
            />
          </Field>

          <div className="grid grid-cols-3 gap-2">
            {OPEN_SHIFT_QUICK_AMOUNTS.map((preset) => {
              const formatted = formatMoney(toMoney(preset), locale)
              return (
                <Button
                  key={preset}
                  type="button"
                  variant={amount === preset ? 'primary' : 'secondary'}
                  size="md"
                  disabled={disabled}
                  aria-label={t('pos.shift.quickAmountAria', { amount: formatted })}
                  onClick={() => {
                    setLocalError(null)
                    setAmount(preset)
                  }}
                >
                  {formatted}
                </Button>
              )
            })}
          </div>

          <Button type="submit" variant="primary" size="xl" fullWidth disabled={disabled} loading={submitting}>
            {t('pos.shift.openSubmit')}
          </Button>
        </form>
      </Card>
    </div>
  )
}
