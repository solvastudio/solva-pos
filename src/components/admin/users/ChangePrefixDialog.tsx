import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog, Field, Info, Input, useToast } from '~/components/ui'
import { changeInvoicePrefixFn } from '~/functions/identity/register.fn'
import { validateInvoicePrefix } from '~/lib/kernel'
import { previewInvoiceNumbers, type RegisterView } from '~/modules/identity/shared'
import { qk } from '~/queries/keys'

export interface ChangePrefixDialogProps {
  row: RegisterView
  tenantSlug: string
  todayYmd: string
  nextMonthMmYy: string
  onClose: () => void
}

export function ChangePrefixDialog({
  row,
  tenantSlug,
  todayYmd,
  nextMonthMmYy,
  onClose,
}: ChangePrefixDialogProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const formIdPrefix = useId()
  const changePrefixId = `${formIdPrefix}-reg-next-prefix`

  const [nextPrefixInput, setNextPrefixInput] = useState(
    row.pendingNextPrefix?.invoicePrefix ?? row.currentPrefix ?? '',
  )
  const [prefixError, setPrefixError] = useState<string | null>(null)

  const changePrefixMutation = useMutation({
    retry: 0,
    mutationFn: () =>
      changeInvoicePrefixFn({
        data: {
          registerId: row.id,
          newPrefix: nextPrefixInput.trim(),
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setPrefixError(t(res.errorKey, { defaultValue: t('admin.users.failed') }))
        return
      }
      void queryClient.invalidateQueries({ queryKey: qk.registers(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.users.saved') })
      onClose()
    },
    onError: () => {
      setPrefixError(t('admin.users.failed'))
    },
  })

  function handleChangePrefixSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const clean = nextPrefixInput.trim()
    if (!validateInvoicePrefix(clean).ok) {
      setPrefixError(t('admin.users.register.prefixInvalid'))
      return
    }
    setPrefixError(null)
    changePrefixMutation.mutate()
  }

  const changePrefixPreview = useMemo(() => {
    const clean = nextPrefixInput.trim()
    if (!validateInvoicePrefix(clean).ok) return null
    return previewInvoiceNumbers(clean, todayYmd)
  }, [nextPrefixInput, todayYmd])

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t('admin.users.register.changePrefixTitle', { code: row.code })}
      size="md"
    >
      <form onSubmit={handleChangePrefixSubmit} className="flex flex-col gap-4">
        <div className="flex items-start gap-2 rounded-control border border-info-line bg-info-soft p-3 text-body-sm text-info-ink">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{t('admin.users.register.prefixNextMonth', { month: nextMonthMmYy })}</span>
        </div>

        <Field
          label={t('admin.users.register.newPrefixLabel')}
          htmlFor={changePrefixId}
          hint={t('admin.users.register.prefixHint')}
          error={prefixError ?? undefined}
        >
          <Input
            id={changePrefixId}
            controlSize="md"
            value={nextPrefixInput}
            invalid={Boolean(prefixError)}
            className="font-mono uppercase"
            onChange={(e) => {
              setNextPrefixInput(e.target.value.toUpperCase())
              setPrefixError(null)
            }}
            maxLength={16}
          />
        </Field>

        {changePrefixPreview ? (
          <div className="rounded-control border border-line bg-surface-subtle p-3 text-body-sm">
            <p className="font-medium text-ink-soft">{t('admin.users.register.previewLabel')}</p>
            <p className="mt-1 font-mono text-ink">
              {t('admin.users.register.previewInvoice', { value: changePrefixPreview.invoice })}
            </p>
            <p className="font-mono text-ink-soft">
              {t('admin.users.register.previewCreditNote', {
                value: changePrefixPreview.creditNote,
              })}
            </p>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={changePrefixMutation.isPending}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
