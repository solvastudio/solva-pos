import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, CircleAlert, Dialog, Field, Input, Radio, useToast } from '~/components/ui'
import { previewRecoveryFn, recoverRegisterFn } from '~/functions/sales/recovery.fn'
import { DEVICE_REVOKE_REASONS, type DeviceRevokeReason, type DeviceView } from '~/modules/identity/shared'
import { qk } from '~/queries/keys'

export interface RecoverRegisterWizardProps {
  tenantSlug: string
  target: DeviceView | null
  onOpenChange: (open: boolean) => void
}

interface SeriesPreviewView {
  readonly docType: 'INVOICE' | 'CREDIT_NOTE'
  readonly highestReceivedSeq: number
  readonly declaredLastSeq: number | null
  readonly nextSeq: number
  readonly nextFormattedNo: string | null
  readonly gapRange: { readonly seqFrom: number; readonly seqTo: number } | null
}

interface RecoveryPreviewView {
  readonly registerId: string
  readonly outletCode: string
  readonly registerCode: string
  readonly period: string
  readonly hasActiveDevice: boolean
  readonly invoice: SeriesPreviewView
  readonly creditNote: SeriesPreviewView
}

function formatSeqPad(n: number): string {
  return String(n).padStart(6, '0')
}

function parseOptionalNonNegInt(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (!/^\d+$/.test(trimmed)) return Number.NaN
  return Number(trimmed)
}

