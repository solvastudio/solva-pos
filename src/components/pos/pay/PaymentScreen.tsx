import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Numpad } from '~/components/pos/Numpad'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { Field } from '~/components/ui/Field'
import { CircleAlert } from '~/components/ui/icons'
import { Input } from '~/components/ui/Input'
import { MoneyInput } from '~/components/ui/MoneyInput'
import { formatMoney, roundCashDue, toMoney, type Money } from '~/lib/kernel'
import type { DetailedPaymentEntry } from '~/pos/domain/build-finalize-payload'
import { previewPayments } from '~/pos/domain/payment-preview'
import type { CartState } from '~/pos/domain/cart'
import type { PaymentMethodRecord } from '~/pos/db/types'
import { calcSale } from '~/lib/sales-calc'
import { toCalcInput } from '~/pos/domain/cart'
import { setPaymentInProgress } from '~/pos/session/session'
import { CashQuickAmounts } from './CashQuickAmounts'
import { ChangeSummary } from './ChangeSummary'
import { MethodPicker, type PayMethodOption } from './MethodPicker'
import { PaymentRow } from './PaymentRow'

const DEFAULT_CASH_ID = '00000000-0000-0000-0000-000000000001'

export interface PaymentScreenProps {
  cart: CartState
  paymentMethods: readonly PaymentMethodRecord[]
  submitting?: boolean
  errorMessage?: string | null
  onBack: () => void
  onComplete: (payments: readonly DetailedPaymentEntry[]) => void | Promise<void>
}

export function buildMethodOptions(
  records: readonly PaymentMethodRecord[],
  cashFallbackLabel: string,
): PayMethodOption[] {
  const mapped: PayMethodOption[] = records
    .filter((r) => r.is_active && !r.deleted_at)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      kind: r.kind === 'NON_CASH' ? 'NON_CASH' : 'CASH',
      requiresReference: Boolean(r.requires_reference),
    }))

  if (!mapped.some((m) => m.kind === 'CASH')) {
    mapped.unshift({
      id: DEFAULT_CASH_ID,
      code: 'CASH',
      name: cashFallbackLabel,
      kind: 'CASH',
      requiresReference: false,
    })
  }
  return mapped
}

