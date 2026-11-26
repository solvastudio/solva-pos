import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  CircleAlert,
  Dialog,
  Field,
  Info,
  Input,
  Segmented,
  Select,
  useToast,
} from '~/components/ui'
import { createRegisterFn } from '~/functions/identity/register.fn'
import { validateInvoicePrefix } from '~/lib/kernel'
import {
  previewInvoiceNumbers,
  suggestPrefix,
  type PaperWidthMm,
  type RegisterType,
} from '~/modules/identity/shared'
import { qk } from '~/queries/keys'

type OutletList = Awaited<ReturnType<typeof import('~/functions/identity/org.fn').listOutletsFn>>

const LOCALE_FOLLOW_OUTLET = '__FOLLOW__'

export interface CreateRegisterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantSlug: string
  outlets: OutletList
  todayYmd: string
  localeOptions: readonly { value: string; label: string }[]
}

export function CreateRegisterDialog({
  open,
  onOpenChange,
  tenantSlug,
  outlets,
  todayYmd,
  localeOptions,
}: CreateRegisterDialogProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const formIdPrefix = useId()
  const createOutletId = `${formIdPrefix}-reg-outlet`
  const createCodeId = `${formIdPrefix}-reg-code`
  const createNameId = `${formIdPrefix}-reg-name`
  const createPrefixId = `${formIdPrefix}-reg-prefix`
  const createLocaleId = `${formIdPrefix}-reg-locale`

  const firstOutlet = outlets[0]
  const [outletId, setOutletId] = useState(firstOutlet?.id ?? '')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [registerType, setRegisterType] = useState<RegisterType>('CASHIER')
  const [invoicePrefix, setInvoicePrefix] = useState(
    firstOutlet ? suggestPrefix(firstOutlet.code, 'POS01') : '',
  )
  const [prefixTouched, setPrefixTouched] = useState(false)
  const [paperWidthMm, setPaperWidthMm] = useState<PaperWidthMm>(80)
  const [defaultLocale, setDefaultLocale] = useState<string>(LOCALE_FOLLOW_OUTLET)
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string>>({})
  const [createError, setCreateError] = useState<string | null>(null)

  const createMutation = useMutation({
    retry: 0,
    mutationFn: () =>
      createRegisterFn({
        data: {
          outletId,
          code: code.trim(),
          name: name.trim(),
          registerType,
          invoicePrefix: registerType === 'CASHIER' ? invoicePrefix.trim() : null,
          paperWidthMm,
          defaultLocale:
            defaultLocale === LOCALE_FOLLOW_OUTLET
              ? null
              : (defaultLocale as 'id-ID' | 'en-US'),
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setCreateError(t(res.errorKey, { defaultValue: t('admin.users.failed') }))
        return
      }
      void queryClient.invalidateQueries({ queryKey: qk.registers(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.users.saved') })
      onOpenChange(false)
    },
    onError: () => {
      setCreateError(t('admin.users.failed'))
    },
  })

  function handleCodeChange(nextCodeRaw: string) {
    const clean = nextCodeRaw.toUpperCase()
    setCode(clean)
    if (!prefixTouched && registerType === 'CASHIER') {
      const selectedOutlet = outlets.find((o) => o.id === outletId)
      if (selectedOutlet && clean) {
        setInvoicePrefix(suggestPrefix(selectedOutlet.code, clean))
      }
    }
  }

  function handleOutletChange(nextOutletId: string) {
    setOutletId(nextOutletId)
    if (!prefixTouched && registerType === 'CASHIER') {
      const selectedOutlet = outlets.find((o) => o.id === nextOutletId)
      if (selectedOutlet && code) {
        setInvoicePrefix(suggestPrefix(selectedOutlet.code, code))
      }
    }
  }

  function clearCreateFieldError(field: string) {
    setCreateFieldErrors((prev) => {
      if (!prev[field]) return prev
      const copy = { ...prev }
      delete copy[field]
      return copy
    })
  }

  function handleCreateSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCreateError(null)
    const nextErrors: Record<string, string> = {}
    if (!outletId) {
      nextErrors.outletId = t('validation.selectRequired', {
        field: t('admin.users.register.outletLabel'),
      })
    }
    if (!/^[A-Z0-9]{1,10}$/.test(code.trim())) {
      nextErrors.code = t('admin.users.register.codeHint')
    }
    if (!name.trim()) {
      nextErrors.name = t('validation.fieldRequired', {
        field: t('admin.users.register.nameLabel'),
      })
    }
    if (registerType === 'CASHIER') {
      const cleanPrefix = invoicePrefix.trim()
      if (!cleanPrefix) {
        nextErrors.invoicePrefix = t('admin.users.register.prefixRequired')
      } else if (!validateInvoicePrefix(cleanPrefix).ok) {
        nextErrors.invoicePrefix = t('admin.users.register.prefixInvalid')
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setCreateFieldErrors(nextErrors)
      return
    }
    setCreateFieldErrors({})
    createMutation.mutate()
  }

  const createPreview = useMemo(() => {
    const clean = invoicePrefix.trim()
    if (registerType !== 'CASHIER' || !validateInvoicePrefix(clean).ok) return null
    return previewInvoiceNumbers(clean, todayYmd)
  }, [invoicePrefix, registerType, todayYmd])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.users.register.createTitle')}
      size="md"
    >
      <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
        {createError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{createError}</span>
          </div>
        ) : null}

        <Field
          label={t('admin.users.register.outletLabel')}
          htmlFor={createOutletId}
          error={createFieldErrors.outletId}
        >
          <Select
            id={createOutletId}
            value={outletId}
            onValueChange={(v) => {
              handleOutletChange(v)
              clearCreateFieldError('outletId')
            }}
            options={outlets.map((o) => ({ value: o.id, label: `${o.code} · ${o.name}` }))}
            placeholder={t('admin.users.register.outletPlaceholder')}
            invalid={Boolean(createFieldErrors.outletId)}
            size="md"
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={t('admin.users.register.codeLabel')}
            htmlFor={createCodeId}
            hint={t('admin.users.register.codeHint')}
            error={createFieldErrors.code}
          >
            <Input
              id={createCodeId}
              controlSize="md"
              value={code}
              invalid={Boolean(createFieldErrors.code)}
              className="font-mono uppercase"
              onChange={(e) => {
                handleCodeChange(e.target.value)
                clearCreateFieldError('code')
              }}
              maxLength={10}
            />
          </Field>

          <Field
            label={t('admin.users.register.nameLabel')}
            htmlFor={createNameId}
            error={createFieldErrors.name}
          >
            <Input
              id={createNameId}
              controlSize="md"
              value={name}
              invalid={Boolean(createFieldErrors.name)}
              onChange={(e) => {
                setName(e.target.value)
                clearCreateFieldError('name')
              }}
              maxLength={80}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-ink">
            {t('admin.users.register.typeLabel')}
          </span>
          <Segmented
            ariaLabel={t('admin.users.register.typeLabel')}
            value={registerType}
            onChange={(v) => setRegisterType(v as RegisterType)}
            options={[
              { value: 'CASHIER', label: t('admin.users.register.typeCASHIER') },
              { value: 'WAITER', label: t('admin.users.register.typeWAITER') },
            ]}
          />
        </div>

        {registerType === 'WAITER' ? (
          <div className="flex items-start gap-2 rounded-control border border-info-line bg-info-soft p-3 text-body-sm text-info-ink">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{t('admin.users.register.waiterNotice')}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Field
              label={t('admin.users.register.prefixLabel')}
              htmlFor={createPrefixId}
              hint={t('admin.users.register.prefixHint')}
              error={createFieldErrors.invoicePrefix}
            >
              <Input
                id={createPrefixId}
                controlSize="md"
                value={invoicePrefix}
                invalid={Boolean(createFieldErrors.invoicePrefix)}
                className="font-mono uppercase"
                onChange={(e) => {
                  setPrefixTouched(true)
                  setInvoicePrefix(e.target.value.toUpperCase())
                  clearCreateFieldError('invoicePrefix')
                }}
                maxLength={16}
              />
            </Field>
            {createPreview ? (
              <div className="rounded-control border border-line bg-surface-subtle p-3 text-body-sm">
                <p className="font-medium text-ink-soft">
                  {t('admin.users.register.previewLabel')}
                </p>
                <p className="mt-1 font-mono text-ink">
                  {t('admin.users.register.previewInvoice', { value: createPreview.invoice })}
                </p>
                <p className="font-mono text-ink-soft">
                  {t('admin.users.register.previewCreditNote', {
                    value: createPreview.creditNote,
                  })}
                </p>
              </div>
            ) : null}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-ink">
              {t('admin.users.register.paperLabel')}
            </span>
            <Segmented
              ariaLabel={t('admin.users.register.paperLabel')}
              value={String(paperWidthMm)}
              onChange={(v) => setPaperWidthMm(v === '58' ? 58 : 80)}
              options={[
                { value: '58', label: t('admin.users.register.paper58') },
                { value: '80', label: t('admin.users.register.paper80') },
              ]}
            />
          </div>

          <Field label={t('admin.users.register.localeLabel')} htmlFor={createLocaleId}>
            <Select
              id={createLocaleId}
              value={defaultLocale}
              onValueChange={setDefaultLocale}
              options={localeOptions}
              size="md"
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => onOpenChange(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" size="md" loading={createMutation.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