export function RecoverRegisterWizard({
  tenantSlug,
  target,
  onOpenChange,
}: RecoverRegisterWizardProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const formId = useId()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [reasonCode, setReasonCode] = useState<DeviceRevokeReason>('LOST')
  const [declaredInvRaw, setDeclaredInvRaw] = useState('')
  const [declaredCnRaw, setDeclaredCnRaw] = useState('')
  const [reasonText, setReasonText] = useState('')
  const [preview, setPreview] = useState<RecoveryPreviewView | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (target) {
      setStep(1)
      setReasonCode('LOST')
      setDeclaredInvRaw('')
      setDeclaredCnRaw('')
      setReasonText('')
      setPreview(null)
      setErrorMsg(null)
    }
  }, [target])

  const previewMutation = useMutation({
    retry: 0,
    mutationFn: (vars: {
      registerId: string
      declaredLastInvoiceSeq: number | null
      declaredLastCreditSeq: number | null
    }) => previewRecoveryFn({ data: vars }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey, { defaultValue: t('admin.devices.recover.failed') }))
        return
      }
      setErrorMsg(null)
      setPreview(res.data)
      setStep(3)
    },
    onError: () => {
      setErrorMsg(t('admin.devices.recover.failed'))
    },
  })

  const recoverMutation = useMutation({
    retry: 0,
    mutationFn: () => {
      if (!target) throw new Error('Missing device target')
      const invSeq = parseOptionalNonNegInt(declaredInvRaw)
      const cnSeq = parseOptionalNonNegInt(declaredCnRaw)
      return recoverRegisterFn({
        data: {
          registerId: target.registerId,
          reasonCode,
          declaredLastInvoiceSeq: Number.isNaN(invSeq) ? null : invSeq,
          declaredLastCreditSeq: Number.isNaN(cnSeq) ? null : cnSeq,
          reasonText: reasonText.trim() || null,
        },
      })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey, { defaultValue: t('admin.devices.recover.failed') }))
        return
      }
      void queryClient.invalidateQueries({ queryKey: qk.devices(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.devices.recover.succeeded') })
      onOpenChange(false)
    },
    onError: () => {
      setErrorMsg(t('admin.devices.recover.failed'))
    },
  })

  function handleNextFromStep2() {
    if (!target) return
    const invSeq = parseOptionalNonNegInt(declaredInvRaw)
    const cnSeq = parseOptionalNonNegInt(declaredCnRaw)
    if (Number.isNaN(invSeq) || Number.isNaN(cnSeq)) {
      setErrorMsg(t('admin.devices.recover.failed'))
      return
    }
    setErrorMsg(null)
    previewMutation.mutate({
      registerId: target.registerId,
      declaredLastInvoiceSeq: invSeq,
      declaredLastCreditSeq: cnSeq,
    })
  }

  const regLabel = target ? `${target.outletCode}-${target.registerCode}` : ''

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={onOpenChange}
      title={t('admin.devices.recover.title', { register: regLabel })}
      size="md"
      footer={
        <>
          {step > 1 ? (
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setErrorMsg(null)
                setStep((s) => (s === 3 ? 2 : 1))
              }}
            >
              {t('admin.devices.recover.back')}
            </Button>
          ) : (
            <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
          )}
          {step === 1 ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setErrorMsg(null)
                setStep(2)
              }}
            >
              {t('admin.devices.recover.next')}
            </Button>
          ) : step === 2 ? (
            <Button
              variant="primary"
              size="md"
              loading={previewMutation.isPending}
              onClick={handleNextFromStep2}
            >
              {t('admin.devices.recover.next')}
            </Button>
          ) : (
            <Button
              variant="danger"
              size="md"
              loading={recoverMutation.isPending}
              onClick={() => recoverMutation.mutate()}
            >
              {t('admin.devices.recover.confirmAction')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {errorMsg ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-body font-semibold text-ink">
              {t('admin.devices.recover.step1Title')}
            </h3>
            <p className="text-body-sm text-ink-soft">
              {t('admin.devices.recover.step1Desc', { name: target?.name ?? '' })}
            </p>
            <Radio
              ariaLabel={t('admin.devices.revoke.reasonLabel')}
              value={reasonCode}
              onValueChange={(v) => setReasonCode(v as DeviceRevokeReason)}
              options={DEVICE_REVOKE_REASONS.map((code) => ({
                value: code,
                label: t(`admin.devices.revoke.reason${code}`),
              }))}
            />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-body font-semibold text-ink">
              {t('admin.devices.recover.step2Title')}
            </h3>
            <p className="text-body-sm text-ink-soft">{t('admin.devices.recover.step2Desc')}</p>
            <Field label={t('admin.devices.recover.declaredInvoiceLabel')} htmlFor={`${formId}-inv`}>
              <Input
                id={`${formId}-inv`}
                type="text"
                inputMode="numeric"
                value={declaredInvRaw}
                onChange={(e) => setDeclaredInvRaw(e.target.value)}
                placeholder={t('admin.devices.recover.declaredInvoicePlaceholder')}
              />
            </Field>
            <Field label={t('admin.devices.recover.declaredCreditLabel')} htmlFor={`${formId}-cn`}>
              <Input
                id={`${formId}-cn`}
                type="text"
                inputMode="numeric"
                value={declaredCnRaw}
                onChange={(e) => setDeclaredCnRaw(e.target.value)}
                placeholder={t('admin.devices.recover.declaredCreditPlaceholder')}
              />
            </Field>
            <Field label={t('admin.devices.recover.reasonTextLabel')} htmlFor={`${formId}-note`}>
              <Input
                id={`${formId}-note`}
                type="text"
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
              />
            </Field>
          </div>
        ) : null}

        {step === 3 && preview ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-body font-semibold text-ink">
              {t('admin.devices.recover.step3Title')}
            </h3>
            <div className="rounded-control border border-border bg-surface-muted p-3 text-body-sm">
              <p className="font-mono font-medium text-ink">
                {t('admin.devices.recover.nextInvoiceSeq', {
                  seq: formatSeqPad(preview.invoice.nextSeq),
                })}
              </p>
              <p className="text-ink-soft">
                {preview.invoice.gapRange
                  ? t('admin.devices.recover.gapCreated', {
                      type: 'INVOICE',
                      from: formatSeqPad(preview.invoice.gapRange.seqFrom),
                      to: formatSeqPad(preview.invoice.gapRange.seqTo),
                    })
                  : t('admin.devices.recover.noGapCreated', { type: 'INVOICE' })}
              </p>
            </div>
            <div className="rounded-control border border-border bg-surface-muted p-3 text-body-sm">
              <p className="font-mono font-medium text-ink">
                {t('admin.devices.recover.nextCreditSeq', {
                  seq: formatSeqPad(preview.creditNote.nextSeq),
                })}
              </p>
              <p className="text-ink-soft">
                {preview.creditNote.gapRange
                  ? t('admin.devices.recover.gapCreated', {
                      type: 'CREDIT_NOTE',
                      from: formatSeqPad(preview.creditNote.gapRange.seqFrom),
                      to: formatSeqPad(preview.creditNote.gapRange.seqTo),
                    })
                  : t('admin.devices.recover.noGapCreated', { type: 'CREDIT_NOTE' })}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