export function PaymentScreen({
  cart,
  paymentMethods,
  submitting = false,
  errorMessage = null,
  onBack,
  onComplete,
}: PaymentScreenProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const amountId = useId()
  const refId = useId()

  const methods = useMemo(
    () => buildMethodOptions(paymentMethods, t('pos.pay.cashName')),
    [paymentMethods, t],
  )

  const calc = useMemo(
    () =>
      cart.equalShare
        ? { ...cart.equalShare.calc, lines: [] as const }
        : cart.lines.length > 0
          ? calcSale(toCalcInput(cart))
          : null,
    [cart],
  )
  const grandTotal: Money = calc ? calc.grandTotal : toMoney(0)

  const [selectedMethodId, setSelectedMethodId] = useState<string>(methods[0]?.id ?? DEFAULT_CASH_ID)
  const [payments, setPayments] = useState<DetailedPaymentEntry[]>([])
  const [amountInput, setAmountInput] = useState<number | null>(grandTotal > 0 ? grandTotal : null)
  const [reference, setReference] = useState('')

  useEffect(() => {
    setPaymentInProgress(true)
    return () => {
      setPaymentInProgress(false)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        e.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onBack, submitting])

  const selectedMethod =
    methods.find((m) => m.id === selectedMethodId) ?? methods[0]!

  const preview = useMemo(
    () =>
      previewPayments({
        grandTotal,
        cashRoundingUnit: cart.cashRoundingUnit,
        payments: payments.map((p) => ({
          methodCode: p.methodCode,
          kind: p.kind,
          amount: p.amount,
          reference: p.reference,
        })),
      }),
    [cart.cashRoundingUnit, grandTotal, payments],
  )

  const roundedCashRemaining =
    preview.remaining > 0 ? roundCashDue(preview.remaining, cart.cashRoundingUnit) : toMoney(0)
  const defaultAmount =
    preview.remaining > 0
      ? selectedMethod.kind === 'CASH'
        ? roundedCashRemaining
        : preview.remaining
      : null

  useEffect(() => {
    setAmountInput(defaultAmount)
  }, [defaultAmount])

  const nonCashExceeds =
    selectedMethod.kind === 'NON_CASH' &&
    amountInput !== null &&
    amountInput > preview.remaining

  const canAddPayment =
    !submitting &&
    amountInput !== null &&
    amountInput > 0 &&
    !nonCashExceeds &&
    preview.remaining > 0

  function addEntry(amount: Money, method: PayMethodOption = selectedMethod, ref = reference) {
    const cleanRef = ref.trim()
    setPayments((prev) => [
      ...prev,
      {
        methodId: method.id,
        methodCode: method.code,
        methodName: method.name,
        kind: method.kind,
        amount,
        ...(cleanRef ? { reference: cleanRef } : {}),
      },
    ])
    setReference('')
  }

  function handleDigit(d: string) {
    const cur = amountInput ?? 0
    const next = Number(`${cur === 0 ? '' : cur}${d}`)
    if (Number.isSafeInteger(next)) {
      setAmountInput(toMoney(next))
    }
  }

  function handleBackspace() {
    if (amountInput === null || amountInput <= 0) return
    const txt = String(amountInput).slice(0, -1)
    setAmountInput(txt ? toMoney(Number(txt)) : 0)
  }

  function handleFinish() {
    if (!preview.canFinalize || submitting) return
    void onComplete(payments)
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <Button type="button" variant="secondary" size="md" disabled={submitting} onClick={onBack}>
            {t('pos.pay.backToCart')}
          </Button>
          <h1 className="text-h2 font-semibold text-ink">{t('pos.pay.title')}</h1>
        </div>

        <div className="flex flex-col items-end">
          <span className="text-caption text-ink-soft">{t('pos.pay.billLabel')}</span>
          <span className="font-mono text-h1 font-bold text-ink tabular-nums">
            {formatMoney(grandTotal, locale)}
          </span>
        </div>
      </div>

      {errorMessage ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-card border border-danger-line bg-danger-soft px-4 py-3 text-body text-danger-ink"
        >
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="flex flex-col gap-4 p-4 lg:col-span-7">
          <MethodPicker
            methods={methods}
            selectedId={selectedMethod.id}
            onSelect={(m) => setSelectedMethodId(m.id)}
          />

          <Field
            htmlFor={amountId}
            label={
              selectedMethod.kind === 'CASH'
                ? t('pos.pay.cashInputLabel')
                : t('pos.pay.nonCashInputLabel')
            }
            error={nonCashExceeds ? t('pos.pay.nonCashExceedsError') : undefined}
          >
            <MoneyInput
              id={amountId}
              value={amountInput}
              onChange={(v) => setAmountInput(v)}
              disabled={submitting}
            />
          </Field>

          {selectedMethod.kind === 'CASH' ? (
            <>
              <CashQuickAmounts
                remaining={roundedCashRemaining}
                disabled={submitting || preview.remaining <= 0}
                onPickAmount={(amt) => {
                  addEntry(amt, selectedMethod)
                }}
              />

              <Numpad
                keyboardEnabled={false}
                disabled={submitting || preview.remaining <= 0}
                submitDisabled={!canAddPayment}
                onDigit={handleDigit}
                onBackspace={handleBackspace}
                onSubmit={() => {
                  if (canAddPayment && amountInput !== null) {
                    addEntry(toMoney(amountInput))
                  }
                }}
                className="mx-auto w-full max-w-xs"
              />
            </>
          ) : (
            <Field htmlFor={refId} label={t('pos.pay.referenceLabel')}>
              <Input
                id={refId}
                value={reference}
                maxLength={60}
                placeholder={t('pos.pay.referencePlaceholder')}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
          )}

          <Button
            type="button"
            variant="secondary"
            size="lg"
            disabled={!canAddPayment}
            onClick={() => {
              if (canAddPayment && amountInput !== null) {
                addEntry(toMoney(amountInput))
              }
            }}
          >
            {t('pos.pay.addPayment')}
          </Button>
        </Card>

        <Card className="flex flex-col justify-between gap-4 p-4 lg:col-span-5">
          <div className="flex flex-col gap-3">
            <h2 className="text-label font-semibold text-ink">
              {t('pos.pay.paymentsListHeading')}
            </h2>

            {payments.length > 0 ? (
              <div role="list" className="flex flex-col gap-2">
                {payments.map((entry, index) => (
                  <PaymentRow
                    key={`${entry.methodId}-${index}`}
                    entry={entry}
                    onRemove={() =>
                      setPayments((prev) => prev.filter((_, i) => i !== index))
                    }
                  />
                ))}
              </div>
            ) : null}

            <ChangeSummary grandTotal={grandTotal} preview={preview} />
          </div>

          <div className="flex flex-col gap-2">
            {!preview.canFinalize ? (
              <p className="text-center text-caption text-ink-soft">
                {preview.error === 'NONCASH_EXCEEDS_REMAINING'
                  ? t('pos.pay.nonCashExceedsError')
                  : t('pos.pay.underpaidDisabledReason')}
              </p>
            ) : null}

            <Button
              type="button"
              variant="primary"
              size="xl"
              fullWidth
              disabled={!preview.canFinalize || submitting}
              loading={submitting}
              onClick={handleFinish}
              className="border border-transparent disabled:border-line"
            >
              {submitting ? t('pos.pay.processing') : t('pos.pay.finishButton')}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
